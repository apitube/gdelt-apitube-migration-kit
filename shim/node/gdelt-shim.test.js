import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GdeltShim, GdeltShimError, toGdeltDate } from './gdelt-shim.js';

const silent = () => new GdeltShim({ apiKey: 'test', onWarning: () => {} });
const recording = () => {
    const warnings = [];

    return [new GdeltShim({ apiKey: 'test', onWarning: message => warnings.push(message) }), warnings];
};

test('requires an API key', () => {
    assert.throws(() => new GdeltShim({}), /apiKey is required/);
});

test('a bare query becomes a title search', () => {
    const params = silent().translateParams({ query: 'tesla' });

    assert.equal(params.title, 'tesla');
});

test('warns that headline search is narrower than GDELT full text', () => {
    const [shim, warnings] = recording();

    shim.translateParams({ query: 'tesla' });

    assert.ok(warnings.some(w => /headlines/.test(w)));
});

test('domain: becomes source.domain', () => {
    const params = silent().translateParams({ query: 'tesla domain:bbc.co.uk' });

    assert.equal(params['source.domain'], 'bbc.co.uk');
    assert.equal(params.title, 'tesla');
});

test('sourcelang: maps an English name to an ISO code', () => {
    const params = silent().translateParams({ query: 'tesla sourcelang:english' });

    assert.equal(params['language.code'], 'en');
});

test('sourcelang is case-insensitive', () => {
    const params = silent().translateParams({ query: 'tesla sourcelang:Serbian' });

    assert.equal(params['language.code'], 'sr');
});

test('sourcecountry: maps a country label to an ISO code', () => {
    const params = silent().translateParams({ query: 'tesla sourcecountry:US' });

    assert.equal(params['source.country.code'], 'us');
});

test('United Kingdom maps to gb, not uk', () => {
    const params = silent().translateParams({ query: 'tesla sourcecountry:"United Kingdom"' });

    assert.equal(params['source.country.code'], 'gb');
});

test('a quoted multi-word country stays one token', () => {
    const params = silent().translateParams({ query: 'tesla sourcecountry:"South Korea"' });

    assert.equal(params['source.country.code'], 'kr');
    assert.equal(params.title, 'tesla');
});

test('Russian is dropped with an explanation, not silently', () => {
    const [shim, warnings] = recording();
    const params = shim.translateParams({ query: 'tesla sourcelang:russian' });

    assert.equal(params['language.code'], undefined);
    assert.ok(warnings.some(w => /ER0237/.test(w)));
});

test('Russia as a country is dropped with an explanation', () => {
    const [shim, warnings] = recording();
    const params = shim.translateParams({ query: 'tesla sourcecountry:russia' });

    assert.equal(params['source.country.code'], undefined);
    assert.ok(warnings.some(w => /ER0212/.test(w)));
});

test('an unverified language is dropped rather than guessed', () => {
    const [shim, warnings] = recording();
    const params = shim.translateParams({ query: 'tesla sourcelang:esperanto' });

    assert.equal(params['language.code'], undefined);
    assert.ok(warnings.some(w => /rather than\s+guessed|rather than guessed/.test(w)));
});

test('theme: is dropped with a pointer to the three APITube axes', () => {
    const [shim, warnings] = recording();
    const params = shim.translateParams({ query: 'tesla theme:ECON_STOCKMARKET' });

    assert.equal(Object.keys(params).some(k => k.includes('theme')), false);
    assert.ok(warnings.some(w => /category\.id/.test(w)));
});

test('an unknown operator is dropped, never forwarded', () => {
    const [shim, warnings] = recording();
    const params = shim.translateParams({ query: 'tesla imagewebtag:foo' });

    assert.equal(params.imagewebtag, undefined);
    assert.ok(warnings.some(w => /Unrecognised GDELT operator/.test(w)));
});

test('no GDELT parameter name ever reaches APITube', () => {
    const params = silent().translateParams({
        query: 'tesla',
        mode: 'artlist',
        format: 'json',
        maxrecords: 50,
        timespan: '1d',
        sort: 'datedesc'
    });

    for (const forbidden of ['query', 'mode', 'format', 'maxrecords', 'timespan', 'sort']) {
        assert.equal(params[forbidden], undefined, `${forbidden} must not be forwarded`);
    }
});

test('maxrecords becomes per_page', () => {
    const params = silent().translateParams({ query: 'tesla', maxrecords: 50 });

    assert.equal(params.per_page, 50);
});

test('maxrecords above 250 is capped and explained', () => {
    const [shim, warnings] = recording();
    const params = shim.translateParams({ query: 'tesla', maxrecords: 251 });

    assert.equal(params.per_page, 250);
    assert.ok(warnings.some(w => /ER0171/.test(w)));
});

