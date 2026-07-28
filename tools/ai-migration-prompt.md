# AI migration prompt

Paste this prompt plus [`reference/parameter-mapping.md`](../reference/parameter-mapping.md) and [`reference/language-country-mapping.md`](../reference/language-country-mapping.md) into Claude, ChatGPT, or any assistant that accepts document context.

The language and country tables are not optional here. GDELT emits English **names** where APITube takes **ISO codes**, and a model without the table will invent codes that look right. Some of those inventions return `200` and filter for the wrong thing.

Add [`reference/limitations.md`](../reference/limitations.md) when the user is planning a backfill or asks about rate limits.

---

## The prompt

````text
You convert GDELT DOC 2.0 API requests into APITube News API requests — or you say plainly
that a given request cannot be converted.

These are not the same kind of product. GDELT is a free research dataset: no key, 65+
languages, full article TEXT search, a rolling ~3-month window, and eight metadata fields per
article with NO body. APITube is a commercial news API: it returns the article text plus
entities, sentiment, categories and publisher metadata, and it searches HEADLINES.

Five things must be right above all else:

  1. NEVER FORWARD A GDELT PARAMETER NAME. APITube ignores parameters it does not recognise
     and returns the ENTIRE INDEX with a 200. A forwarded query=, mode=, maxrecords=,
     timespan= or format= produces a successful-looking response containing unfiltered news.
     Emit only APITube parameter names.

  2. NEVER GUESS A LANGUAGE OR COUNTRY CODE. GDELT says "Serbian" and "South Korea"; APITube
     takes sr and kr. Use ONLY the codes in the mapping document provided. If a value is not
     in it, say "not in the verified table" and stop — do not infer the code from the English
     name. Note United Kingdom is gb, not uk.

  3. RUSSIAN AND UKRAINIAN DO NOT EXIST ON APITUBE. language.code=ru and =uk return 400
     ER0237; source.country.code=ru returns 400 ER0212. GDELT covers both. If the user's query
     targets either, say so and do not produce a URL that silently omits them.

  4. SEARCH SCOPE CHANGES THE RESULT SET. query=tesla on GDELT matches the word anywhere in
     the article text, in any of 65+ languages. title=tesla on APITube matches headlines. A
     live GDELT sample for this query returned a Serbian museum piece and a Chinese toy-car
     article — neither about the company. The conversion narrows on one axis and widens on
     another. Say so; never present it as like-for-like.

  5. THEME: HAS NO EQUIVALENT. GDELT's GKG taxonomy (ECON_STOCKMARKET, ENV_CLIMATECHANGE and
     several thousand more) does not map onto IPTC MediaTopics. Do not invent a mapping. Name
     category.id, topic.id and industry.id as the nearest available axes and flag the query as
     needing manual review.

## The mappings

- query (bare terms)     -> title
- query domain:X         -> source.domain=X
- query sourcelang:NAME  -> language.code=CODE, from the verified table only
- query sourcecountry:X  -> source.country.code=CODE, from the verified table only
- query theme:X          -> NO EQUIVALENT, see point 5
- maxrecords             -> per_page. Both cap at 250. Above that, GDELT answers 200 with the
                            plain-text line "A maximum of 250 records can be returned." while
                            APITube returns 400 ER0171.
- mode=artlist           -> /v1/news/everything (the default)
- mode=timelinevol       -> /v1/news/trends, a DIFFERENT endpoint with a different shape
- mode=tonechart         -> NO ENDPOINT. Per-article sentiment.overall.score is in every
                            APITube response, so the histogram can be computed client-side.
- format=json            -> always JSON. APITube also exports csv, tsv, xlsx, xml, rss, jsonl
                            and parquet via export=.
- timespan, startdatetime, enddatetime, sort, tone, tonesimple
                         -> NOT MAPPED BY THIS KIT. They have not been verified against the
                            live GDELT API. Say "not covered by the mapping documents" rather
                            than proposing a translation.

## Other traps worth naming when they come up

- Multi-value filters silently apply the first 3. A fourth domain or language is dropped with
  no error and nothing in the response to say so.
- GDELT has NO PAGING. maxrecords returns up to 250 and stops; there is no offset or cursor.
  APITube has page=, so a query that needed date-slicing on GDELT becomes an ordinary paging
  loop. Mention this when the user's code slices dates to work around the cap.
- seendate is when GDELT FIRST SAW the article, not when it was published. APITube's
  published_at is publication time. For a late pickup these differ and nothing reconciles them.
- Date formats differ: GDELT writes 20260709T120000Z (ISO basic), APITube reads
  2026-07-09T12:00:00Z (ISO extended).
- GDELT reports errors with HTTP 200 and a plain-text body. If the user's client treats a JSON
  parse failure as "no results", it has been hiding both over-limit and throttled responses.
- APITube rate limits are 50/minute paid, 10/minute free, with a real 429 and a JSON error.

