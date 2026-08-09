# What does not carry over

Everything here was executed against both live APIs on 27 July 2026 — GDELT at `https://api.gdeltproject.org/api/v2/doc/doc` (no key) and APITube at `https://api.apitube.io`. Claims that could not be executed are not in this file.

## Things that fail silently

### GDELT reports errors with HTTP 200 and a plain-text body

```bash
curl "https://api.gdeltproject.org/api/v2/doc/doc?query=tesla&mode=artlist&format=json&maxrecords=251"
```

```
HTTP/1.1 200 OK
A maximum of 250 records can be returned.
```

Status `200`, `Content-Type` notwithstanding, body is prose. A client that checks the status and then parses JSON passes the first test and throws on the second. Whatever handles that exception in your current code is the thing to look at before migrating — if it treats a parse failure as "zero results", it has been hiding this condition and the rate-limit condition alike.

APITube fails loudly instead. The same over-limit request:

```bash
curl "https://api.apitube.io/v1/news/everything?per_page=251" -H "X-API-Key: YOUR_API_KEY"
# {"status":"not_ok","errors":[{"status":400,"code":"ER0171","message":"Limit is out of range. Your plan allows up to 250 results per page."}]}
```

### APITube ignores parameters it does not recognise

The mirror-image trap, and the reason the shim keeps an allow-list rather than forwarding names through. A leftover `query=`, `mode=`, `maxrecords=` or `timespan=` is dropped and the request answers `200` with the whole index — a successful-looking response containing unfiltered news.

Never forward a GDELT parameter name.

## Rate limits: the biggest practical change

GDELT's throttle message says one request every 5 seconds. Measured:

| Interval between requests | Requests that got through |
|---|---|
| 6 seconds | 1 of 7 |
| 16 seconds | 4 of 12 |
| 60 seconds | 3 of 8 |
| **150 seconds** | **0 of 3** |

Read the last row carefully, because it is the one that matters. Two and a half minutes between requests, and every one refused — including a request for **three** records. By then the client had been making requests for roughly half an hour.

So this is not an interval limit and not a size limit. Both were tested and both were ruled out:

- **Not size.** A `maxrecords=3` request was refused in the same window a `maxrecords=250` request was refused. An earlier run where small requests passed and large ones failed turned out to be a coincidence of timing, not a rule.
- **Not a fixed interval.** Backing off from 6 to 16 to 60 to 150 seconds made the success rate *worse*, not better, because the penalty accumulated over the session faster than the backoff relieved it.

What it looks like is a sustained per-IP penalty that builds with total usage and then persists.

The decisive measurement was a 35-minute run of `maxrecords=5` requests — the smallest useful query — one every 5 minutes:

| | Result |
|---|---|
| 7 requests, 5 minutes apart, over 35 minutes | **0 succeeded** |
| 1 request after ~25 minutes of complete silence | succeeded (once) |
| 1 request after ~25 minutes of silence, later the same session | **refused** |

Note the last two rows carefully. A quiet period of roughly 25 minutes cleared the block **once**, and the same quiet period failed to clear it later in the same session. So the recovery window is not a fixed number, and this kit does not publish one — it appears to lengthen as session usage accumulates.

What does hold across every measurement: **more requests make it worse, and no request interval short enough to be useful makes it better.** Polling every five minutes never cleared it in 35 minutes of trying.

The practical consequence is the opposite of normal backoff instinct. When a client sees `429`, the reflex is to retry more slowly — every 60 seconds, then every 5 minutes. Here that reflex is what keeps you locked out; only stopping entirely helps, and possibly for longer than you expect.

Two more numbers for scale: the traffic that triggered the penalty in the first place was roughly 60 requests spread over 90 minutes — not a flood — and a single `maxrecords=250` request bought at least 7 minutes of lockout on its own.

**Plan for this rather than working around it.** If you need to walk a large GDELT query set — to convert it, to compare counts, to validate a migration — assume you cannot do it in one sitting from one IP, and that no retry policy will change that.

**What this means for a migration.** Two things, and the second is easy to miss:

1. Any tool that walks your GDELT query history to convert it — including this kit's own AI prompt — cannot verify those queries against GDELT at any useful speed. Budget hours, not minutes.
2. A throttled response is indistinguishable from an empty one without reading the body, because neither carries a JSON error object. If your monitoring counts "articles returned" and you have been silently throttled, the graph shows zero coverage, not an outage.

