/**
 * GDELT DOC 2.0 compatibility shim for the APITube News API.
 *
 * Accepts GDELT DOC parameters, calls APITube, and returns a response shaped like
 * GDELT's so existing call sites keep working.
 *
 * Two things this shim exists to prevent:
 *
 *   1. Forwarding a GDELT parameter name. APITube ignores what it does not recognise
 *      and answers 200 with the entire index — a successful-looking response containing
 *      unfiltered news. Only the allow-list below is ever sent.
 *
 *   2. Forwarding a GDELT language or country VALUE. GDELT emits English names
 *      ("Serbian", "South Korea"); APITube takes ISO codes (sr, kr). The maps below
 *      were each executed against /v1/news/count — see reference/language-country-mapping.md.
 *
 * Anything lossy is reported through `onWarning` rather than dropped in silence.
 */

const APITUBE_BASE_URL = 'https://api.apitube.io';

// GDELT language name (lowercased) -> ISO 639-1. Every code verified against
// /v1/news/count on 27 July 2026. Russian and Ukrainian are absent from APITube.
const LANGUAGE_TO_CODE = {
    english: 'en',
    spanish: 'es',
    german: 'de',
    portuguese: 'pt',
    french: 'fr',
    polish: 'pl',
    czech: 'cs',
    hindi: 'hi',
    bengali: 'bn',
    swedish: 'sv',
    finnish: 'fi',
    korean: 'ko',
    chinese: 'zh',
    serbian: 'sr'
};

// GDELT country label (lowercased) -> ISO 3166 alpha-2. Note gb, not uk.
const COUNTRY_TO_CODE = {
    'united states': 'us',
    brazil: 'br',
    'united kingdom': 'gb',
    poland: 'pl',
    spain: 'es',
    india: 'in',
    france: 'fr',
    mexico: 'mx',
    canada: 'ca',
    serbia: 'rs',
    colombia: 'co',
    finland: 'fi',
    'south korea': 'kr',
    china: 'cn',
    philippines: 'ph',
    taiwan: 'tw',
    malaysia: 'my',
    us: 'us',
    uk: 'gb'
};

// Absent from APITube on both axes. language.code=ru/uk -> ER0237,
// source.country.code=ru -> ER0212.
const UNSUPPORTED_LANGUAGES = new Set(['russian', 'ukrainian']);
const UNSUPPORTED_COUNTRIES = new Set(['russia', 'ukraine']);

const CODE_TO_LANGUAGE = Object.fromEntries(
    Object.entries(LANGUAGE_TO_CODE).map(([name, code]) => [code, name[0].toUpperCase() + name.slice(1)])
);

const CODE_TO_COUNTRY = {
    us: 'United States',
    br: 'Brazil',
    gb: 'United Kingdom',
    pl: 'Poland',
    es: 'Spain',
    in: 'India',
    fr: 'France',
    mx: 'Mexico',
    ca: 'Canada',
    rs: 'Serbia',
    co: 'Colombia',
    fi: 'Finland',
    kr: 'South Korea',
    cn: 'China',
    ph: 'Philippines',
    tw: 'Taiwan',
    my: 'Malaysia'
};

const MAX_RECORDS = 250;
const MAX_MULTI_VALUES = 3;

// GDELT modes this shim can serve. Everything else is refused rather than approximated.
const SUPPORTED_MODES = new Set(['artlist', 'artgallery']);

export class GdeltShim {
    /**
     * @param {object} options
     * @param {string} options.apiKey        APITube API key
     * @param {string} [options.baseUrl]     Override the API base URL
     * @param {function} [options.onWarning] Called with (message) for every lossy conversion
     * @param {function} [options.fetch]     Custom fetch implementation
     */
    constructor({
        apiKey,
        baseUrl = APITUBE_BASE_URL,
        onWarning = message => console.warn(`[gdelt-shim] ${message}`),
        fetch: fetchImpl = globalThis.fetch
    } = {}) {
        if (!apiKey) {
            throw new Error('apiKey is required');
        }

        this.apiKey = apiKey;
        this.baseUrl = baseUrl.replace(/\/$/, '');
        this.onWarning = onWarning;
        this.fetch = fetchImpl;
        this.lastParams = null;
    }

    /**
     * The GDELT DOC entry point. Accepts the parameters you already pass to
     * api.gdeltproject.org/api/v2/doc/doc and returns { articles: [...] }.
     */
    async doc(params = {}) {
        const translated = this.translateParams(params);
        const url = `${this.baseUrl}/v1/news/everything?${new URLSearchParams(translated).toString()}`;

        const response = await this.fetch(url, { headers: { 'X-API-Key': this.apiKey } });
        const payload = await response.json();

        if (payload.errors?.length) {
            const [error] = payload.errors;
            throw new GdeltShimError(error.message, {
                code: error.code,
                status: error.status,
                requestId: payload.request_id,
                url
            });
        }

        return this.shapeResponse(payload);
    }

