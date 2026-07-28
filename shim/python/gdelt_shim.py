"""GDELT DOC 2.0 compatibility shim for the APITube News API.

Accepts GDELT DOC parameters, calls APITube, and returns a response shaped like GDELT's
so existing call sites keep working.

Two things this shim exists to prevent:

  1. Forwarding a GDELT parameter name. APITube ignores what it does not recognise and
     answers 200 with the entire index — a successful-looking response containing
     unfiltered news. Only the allow-list below is ever sent.

  2. Forwarding a GDELT language or country VALUE. GDELT emits English names
     ("Serbian", "South Korea"); APITube takes ISO codes (sr, kr). The maps below were
     each executed against /v1/news/count — see reference/language-country-mapping.md.

Anything lossy is reported through ``on_warning`` rather than dropped in silence.

Requires: requests (``pip install requests``)
"""

from __future__ import annotations

import re
from typing import Any, Callable, Dict, List, Optional

import requests

APITUBE_BASE_URL = "https://api.apitube.io"

# GDELT language name (lowercased) -> ISO 639-1. Every code verified against
# /v1/news/count on 27 July 2026. Russian and Ukrainian are absent from APITube.
LANGUAGE_TO_CODE = {
    "english": "en",
    "spanish": "es",
    "german": "de",
    "portuguese": "pt",
    "french": "fr",
    "polish": "pl",
    "czech": "cs",
    "hindi": "hi",
    "bengali": "bn",
    "swedish": "sv",
    "finnish": "fi",
    "korean": "ko",
    "chinese": "zh",
    "serbian": "sr",
}

# GDELT country label (lowercased) -> ISO 3166 alpha-2. Note gb, not uk.
COUNTRY_TO_CODE = {
    "united states": "us",
    "brazil": "br",
    "united kingdom": "gb",
    "poland": "pl",
    "spain": "es",
    "india": "in",
    "france": "fr",
    "mexico": "mx",
    "canada": "ca",
    "serbia": "rs",
    "colombia": "co",
    "finland": "fi",
    "south korea": "kr",
    "china": "cn",
    "philippines": "ph",
    "taiwan": "tw",
    "malaysia": "my",
    "us": "us",
    "uk": "gb",
}

# Absent from APITube on both axes. language.code=ru/uk -> ER0237,
# source.country.code=ru -> ER0212.
UNSUPPORTED_LANGUAGES = {"russian", "ukrainian"}
UNSUPPORTED_COUNTRIES = {"russia", "ukraine"}

CODE_TO_LANGUAGE = {code: name.capitalize() for name, code in LANGUAGE_TO_CODE.items()}

CODE_TO_COUNTRY = {
    "us": "United States",
    "br": "Brazil",
    "gb": "United Kingdom",
    "pl": "Poland",
    "es": "Spain",
    "in": "India",
    "fr": "France",
    "mx": "Mexico",
    "ca": "Canada",
    "rs": "Serbia",
    "co": "Colombia",
    "fi": "Finland",
    "kr": "South Korea",
    "cn": "China",
    "ph": "Philippines",
    "tw": "Taiwan",
    "my": "Malaysia",
}

MAX_RECORDS = 250
MAX_MULTI_VALUES = 3

# GDELT modes this shim can serve. Everything else is refused rather than approximated.
SUPPORTED_MODES = {"artlist", "artgallery"}

_TOKEN_RE = re.compile(r'[a-z_]+:(?:"[^"]*"|\S+)|"[^"]*"|\S+', re.IGNORECASE)
_OPERATOR_RE = re.compile(r"^([a-z_]+):(.+)$", re.IGNORECASE)
_DATE_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})")

_UNVERIFIED = ("timespan", "startdatetime", "enddatetime", "sort", "tone", "tonesimple")


class GdeltShimError(Exception):
    """An error returned by APITube, carrying its code and request id."""

    def __init__(self, message, code=None, status=None, request_id=None, url=None):
        super().__init__(message)
        self.code = code
        self.status = status
        self.request_id = request_id
        self.url = url


def to_gdelt_date(value: Any) -> str:
    """ISO 8601 extended (APITube) -> ISO 8601 basic (GDELT).

    ``2026-07-09T12:00:00.000Z`` becomes ``20260709T120000Z``.
    """
    if not value:
        return ""

    text = str(value)
    match = _DATE_RE.match(text)

    if not match:
        return text

    year, month, day, hour, minute, second = match.groups()

    return f"{year}{month}{day}T{hour}{minute}{second}Z"