test('a fourth filter value is dropped with a warning', () => {
    const [shim, warnings] = recording();
    const params = shim.translateParams({
        query: 'tesla domain:a.com domain:b.com domain:c.com domain:d.com'
    });

    assert.equal(params['source.domain'], 'a.com,b.com,c.com');
    assert.ok(warnings.some(w => /drops the rest without an error/.test(w)));
});

test('unverified date and sort parameters are dropped, not guessed', () => {
    const [shim, warnings] = recording();

    shim.translateParams({ query: 'tesla', timespan: '1d', startdatetime: '20260720000000' });

    assert.ok(warnings.some(w => /timespan/.test(w) && /not been verified/.test(w)));
    assert.ok(warnings.some(w => /startdatetime/.test(w)));
});

test('mode=timelinevol points at the trends endpoint instead of pretending', () => {
    const [shim, warnings] = recording();

    shim.translateParams({ query: 'tesla', mode: 'timelinevol' });

    assert.ok(warnings.some(w => /\/v1\/news\/trends/.test(w)));
});

test('mode=tonechart suggests computing the histogram client-side', () => {
    const [shim, warnings] = recording();

    shim.translateParams({ query: 'tesla', mode: 'tonechart' });

    assert.ok(warnings.some(w => /sentiment\.overall\.score/.test(w)));
});

test('a non-JSON format warns rather than failing later', () => {
    const [shim, warnings] = recording();

    shim.translateParams({ query: 'tesla', format: 'csv' });

    assert.ok(warnings.some(w => /export=/.test(w)));
});

test('toGdeltDate converts extended ISO to GDELT basic', () => {
    assert.equal(toGdeltDate('2026-07-09T12:00:00.000Z'), '20260709T120000Z');
    assert.equal(toGdeltDate('2026-07-27T07:40:49Z'), '20260727T074049Z');
});

test('toGdeltDate leaves an unrecognised value alone', () => {
    assert.equal(toGdeltDate('not a date'), 'not a date');
    assert.equal(toGdeltDate(null), '');
});

test('an APITube payload is reshaped into GDELT article fields', () => {
    const shaped = silent().shapeResponse({
        results: [
            {
                id: 3067099440,
                title: 'Tesla robotaxi rollout slips',
                href: 'https://www.bbc.co.uk/news/1',
                published_at: '2026-07-27T07:40:49.000Z',
                image: 'https://img/1.jpg',
                language: 'en',
                source: { domain: 'bbc.co.uk', country: { code: 'gb' } }
            }
        ]
    });

    const [article] = shaped.articles;

    assert.equal(article.url, 'https://www.bbc.co.uk/news/1');
    assert.equal(article.title, 'Tesla robotaxi rollout slips');
    assert.equal(article.seendate, '20260727T074049Z');
    assert.equal(article.socialimage, 'https://img/1.jpg');
    assert.equal(article.domain, 'bbc.co.uk');
    assert.equal(article.language, 'English');
    assert.equal(article.sourcecountry, 'United Kingdom');
    assert.equal(article.url_mobile, '');
});

test('the full APITube article is kept under _apitube rather than discarded', () => {
    const shaped = silent().shapeResponse({
        results: [{ title: 'x', href: 'https://e/1', sentiment: { overall: { score: 0.4 } } }]
    });

    assert.equal(shaped.articles[0]._apitube.sentiment.overall.score, 0.4);
});

test('an empty payload yields an empty article list, not a crash', () => {
    assert.deepEqual(silent().shapeResponse({}), { articles: [] });
});

test('doc() sends the key as a header and returns the GDELT shape', async () => {
    let seenUrl = null;
    let seenHeaders = null;

    const shim = new GdeltShim({
        apiKey: 'secret',
        onWarning: () => {},
        fetch: async (url, options) => {
            seenUrl = url;
            seenHeaders = options.headers;

            return {
                json: async () => ({
                    results: [{ title: 'a', href: 'https://e/1', language: 'en', source: { domain: 'e' } }]
                })
            };
        }
    });

    const result = await shim.doc({ query: 'tesla domain:e', maxrecords: 10 });

    assert.match(seenUrl, /\/v1\/news\/everything\?/);
    assert.match(seenUrl, /title=tesla/);
    assert.match(seenUrl, /per_page=10/);
    assert.equal(seenHeaders['X-API-Key'], 'secret');
    assert.equal(result.articles[0].domain, 'e');
});

test('an APITube error becomes a typed exception carrying the code', async () => {
    const shim = new GdeltShim({
        apiKey: 'secret',
        onWarning: () => {},
        fetch: async () => ({
            json: async () => ({
                status: 'not_ok',
                request_id: 'req-9',
                errors: [{ status: 400, code: 'ER0171', message: 'Limit is out of range. Your plan allows up to 250 results per page.' }]
            })
        })
    });

    await assert.rejects(
        () => shim.doc({ query: 'tesla' }),
        error => error instanceof GdeltShimError && error.code === 'ER0171' && error.requestId === 'req-9'
    );
});
