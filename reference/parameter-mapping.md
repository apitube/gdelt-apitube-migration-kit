# Parameter mapping

Every row below was executed against both live APIs on 27 July 2026. Parameters GDELT documents but that this kit has not yet been able to execute are listed at the bottom, unmapped — GDELT's throttling makes verification slow, and an unverified mapping is worse than a missing one.

Base URLs:

```
GDELT     https://api.gdeltproject.org/api/v2/doc/doc
APITube   https://api.apitube.io/v1/news/everything
```

## Request parameters

| GDELT | APITube | Fidelity | Note |
|-------|---------|----------|------|
| `query` | `title` or `query` | ⚠️ Partial | GDELT searches full text, APITube searches headlines — see below |
| `mode=artlist` | *(the default)* | ✅ Exact | `/v1/news/everything` returns an article list |
| `mode=timelinevol` | `/v1/news/trends` | ⚠️ Partial | Different endpoint, different response shape |
| `mode=tonechart` | — | ❌ Dropped | No sentiment-histogram endpoint |
| `format=json` | *(always JSON)* | ✅ Exact | APITube also offers `export=csv/xlsx/parquet/jsonl/rss/xml` |
| `maxrecords` | `per_page` | ✅ Exact | Both cap at 250 |
| — | `page` | ➕ New | GDELT has no paging: `maxrecords` is all you get |
| — | `sort.by` / `sort.order` | ➕ New | |
| — | `published_at.start` / `.end` | ➕ New | GDELT's date parameters are not yet verified here |

### `maxrecords` → `per_page`

The one parameter that maps cleanly, including its ceiling:

```bash
# GDELT
curl "https://api.gdeltproject.org/api/v2/doc/doc?query=tesla&mode=artlist&format=json&maxrecords=250"

# APITube
curl "https://api.apitube.io/v1/news/everything?title=tesla&per_page=250" -H "X-API-Key: YOUR_API_KEY"
```

Both refuse 251, and the *way* they refuse is the difference this kit keeps coming back to:

| | Over the limit |
|---|---|
| GDELT | `200` + the plain-text line `A maximum of 250 records can be returned.` |
| APITube | `400` + `{"errors":[{"code":"ER0171","message":"Limit is out of range. Your plan allows up to 250 results per page."}]}` |

**Paging is the bigger change.** GDELT returns up to 250 records and stops; there is no offset, no cursor, no page number. If your query matches more, you narrow the query — usually by slicing the date range — and run it again. APITube has `page`, so the loop is an ordinary paging loop.

## Query operators

GDELT packs its filters into the `query` string. APITube uses named parameters. Verified working on both sides:

| GDELT operator | APITube | Fidelity |
|----------------|---------|----------|
| `domain:bbc.co.uk` | `source.domain=bbc.co.uk` | ✅ Exact |
| `sourcelang:english` | `language.code=en` | ⚠️ **Name → code** |
| `sourcecountry:US` | `source.country.code=us` | ⚠️ **Different code system** |
| `theme:ECON_STOCKMARKET` | — | ❌ No themes taxonomy |

### `sourcelang:` and `sourcecountry:` need conversion, not renaming

GDELT accepts English language names (`sourcelang:english`) and its own country labels. APITube takes ISO codes. Forwarding the GDELT value produces a `400`, and which `400` tells you what broke:

| What you send to APITube | Response |
|---|---|
| `language.code=english` | `400 ER0061` — "must be between 1 and 2 characters" |
| `language.code=en` | `200` |
| `source.country.code=Serbia` | `400 ER0246` — "must be 2 characters" |
| `source.country.code=rs` | `200`, 319 547 articles |
| `source.country.code=zz` | `400 ER0212` — "not found" |

A **length** error means a GDELT value was forwarded without conversion. A **not-found** error means your lookup table produced a code APITube does not carry. The first is a bug in your code, the second is a real coverage gap — handle them separately.

### `theme:` has no counterpart

GDELT's themes come from the GKG taxonomy — several thousand codes like `ECON_STOCKMARKET`, `ENV_CLIMATECHANGE`, `TAX_DISEASE`. APITube classifies on three axes instead:

| | GDELT | APITube |
|---|---|---|
| Themes | `theme:` — GKG taxonomy | — |
| Subject | — | `category.id` — IPTC MediaTopics |
| Editorial topic | — | `topic.id` |
| Industry sector | — | `industry.id` |

These overlap but do not correspond. `theme:ECON_STOCKMARKET` is roughly `category.id=medtop:04000000` (economy, business and finance) plus `industry.id` for the sector — but "roughly" is doing real work in that sentence, and this kit does not publish a theme-to-IPTC table because it cannot verify one at GDELT's current request rate.

If your queries lean on `theme:`, treat that as an open migration question, not a solved one.

## Search scope: the conversion that changes your results

`query=tesla` on GDELT searches **full article text in 65+ languages**. `title=tesla` on APITube searches **headlines**.

A live GDELT response for `query=tesla` returned, among its first results, a Serbian article about the Nikola Tesla Museum's opening hours and a Chinese article about a toy car. Neither is about the company; both contain the word.

So the conversion narrows on one axis and widens on another, and no parameter setting reconciles them:

- **Narrower**, because a headline mention is a higher bar than a body mention.
- **Wider**, because APITube indexes more publishers per language.

Any threshold, alert or dashboard number carried over from GDELT will move. Re-baseline rather than assuming a bug.

## Not yet verified

GDELT documents these; this kit has not executed them, so it does not map them:

`timespan`, `startdatetime`, `enddatetime`, `sort`, `tone` / `tonesimple`, `imagewebtag`, `imageocrmeta`, and the presentation modes (`artgallery`, `imagecollage`, `wordcloud`, `timelinetone`, `timelinelang`, `timelinesourcecountry`).

They will be added as each one is executed against both APIs. The reason for the delay is in [`limitations.md`](limitations.md): GDELT applies a sustained per-IP penalty that has, at time of writing, refused every request for about an hour after roughly 60 requests spread over 90 minutes.