class GdeltShim:
    """Accepts GDELT DOC 2.0 parameters, calls APITube, returns the GDELT shape."""

    def __init__(
        self,
        api_key: str,
        base_url: str = APITUBE_BASE_URL,
        on_warning: Optional[Callable[[str], None]] = None,
        session: Optional[Any] = None,
    ):
        if not api_key:
            raise ValueError("api_key is required")

        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.on_warning = on_warning if on_warning is not None else self._default_warning
        self.session = session or requests
        self.last_params: Optional[Dict[str, Any]] = None

    @staticmethod
    def _default_warning(message: str) -> None:
        print(f"[gdelt-shim] {message}")

    def doc(self, **params: Any) -> Dict[str, Any]:
        """The GDELT DOC entry point. Returns ``{"articles": [...]}``."""
        translated = self.translate_params(**params)
        url = f"{self.base_url}/v1/news/everything"

        response = self.session.get(url, params=translated, headers={"X-API-Key": self.api_key})
        payload = response.json()

        errors = payload.get("errors") or []

        if errors:
            error = errors[0]

            raise GdeltShimError(
                error.get("message", "APITube error"),
                code=error.get("code"),
                status=error.get("status"),
                request_id=payload.get("request_id"),
                url=url,
            )

        return self.shape_response(payload)

    def translate_params(self, **params: Any) -> Dict[str, Any]:
        """Translate GDELT parameters into APITube parameters."""
        out: Dict[str, Any] = {}

        self.check_mode(params.get("mode"))
        self.check_format(params.get("format"))

        query = params.get("query")

        if query is not None and str(query).strip():
            out.update(self.translate_query(str(query)))

        records = self.translate_max_records(params.get("maxrecords"))

        if records is not None:
            out["per_page"] = records

        for name in _UNVERIFIED:
            if params.get(name) is not None:
                self.warn(
                    f"{name} is not mapped by this kit — it has not been verified against the live "
                    f"GDELT API. Dropped rather than guessed. See reference/parameter-mapping.md."
                )

        self.last_params = out

        return out

    def translate_query(self, query: str) -> Dict[str, Any]:
        """Split a GDELT query string into APITube filters."""
        out: Dict[str, Any] = {}
        domains: List[str] = []
        languages: List[str] = []
        countries: List[str] = []
        terms: List[str] = []

        for token in _TOKEN_RE.findall(query):
            match = _OPERATOR_RE.match(token)

            if not match:
                terms.append(token.strip('"'))
                continue

            operator = match.group(1).lower()
            value = match.group(2).strip('"')

            if operator in ("domain", "domainis"):
                domains.append(value)
            elif operator == "sourcelang":
                code = self.language_code(value)

                if code:
                    languages.append(code)
            elif operator == "sourcecountry":
                code = self.country_code(value)

                if code:
                    countries.append(code)
            elif operator == "theme":
                self.warn(
                    f"theme:{value} has no APITube equivalent — GDELT's GKG taxonomy does not map onto "
                    f"IPTC MediaTopics. Dropped. Consider category.id, topic.id or industry.id instead."
                )
            else:
                self.warn(f'Unrecognised GDELT operator "{operator}:" — dropped rather than forwarded.')

        if terms:
            out["title"] = " ".join(terms)
            self.warn(
                f"GDELT searches full article text; APITube searches headlines. \"{out['title']}\" now "
                f"matches titles only, which returns a different set — re-baseline any threshold built "
                f"on GDELT counts."
            )

        if domains:
            out["source.domain"] = ",".join(self.cap_values(domains, "source.domain"))

        if languages:
            out["language.code"] = ",".join(self.cap_values(languages, "language.code"))

        if countries:
            out["source.country.code"] = ",".join(self.cap_values(countries, "source.country.code"))

        return out

    def language_code(self, value: str) -> Optional[str]:
        """GDELT language name -> ISO 639-1, or None with a warning."""
        key = value.lower()

        if key in UNSUPPORTED_LANGUAGES:
            self.warn(
                f"sourcelang:{value} has no APITube equivalent — language.code={key[:2]} returns "
                f"400 ER0237. There is no substitute; those articles are simply absent."
            )

            return None

        code = LANGUAGE_TO_CODE.get(key)

        if not code:
            self.warn(
                f"sourcelang:{value} is not in this kit's verified language table — dropped rather "
                f"than guessed. Check it against /v1/news/count and add it if it answers 200."
            )

            return None

        return code

    def country_code(self, value: str) -> Optional[str]:
        """GDELT country label -> ISO 3166 alpha-2, or None with a warning."""
        key = value.lower()

        if key in UNSUPPORTED_COUNTRIES:
            self.warn(
                f"sourcecountry:{value} has no APITube equivalent — source.country.code returns "
                f"400 ER0212. Those publishers are absent from the index."
            )

            return None

        code = COUNTRY_TO_CODE.get(key)

        if not code:
            self.warn(
                f"sourcecountry:{value} is not in this kit's verified country table — dropped rather "
                f"than guessed. Check it against /v1/news/count and add it if it answers 200."
            )

            return None

        return code

    def cap_values(self, values: List[str], parameter: str) -> List[str]:
        """APITube applies the first 3 values of a comma list and drops the rest silently."""
        if len(values) > MAX_MULTI_VALUES:
            dropped = ", ".join(values[MAX_MULTI_VALUES:])
            self.warn(
                f"{parameter} received {len(values)} values; APITube applies the first "
                f"{MAX_MULTI_VALUES} and drops the rest without an error. Dropped: {dropped}."
            )

        return values[:MAX_MULTI_VALUES]

    def translate_max_records(self, maxrecords: Any) -> Optional[int]:
        if maxrecords is None or maxrecords == "":
            return None

        try:
            value = float(maxrecords)
        except (TypeError, ValueError):
            self.warn(f"maxrecords={maxrecords} is not a positive number — ignored.")

            return None

        if value < 1:
            self.warn(f"maxrecords={maxrecords} is not a positive number — ignored.")

            return None

        if value > MAX_RECORDS:
            self.warn(
                f"maxrecords={int(value)} exceeds the maximum of {MAX_RECORDS} on both APIs. "
                f"Capped at {MAX_RECORDS}. Note GDELT answers this case with HTTP 200 and a "
                f"plain-text body, while APITube returns 400 ER0171."
            )

            return MAX_RECORDS

        return int(value)

    def check_mode(self, mode: Any) -> None:
        if mode is None or mode == "":
            return

        key = str(mode).lower()

        if key in SUPPORTED_MODES:
            return

        if key.startswith("timeline"):
            self.warn(
                f"mode={mode} aggregates over time. APITube's nearest equivalent is a separate "
                f"endpoint, /v1/news/trends, with a different response shape — this shim does not "
                f"translate it."
            )

            return

        if key == "tonechart":
            self.warn(
                "mode=tonechart has no APITube endpoint. Per-article sentiment is in every response "
                "as sentiment.overall.score, so the histogram can be computed client-side."
            )

            return

        self.warn(
            f"mode={mode} is a presentation mode with no APITube equivalent — APITube returns data, "
            f"not layouts."
        )

    def check_format(self, fmt: Any) -> None:
        if fmt is None or fmt == "":
            return

        if str(fmt).lower() != "json":
            self.warn(
                f"format={fmt} is not produced by this shim, which always returns the JSON shape. "
                f"APITube can export csv, tsv, xlsx, xml, rss, jsonl and parquet via export= on the "
                f"raw API."
            )

    def shape_response(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Rebuild GDELT's envelope from an APITube payload."""
        results = payload.get("results") if isinstance(payload, dict) else None

        if not isinstance(results, list):
            results = []

        return {"articles": [self.shape_article(article) for article in results]}

    def shape_article(self, article: Dict[str, Any]) -> Dict[str, Any]:
        source = article.get("source") or {}
        country = source.get("country")
        country_code = country.get("code") if isinstance(country, dict) else country
        language_code = article.get("language")

        return {
            "url": article.get("href") or "",
            "url_mobile": "",
            "title": article.get("title") or "",
            "seendate": to_gdelt_date(article.get("published_at")),
            "socialimage": article.get("image") or "",
            "domain": source.get("domain") or "",
            "language": CODE_TO_LANGUAGE.get(language_code, language_code) or "",
            "sourcecountry": CODE_TO_COUNTRY.get(country_code, country_code) or "",
            "_apitube": article,
        }

    def warn(self, message: str) -> None:
        if callable(self.on_warning):
            self.on_warning(message)
