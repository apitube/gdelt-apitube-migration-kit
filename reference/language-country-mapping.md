# Language and country mapping

GDELT returns English **names** (`"Serbian"`, `"South Korea"`); APITube takes **ISO codes** (`sr`, `kr`). Every row below was built the same way: take a live GDELT response, collect the distinct values it actually returned, then execute each candidate ISO code against APITube's `/v1/news/count`.

Source: one `mode=artlist&maxrecords=250` response for `query=tesla` on 27 July 2026 — 250 articles carrying **15 languages** and **29 countries**. Counts on the APITube side are whole-index totals from the same day.

## Languages

| GDELT `language` | APITube `language.code` | APITube index |
|---|---|---|
| English | `en` | 18 313 566 |
| Spanish | `es` | 5 707 089 |
| German | `de` | 4 011 796 |
| Portuguese | `pt` | 3 046 402 |
| French | `fr` | 2 308 782 |
| Polish | `pl` | 1 445 074 |
| Czech | `cs` | 663 827 |
| Hindi | `hi` | 445 094 |
| Bengali | `bn` | 420 806 |
| Swedish | `sv` | 405 912 |
| Finnish | `fi` | 211 984 |
| Korean | `ko` | 159 550 |
| Chinese | `zh` | 109 095 |
| Serbian | `sr` | 28 898 |
| **Russian** | — | **`400 ER0237` — "language with code 'ru' not found."** |

Fourteen of fifteen convert. Russian does not exist in APITube's index at all.

## Countries

| GDELT `sourcecountry` | APITube `source.country.code` | APITube index |
|---|---|---|
| United States | `us` | 2 527 133 |
| Brazil | `br` | 1 996 141 |
| United Kingdom | **`gb`** | 1 272 027 |
| Poland | `pl` | 1 257 741 |
| Spain | `es` | 1 245 436 |
| India | `in` | 1 198 116 |
| France | `fr` | 1 309 652 |
| Mexico | `mx` | 688 361 |
| Canada | `ca` | 683 170 |
| Serbia | `rs` | 319 620 |
| Colombia | `co` | 296 099 |
| Finland | `fi` | 206 641 |
| South Korea | `kr` | 170 230 |
| China | `cn` | 114 963 |
| Philippines | `ph` | 95 346 |
| Taiwan | `tw` | 45 274 |
| Malaysia | `my` | 41 498 |
| **Russia** | — | **`400 ER0212` — "source country code 'ru' not found."** |

Note `gb`, not `uk`. `source.country.code=uk` returns `400 ER0212`; it is a common ccTLD but not the ISO 3166 code.

## Russia is the one hard gap, and it is on both axes

`language.code=ru` and `source.country.code=ru` both fail. There is no substitute and no partial coverage — Russian-language articles and Russian publishers are simply absent.

In the sample above that cost 2 articles of 250, which sounds small. It is small **for this query**. If your GDELT work touches Russian-language press at all, measure your own share before committing: run your real query on GDELT, count the `"Russian"` rows, and treat that fraction as lost.

Ukrainian is also absent — `language.code=uk` returns the same `ER0237`. It did not appear in this sample, so it is not in the table above, but the same warning applies.

## The language mix will shift, and not slightly

This is the part that surprises people, so here are the two measurements side by side.

**What GDELT returned** for `query=tesla`, 250 articles:

| Language | Share |
|---|---|
| Chinese | 109 (44%) |
| English | 90 (36%) |
| Spanish | 12 (5%) |
| everything else, 12 languages | 39 (16%) |

**What APITube's index holds**, whole-index totals:

| Language | Articles |
|---|---|
| English | 18 313 566 |
| Chinese | 109 095 |

APITube's index carries roughly **168 times more English than Chinese**. GDELT's answer to this query was 44% Chinese.

These two numbers measure different things — one is a query result, the other is index composition — so do not subtract them. But the direction is unambiguous: a query that GDELT answered mostly in Chinese will come back from APITube mostly in English. If a downstream consumer assumed a language distribution, it will break, and it will break quietly because both APIs return `200`.

The practical step: before the cutover, run your real queries on both and compare the language histogram, not just the count.

## Building your own table

The fifteen languages and twenty-nine countries above are what one query happened to return. Yours will differ. The method is what generalises:

1. Run your real GDELT query with `maxrecords=250`.
2. Collect the distinct `language` and `sourcecountry` values from the response.
3. For each, execute `/v1/news/count?language.code=<code>` against APITube.
4. Keep the codes that answer `200`; every `ER0237` or `ER0212` is a coverage gap you now know about in advance.

Do not map from the English name by guesswork. A wrong code fails loudly on APITube (`ER0212` / `ER0237`), which is survivable — but a *plausible* wrong code that happens to exist returns `200` and silently filters for the wrong thing, which is not.
