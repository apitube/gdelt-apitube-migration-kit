# Response mapping

GDELT's field list comes from a live `mode=artlist&format=json` response on 27 July 2026. APITube's comes from `/v1/news/everything` on the same day.

## Envelope

| GDELT | APITube | Note |
|-------|---------|------|
| `articles` | `results` | The array of articles |
| — | `status` | `"ok"` |
| — | `request_id` | For support |
| — | `page`, `limit` | Echoed back |
| — | `has_next_pages`, `next_page`, `previous_page` | Ready-made paging URLs |
| — | `export` | The same query as JSON, JSONL, CSV, TSV, XLSX, XML, RSS or Parquet |

GDELT's envelope is a single key. There is no total, no paging metadata, and no request identifier — if you need to know how many articles matched, you cannot: `maxrecords` caps what comes back and nothing reports what was left behind.

APITube splits this into two calls: `/v1/news/everything` for the articles, `/v1/news/count` for the total. Call the count once per filter set, not per page.

## Article

GDELT returns eight fields. Every one has a home:

| GDELT | APITube | Fidelity |
|-------|---------|----------|
| `url` | `href` | Exact |
| `url_mobile` | — | Usually `""` in GDELT responses anyway |
| `title` | `title` | Exact |
| `seendate` | `published_at` | **Reformat required** — see below |
| `socialimage` | `image` | Exact |
| `domain` | `source.domain` | Same form (`blic.rs`) |
| `language` | `language` | **Name vs code** — see below |
| `sourcecountry` | `source.country` | **Name vs code** — see below |

### `seendate` needs reformatting

GDELT writes ISO 8601 **basic** format — no separators:

```
20260709T120000Z
```

APITube reads and writes the **extended** format:

```
2026-07-09T12:00:00Z
```

Converting is mechanical, but note the direction that matters: when you send a date *to* APITube as a filter (`published_at.start`, `published_at.end`), the extended form is what it accepts. A GDELT-shaped string passed straight through is not a valid filter value.

Note also what `seendate` means. It is the time GDELT **first saw** the article, not necessarily when the publisher issued it. APITube's `published_at` is the publication time. For recent articles the two are close; for anything GDELT picked up late they are not, and there is no field on either side that reconciles them.

### `language` and `sourcecountry` are names, not codes

This is the conversion most likely to break a naive port.

```json
GDELT:    "language": "Serbian",  "sourcecountry": "Serbia"
APITube:  "language": "sr",       "source": {"country": {"code": "rs"}}
```

Passing the name straight through does not filter — it fails, and which error you get tells you what went wrong. Measured 27 July 2026:

| What you send | Response |
|---|---|
| `language.code=Serbian` | `400 ER0061` — "language.code must be between 1 and 2 characters." |
| `language.code=zz` | `400 ER0237` — "language with code 'zz' not found." |
| `source.country.code=Serbia` | `400 ER0246` — "source.country.code must be 2 characters." |
| `source.country.code=zz` | `400 ER0212` — "source country code 'zz' not found." |
| `language.code=sr` | `200`, 28 898 articles |
| `source.country.code=rs` | `200`, 319 547 articles |

Two error classes per parameter, and the distinction is worth handling separately: a **length** error (`ER0061`, `ER0246`) means you forwarded a GDELT name without converting it, while a **not-found** error (`ER0237`, `ER0212`) means your lookup table produced a code APITube does not carry. The first is a bug in your mapping code; the second is a genuine coverage gap.

Both directions need a lookup table. Building it from GDELT's own responses is the reliable approach: collect the distinct `language` and `sourcecountry` values your queries actually return, then map each to its ISO code. Do not guess from the English name — several of GDELT's labels do not map one-to-one, and a wrong guess fails loudly on APITube rather than silently, which is at least a good failure.

## What APITube adds

Everything below has no GDELT counterpart. This is the reason to migrate, and the size of the list is the point — GDELT tells you an article exists, APITube tells you what is in it:

| Field | What it is |
|-------|-----------|
| `body`, `body_html` | **The article text.** GDELT gives you a URL to scrape |
| `description` | Standfirst / summary line |
| `author.name` | Byline |
| `summary[]` | Extractive summary sentences, each with its own sentiment |
| `entities[]` | Named entities with type, frequency, Wikidata links and **sentiment towards that entity** |
| `sentiment` | `overall`, `title` and `body`, scored separately |
| `categories[]` | IPTC MediaTopics with confidence scores |
| `topics[]`, `industries[]` | Two further classification axes |
| `keywords[]` | Extracted keywords |
| `locations_mentioned[]` | Places named in the text, with coordinates |
| `readability` | Flesch–Kincaid grade, reading ease, ARI, difficulty, target audience, reading age |
| `source.bias` | Publisher political leaning |
| `source.rankings.opr` | Open Page Rank |
| `shares` | `total`, `facebook`, `twitter`, `reddit` |
| `is_breaking`, `is_duplicate` | Article flags |
| `story.id` | Cluster identity across publishers |
| `words_count`, `characters_count`, `sentences_count`, `paragraphs_count`, `read_time` | Length metrics |
| `translations` | Title in other languages |

The one that changes architecture is `body`. A GDELT pipeline almost always has a scraping stage bolted on — fetch the `url`, extract the text, handle the failures, respect the robots file, rotate user agents. That stage, and every failure mode in it, goes away.

## Rebuilding the GDELT shape

The shim returns GDELT's envelope so existing readers keep working:

```js
{
  articles: [{
    url: 'https://…',
    url_mobile: '',
    title: 'Tesla robotaxi rollout slips',
    seendate: '20260727T074049Z',   // reformatted from published_at
    socialimage: 'https://…',
    domain: 'bbc.co.uk',
    language: 'English',            // mapped back from `en`
    sourcecountry: 'United Kingdom',// mapped back from `gb`
    _apitube: { /* everything above */ }
  }]
}
```

The `_apitube` key carries the fields GDELT has no slot for, so nothing is silently discarded on the way through. Reading it is how you find out what the migration bought you.
