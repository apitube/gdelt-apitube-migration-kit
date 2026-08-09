# GDELT Migration Kit

### GDELT DOC 2.0 API → APITube News API

Parameter tables, response field mapping, query-operator translation, a drop-in compatibility shim in Node.js and Python, and an AI prompt that rewrites your queries. Every mapping here was verified against **both** live APIs — GDELT needs no key, so unlike the other kits in this series, both sides of every claim were executed rather than read from documentation.

**Keywords:** gdelt alternative, gdelt doc 2.0 api migration, api.gdeltproject.org replacement, news api with article body, gdelt commercial alternative

---

## Read this first

GDELT and APITube are not the same kind of product, and the difference decides whether you should migrate at all.

**GDELT is a free research dataset.** No key, no contract, no support, 65+ languages, full-text search, and a rolling window of roughly the last three months. It returns *metadata about* articles — a link, a headline, a date, a domain — and nothing else.

**APITube is a commercial news API.** It returns the article itself, plus entities, sentiment, categories, readability and publisher metadata, under a licence you can build a product on.

| | GDELT DOC 2.0 | APITube |
|---|---|---|
| **Key required** | No | Yes |
| **Cost** | Free | Paid, free tier available |
| **Rate limit** | 1 request per 5 seconds *(documented; in practice stricter — see below)* | 50/minute paid, 10/minute free |
| **Records per request** | 250 | 250 |
| **Search scope** | Full article text, 65+ languages | Headlines |
| **Article body** | **Not returned** | `body` and `body_html` |
| **Fields per article** | 8 | Dozens |
| **Language value** | English name — `"Serbian"` | ISO 639-1 — `sr` |
| **Country value** | English name — `"Serbia"` | ISO 3166 — `rs` |
| **Errors** | **HTTP 200 with a plain-text body** | JSON with a status and an error code |

**Migrate if** you need the article text, commercial licensing, enrichment, or a rate limit that supports production traffic.

**Stay on GDELT if** you need its 65-language full-text reach, its themes taxonomy, or its tone timelines — and your budget is zero. Nothing in this kit will replace GDELT's global research coverage.

**Many teams run both.** The shim is built to sit next to your existing GDELT client, not to replace it.

**The hard blocker, stated up front:** APITube has **no Russian and no Ukrainian**, on either axis. `language.code=ru` and `=uk` return `400 ER0237`; `source.country.code=ru` returns `400 ER0212`. GDELT covers both. Verified — one 250-article GDELT sample carried Russian articles that have no counterpart here. If your work touches Russian-language press, measure your own share before committing: [`reference/language-country-mapping.md`](reference/language-country-mapping.md) shows how.

## The two traps, up front

### 1. GDELT signals errors with HTTP 200

Ask for more than the maximum and you get a **`200`** whose body is not JSON:

```bash
curl "https://api.gdeltproject.org/api/v2/doc/doc?query=tesla&mode=artlist&format=json&maxrecords=251"
# HTTP 200
# A maximum of 250 records can be returned.
```

Any client that checks `response.ok` and then calls `.json()` will pass the status check and throw on the parse. Rate limiting behaves the same way — the body is prose, not a JSON error object.

APITube returns a real status code and a structured error:

```json
{"status":"not_ok","errors":[{"status":400,"code":"ER0171","message":"Limit is out of range. Your plan allows up to 250 results per page."}]}
```

If your GDELT client has a `try/except` around JSON parsing that treats a parse failure as "no results", it is currently hiding both of these conditions. That code path stops being needed after the migration — but check what it was swallowing first.

### 2. The rate limit is stricter than the message claims

The 429 body reads "Please limit requests to one every 5 seconds". Measured on 27 July 2026, that is optimistic. At a 6-second interval 1 request of 7 got through. At 16 seconds, 4 of 12. At 60 seconds, 3 of 8. **At 150 seconds, 0 of 3** — including a request for three records.