APITube allows 50 requests per minute on a paid key and 10 on the free tier. Its `429` is a real status code carrying a JSON error, against a documented per-minute budget — so backoff behaves the way backoff is supposed to, and retrying does not extend the block.

For a backfill job this ratio, not the field mapping, is what changes your runtime.

## Fields GDELT does not have

`mode=artlist` returns exactly eight fields per article:

```json
{
  "url": "https://www.blic.rs/vesti/beograd/...",
  "url_mobile": "",
  "title": "Besplatan ulaz u Muzej Nikole Tesle za njegov 170. rođendan",
  "seendate": "20260709T120000Z",
  "socialimage": "https://ocdn.eu/...",
  "domain": "blic.rs",
  "language": "Serbian",
  "sourcecountry": "Serbia"
}
```

No body, no description, no author, no sentiment, no entities, no categories, no counts. If your pipeline scrapes the `url` to get the text — which is the usual reason to leave GDELT — that stage disappears entirely: APITube returns `body` and `body_html` in the same response.

## Values that need a lookup table, not a rename

Two fields carry English names where APITube expects codes:

| GDELT | APITube | |
|---|---|---|
| `language: "Serbian"` | `language.code=sr` | ISO 639-1 |
| `sourcecountry: "Serbia"` | `source.country.code=rs` | ISO 3166 alpha-2 |
| `seendate: "20260709T120000Z"` | `published_at` | GDELT drops the separators |
| `domain: "blic.rs"` | `source.domain` | Same form |

The first two are the ones that break a naive port: passing `"Serbian"` to `language.code` is not a valid ISO code, and APITube rejects values longer than two characters with `400 ER0061`.

`seendate` also needs reformatting — `20260709T120000Z` is ISO 8601 basic format, and APITube's date filters take the extended form with hyphens and colons.

## Search scope is not comparable

GDELT searches **full article text across 65+ languages** by default. APITube searches **headlines**.

An unfiltered `query=tesla` on GDELT returned, among the first results, a Serbian article about the Nikola Tesla Museum's opening hours and a Chinese article about a toy car. Neither would match an APITube `title=tesla` query in English, and neither is about the company.

Two consequences:

- **Counts are not comparable.** Any dashboard number that came from GDELT will move, in both directions — down because headline search is narrower than full text, up because APITube indexes more publishers.
- **Language filtering becomes load-bearing.** On GDELT it was optional; on APITube, without `language.code`, you are searching headlines in every language the index holds.

## Modes with no APITube counterpart

| GDELT mode | APITube | |
|---|---|---|
| `artlist` | `/v1/news/everything` | Direct |
| `timelinevol` | `/v1/news/trends` | Aggregation, different response shape |
| `tonechart` | — | No sentiment-histogram endpoint. APITube gives per-article sentiment, so the histogram can be computed client-side |
| `artgallery`, `imagecollage`, `wordcloud` | — | Presentation modes; APITube returns data, not layouts |

`tonechart` returns bins with counts and sample articles:

```json
{"tonechart": [{"bin": -26, "count": 1, "toparts": [{"url": "..."}]}]}
```

APITube has no equivalent endpoint, but `sentiment.overall.score` on each article carries the same information at a finer grain.

## What APITube adds

None of this exists in GDELT's DOC API:

- Full article `body` and `body_html`
- Named entities with Wikidata links, occurrence counts and **sentiment towards each entity**
- Sentiment on title, body and overall, scored separately
- IPTC MediaTopics plus topic and industry axes
- Publisher political bias and Open Page Rank
- Readability scores
- `is_duplicate` and `story.id` for cross-publisher deduplication
- Export to CSV, XLSX, Parquet, JSONL, RSS, XML
- A commercial licence

## Where APITube is behind

Stated plainly, because the decision depends on it:

- **No 65-language full-text search.** GDELT's reach across small-language press is not reproducible here.
- **No themes taxonomy.** GDELT's `theme:` operator (`ECON_STOCKMARKET` and several thousand others) has no direct counterpart; `category.id`, `topic.id` and `industry.id` cover part of the same ground with a different taxonomy.
- **No Russian and no Ukrainian.** `language.code=ru` and `uk` return `400 ER0237`.
- **It costs money.** GDELT does not.