    /**
     * Translate GDELT parameters into APITube parameters.
     * Exposed separately so you can inspect the conversion without issuing a request.
     */
    translateParams(params = {}) {
        const out = {};

        this.checkMode(params.mode);
        this.checkFormat(params.format);

        if (params.query !== undefined && params.query !== null && `${params.query}`.trim() !== '') {
            Object.assign(out, this.translateQuery(`${params.query}`));
        }

        const records = this.translateMaxRecords(params.maxrecords);

        if (records !== null) {
            out.per_page = records;
        }

        for (const name of ['timespan', 'startdatetime', 'enddatetime', 'sort', 'tone', 'tonesimple']) {
            if (params[name] !== undefined) {
                this.warn(
                    `${name} is not mapped by this kit — it has not been verified against the live GDELT API. ` +
                        `Dropped rather than guessed. See reference/parameter-mapping.md.`
                );
            }
        }

        this.lastParams = out;

        return out;
    }

    /**
     * Split a GDELT query string into APITube filters.
     *
     * GDELT packs operators into `query`: `tesla domain:bbc.co.uk sourcelang:english`.
     * Bare words become the search term; recognised operators become named parameters.
     */
    translateQuery(query) {
        const out = {};
        const domains = [];
        const languages = [];
        const countries = [];
        const terms = [];

        // Keep `operator:"two words"` together; split on whitespace otherwise.
        const tokens = query.match(/[a-z_]+:(?:"[^"]*"|\S+)|"[^"]*"|\S+/gi) || [];

        for (const token of tokens) {
            const match = token.match(/^([a-z_]+):(.+)$/i);

            if (!match) {
                terms.push(token.replace(/^"|"$/g, ''));
                continue;
            }

            const operator = match[1].toLowerCase();
            const value = match[2].replace(/^"|"$/g, '');

            if (operator === 'domain' || operator === 'domainis') {
                domains.push(value);
            } else if (operator === 'sourcelang') {
                const code = this.languageCode(value);

                if (code) {
                    languages.push(code);
                }
            } else if (operator === 'sourcecountry') {
                const code = this.countryCode(value);

                if (code) {
                    countries.push(code);
                }
            } else if (operator === 'theme') {
                this.warn(
                    `theme:${value} has no APITube equivalent — GDELT's GKG taxonomy does not map onto ` +
                        `IPTC MediaTopics. Dropped. Consider category.id, topic.id or industry.id instead.`
                );
            } else {
                this.warn(`Unrecognised GDELT operator "${operator}:" — dropped rather than forwarded.`);
            }
        }

        if (terms.length) {
            out.title = terms.join(' ');
            this.warn(
                `GDELT searches full article text; APITube searches headlines. "${out.title}" now matches ` +
                    `titles only, which returns a different set — re-baseline any threshold built on GDELT counts.`
            );
        }

        if (domains.length) {
            out['source.domain'] = this.capValues(domains, 'source.domain').join(',');
        }

        if (languages.length) {
            out['language.code'] = this.capValues(languages, 'language.code').join(',');
        }

        if (countries.length) {
            out['source.country.code'] = this.capValues(countries, 'source.country.code').join(',');
        }

        return out;
    }

    /** GDELT language name -> ISO 639-1, or null with a warning. */
    languageCode(value) {
        const key = value.toLowerCase();

        if (UNSUPPORTED_LANGUAGES.has(key)) {
            this.warn(
                `sourcelang:${value} has no APITube equivalent — language.code=${key.slice(0, 2)} returns ` +
                    `400 ER0237. There is no substitute; those articles are simply absent.`
            );

            return null;
        }

        const code = LANGUAGE_TO_CODE[key];

        if (!code) {
            this.warn(
                `sourcelang:${value} is not in this kit's verified language table — dropped rather than ` +
                    `guessed. Check it against /v1/news/count and add it if it answers 200.`
            );

            return null;
        }

        return code;
    }

    /** GDELT country label -> ISO 3166 alpha-2, or null with a warning. */
    countryCode(value) {
        const key = value.toLowerCase();

        if (UNSUPPORTED_COUNTRIES.has(key)) {
            this.warn(
                `sourcecountry:${value} has no APITube equivalent — source.country.code returns 400 ER0212. ` +
                    `Those publishers are absent from the index.`
            );

            return null;
        }

        const code = COUNTRY_TO_CODE[key];

        if (!code) {
            this.warn(
                `sourcecountry:${value} is not in this kit's verified country table — dropped rather than ` +
                    `guessed. Check it against /v1/news/count and add it if it answers 200.`
            );

            return null;
        }

        return code;
    }

    /** APITube applies the first 3 values of a comma list and drops the rest without an error. */
    capValues(values, parameter) {
        if (values.length > MAX_MULTI_VALUES) {
            this.warn(
                `${parameter} received ${values.length} values; APITube applies the first ${MAX_MULTI_VALUES} ` +
                    `and drops the rest without an error. Dropped: ${values.slice(MAX_MULTI_VALUES).join(', ')}.`
            );
        }

        return values.slice(0, MAX_MULTI_VALUES);
    }

    translateMaxRecords(maxrecords) {
        if (maxrecords === undefined || maxrecords === null || maxrecords === '') {
            return null;
        }

        const value = Number(maxrecords);

        if (!Number.isFinite(value) || value < 1) {
            this.warn(`maxrecords=${maxrecords} is not a positive number — ignored.`);

            return null;
        }

        if (value > MAX_RECORDS) {
            this.warn(
                `maxrecords=${value} exceeds the maximum of ${MAX_RECORDS} on both APIs. ` +
                    `Capped at ${MAX_RECORDS}. Note GDELT answers this case with HTTP 200 and a plain-text ` +
                    `body, while APITube returns 400 ER0171.`
            );

            return MAX_RECORDS;
        }

        return Math.floor(value);
    }

    checkMode(mode) {
        if (mode === undefined || mode === null || mode === '') {
            return;
        }

        const key = `${mode}`.toLowerCase();

        if (SUPPORTED_MODES.has(key)) {
            return;
        }

        if (key === 'timelinevol' || key.startsWith('timeline')) {
            this.warn(
                `mode=${mode} aggregates over time. APITube's nearest equivalent is a separate endpoint, ` +
                    `/v1/news/trends, with a different response shape — this shim does not translate it.`
            );

            return;
        }

        if (key === 'tonechart') {
            this.warn(
                `mode=tonechart has no APITube endpoint. Per-article sentiment is in every response as ` +
                    `sentiment.overall.score, so the histogram can be computed client-side.`
            );

            return;
        }

        this.warn(`mode=${mode} is a presentation mode with no APITube equivalent — APITube returns data, not layouts.`);
    }

    checkFormat(format) {
        if (format === undefined || format === null || format === '') {
            return;
        }

        const key = `${format}`.toLowerCase();

        if (key !== 'json') {
            this.warn(
                `format=${format} is not produced by this shim, which always returns the JSON shape. ` +
                    `APITube can export csv, tsv, xlsx, xml, rss, jsonl and parquet via export= on the raw API.`
            );
        }
    }

    /** Rebuild GDELT's envelope from an APITube payload. */
    shapeResponse(payload) {
        const results = Array.isArray(payload?.results) ? payload.results : [];

        return {
            articles: results.map(article => this.shapeArticle(article))
        };
    }

    shapeArticle(article) {
        const languageCode = article?.language ?? null;
        const countryCode = article?.source?.country?.code ?? article?.source?.country ?? null;

        return {
            url: article?.href ?? '',
            url_mobile: '',
            title: article?.title ?? '',
            seendate: toGdeltDate(article?.published_at),
            socialimage: article?.image ?? '',
            domain: article?.source?.domain ?? '',
            language: CODE_TO_LANGUAGE[languageCode] ?? languageCode ?? '',
            sourcecountry: CODE_TO_COUNTRY[countryCode] ?? countryCode ?? '',
            _apitube: article
        };
    }

    warn(message) {
        if (typeof this.onWarning === 'function') {
            this.onWarning(message);
        }
    }
}

/**
 * ISO 8601 extended (APITube) -> ISO 8601 basic (GDELT).
 * 2026-07-09T12:00:00.000Z becomes 20260709T120000Z.
 */
export function toGdeltDate(value) {
    if (!value) {
        return '';
    }

    const text = `${value}`;
    const match = text.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/);

    if (!match) {
        return text;
    }

    const [, year, month, day, hour, minute, second] = match;

    return `${year}${month}${day}T${hour}${minute}${second}Z`;
}

export class GdeltShimError extends Error {
    constructor(message, { code, status, requestId, url } = {}) {
        super(message);
        this.name = 'GdeltShimError';
        this.code = code;
        this.status = status;
        this.requestId = requestId;
        this.url = url;
    }
}

export { LANGUAGE_TO_CODE, COUNTRY_TO_CODE, UNSUPPORTED_LANGUAGES, UNSUPPORTED_COUNTRIES, MAX_RECORDS };