Backing off made it worse, not better. The decisive test: seven `maxrecords=5` requests spaced 5 minutes apart over 35 minutes — **none succeeded**. A quiet period of ~25 minutes cleared the block once, and failed to clear it later in the same session, so this kit publishes no recovery figure: the window appears to lengthen as usage accumulates.

That inverts the usual instinct: on `429`, retrying more slowly is what keeps you blocked, and there is no interval short enough to be useful that helps. Plan a large GDELT walk as something you cannot finish in one sitting from one IP. [`reference/limitations.md`](reference/limitations.md) has the full series, including the size and interval hypotheses this ruled out.

There is also no way to distinguish "throttled" from "no results" without reading the response body, because both arrive without a JSON error object. If your monitoring counts articles returned, a silent throttle looks like zero coverage rather than an outage.

Practically, GDELT sustains a few requests per minute; APITube's paid tier allows 50. If you are moving a backfill job, that ratio is the single biggest change to your runtime.

## What is in here

| Path | What it gives you |
|------|-------------------|
| [`reference/parameter-mapping.md`](reference/parameter-mapping.md) | Request parameters and query operators → their APITube equivalent, plus the ones not yet verified |
| [`reference/language-country-mapping.md`](reference/language-country-mapping.md) | GDELT's English names → ISO codes, each executed against APITube, and the language-mix shift to expect |
| [`reference/response-mapping.md`](reference/response-mapping.md) | All eight GDELT fields → their APITube counterpart, and the 18 fields APITube adds |
| [`reference/limitations.md`](reference/limitations.md) | What does not carry over, plus live API quirks on both sides |
| [`shim/node/`](shim/node/) | `GdeltShim` — accepts DOC 2.0 parameters, returns the GDELT response shape (29 tests) |
| [`shim/python/`](shim/python/) | The same shim for Python (29 tests, byte-identical parameter output) |
| [`tools/ai-migration-prompt.md`](tools/ai-migration-prompt.md) | System prompt for Claude/ChatGPT that converts your queries — and refuses the ones that cannot convert |

Remaining reference tables are being added as each mapping is verified against both live APIs. Nothing is written here before it has been executed — which, given GDELT's throttling, is slower than it sounds. Parameters this kit has not managed to execute are listed as unmapped rather than guessed, and the shim drops them with a warning rather than inventing a translation.

### Using the shim

```js
import { GdeltShim } from './shim/node/gdelt-shim.js';

const client = new GdeltShim({ apiKey: process.env.APITUBE_API_KEY });

// The same parameters your existing GDELT code already passes
const response = await client.doc({
    query: 'tesla domain:bbc.co.uk sourcelang:english',
    mode: 'artlist',
    format: 'json',
    maxrecords: 50
});

for (const article of response.articles) {
    console.log(article.title, '—', article.domain, article.seendate);
    console.log(article._apitube.sentiment.overall.score);  // not available on GDELT
}
```

It reproduces the `{ articles: [...] }` envelope with all eight GDELT fields, converts `sourcelang:english` to `language.code=en` and `sourcecountry:"United Kingdom"` to `source.country.code=gb`, reformats dates back to GDELT's `20260727T074049Z` shape, and **warns on every lossy conversion** — a dropped `theme:`, a Russian-language filter with no counterpart, a fourth value silently discarded by APITube's three-value cap. The full APITube article stays on `_apitube`, so nothing is thrown away on the way through.

## Endpoint mapping at a glance

| GDELT | APITube | Notes |
|-------|---------|-------|
| `/api/v2/doc/doc?mode=artlist` | `/v1/news/everything` | The workhorse |
| `/api/v2/doc/doc?mode=timelinevol` | `/v1/news/trends` | Aggregation, different shape |
| `/api/v2/doc/doc?mode=tonechart` | — | No sentiment-histogram endpoint |
| — | `/v1/news/count` | GDELT has no count-only mode |

## Documentation

- [APITube parameters reference](https://docs.apitube.io/platform/news-api/parameters)
- [Migration guide](https://docs.apitube.io/platform/migrations/)
- [GDELT DOC 2.0 API announcement](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/)

## License

MIT