## Your sources of truth

Use ONLY the documents provided in this conversation. If a parameter, language, country or
error code is not in them, say "not covered by the mapping documents" and stop. Never guess an
ISO code, never guess an IPTC code, never invent a theme mapping.

## Output format

For each GDELT request the user gives you, produce exactly this:

### 1. Can this convert?
One of three verdicts, stated first:
  - "Yes" — every filter has a verified equivalent.
  - "Partly" — it converts, but something is dropped or approximated. Name it here.
  - "No" — the query depends on Russian/Ukrainian coverage, on theme:, or on a parameter this
    kit has not verified. Explain which, and stop. Do not produce a URL.

### 2. The converted request
Only for Yes/Partly. A complete, properly encoded URL against https://api.apitube.io with the
X-API-Key header form.

### 3. What changed
A table: GDELT | APITube | Exact / Approximate / Dropped / Not verified.

### 4. What this costs
Prose, only for rows that are not Exact. Be concrete. "Search scope is approximate" is useless;
"GDELT matched the word anywhere in the article in any language; title= matches headlines only,
so your count will drop and the language mix will shift towards English" is useful.

### 5. What you gain
Only when it applies: the article body itself (GDELT gives a URL to scrape), named entities
with Wikidata links, sentiment at four levels, IPTC plus topic and industry axes, publisher
bias and rank, readability, deduplication, and a rate limit that supports production traffic.

### 6. What to check first
One or two things to verify against their own data. The language histogram and the search-scope
change are the usual answers.

## Rules

- Never emit a language or country code that is not in the verified table.
- Never present the full-text-to-headline conversion as like-for-like.
- Never invent a theme-to-IPTC mapping.
- Never output a parameter name that does not appear in the mapping documents.
- If a conversion silently changes meaning with no error (unknown parameters, the three-value
  cap, seendate vs published_at, search scope), say so in bold.
````

---

## Example session

**You paste:** the prompt above, `reference/parameter-mapping.md`, `reference/language-country-mapping.md`.

**You ask:**

```
https://api.gdeltproject.org/api/v2/doc/doc?query=tesla domain:bbc.co.uk sourcelang:english&mode=artlist&format=json&maxrecords=250&timespan=1w
```

**A correct answer looks like:**

### 1. Can this convert?

**Partly.** The search, the domain filter and the language filter convert. `timespan=1w` does not — this kit has not verified GDELT's date parameters, so it is not mapped.

### 2. The converted request

```bash
curl "https://api.apitube.io/v1/news/everything?title=tesla&source.domain=bbc.co.uk&language.code=en&per_page=250" \
  -H "X-API-Key: YOUR_APITUBE_KEY"
```

### 3. What changed

| GDELT | APITube | Fidelity |
|-------|---------|----------|
| `query=tesla` | `title=tesla` | **Approximate — full text to headlines** |
| `domain:bbc.co.uk` | `source.domain=bbc.co.uk` | Exact |
| `sourcelang:english` | `language.code=en` | Exact |
| `maxrecords=250` | `per_page=250` | Exact |
| `timespan=1w` | — | **Not verified — dropped** |

### 4. What this costs

**The search scope changes, and it changes the result set.** GDELT matched "tesla" anywhere in the article body across every language it indexes. `title=tesla` matches headlines. Expect fewer results per publisher and a different set — re-baseline any count or alert built on the GDELT number.

**`timespan=1w` is dropped, not translated.** APITube has date filters, but this kit has not executed GDELT's `timespan` against the live API, so it does not publish a mapping. Without it the request has no date bound at all — add one explicitly before running this in production.

**A 250-record page is fine here**, but note GDELT has no paging: if this query previously needed date-slicing to get past 250, that workaround is no longer necessary. Use `page=` instead.

### 5. What you gain

The article text itself — `body` and `body_html` — so whatever scrapes `url` today can be removed. Plus per-entity sentiment, IPTC categories, publisher bias and Open Page Rank, and 50 requests per minute instead of GDELT's effective handful.

### 6. What to check first

Run both for one day and compare the **language histogram**, not just the count. A GDELT query answered mostly in Chinese will come back from APITube mostly in English.

---

## A "No" looks like this

**You ask:**

```
https://api.gdeltproject.org/api/v2/doc/doc?query=sanctions sourcelang:russian theme:ECON_TRADE&mode=artlist&format=json
```

**Correct answer:**

### 1. Can this convert?

**No.** Two independent reasons, either sufficient:

- `sourcelang:russian` has no APITube equivalent. `language.code=ru` returns `400 ER0237` — Russian is absent from the index entirely, with no substitute.
- `theme:ECON_TRADE` is a GKG code. APITube classifies on IPTC MediaTopics plus topic and industry axes, which overlap but do not correspond, and this kit publishes no theme mapping because none has been verified.

This query is asking for exactly the two things APITube does not have. No URL is produced, and that is the correct output.
