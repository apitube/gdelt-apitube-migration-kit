import unittest

from gdelt_shim import GdeltShim, GdeltShimError, to_gdelt_date


def silent():
    return GdeltShim(api_key="test", on_warning=lambda message: None)


def recording():
    warnings = []

    return GdeltShim(api_key="test", on_warning=warnings.append), warnings


class FakeResponse:
    def __init__(self, payload):
        self._payload = payload

    def json(self):
        return self._payload


class FakeSession:
    def __init__(self, payload):
        self.payload = payload
        self.url = None
        self.params = None
        self.headers = None

    def get(self, url, params=None, headers=None):
        self.url = url
        self.params = params
        self.headers = headers

        return FakeResponse(self.payload)


class TestGdeltShim(unittest.TestCase):
    def test_requires_api_key(self):
        with self.assertRaises(ValueError):
            GdeltShim(api_key="")

    def test_bare_query_becomes_title(self):
        params = silent().translate_params(query="tesla")

        self.assertEqual(params["title"], "tesla")

    def test_warns_headline_search_is_narrower(self):
        shim, warnings = recording()
        shim.translate_params(query="tesla")

        self.assertTrue(any("headlines" in w for w in warnings))

    def test_domain_operator(self):
        params = silent().translate_params(query="tesla domain:bbc.co.uk")

        self.assertEqual(params["source.domain"], "bbc.co.uk")
        self.assertEqual(params["title"], "tesla")

    def test_sourcelang_maps_name_to_code(self):
        params = silent().translate_params(query="tesla sourcelang:english")

        self.assertEqual(params["language.code"], "en")

    def test_sourcelang_is_case_insensitive(self):
        params = silent().translate_params(query="tesla sourcelang:Serbian")

        self.assertEqual(params["language.code"], "sr")

    def test_sourcecountry_maps_label_to_code(self):
        params = silent().translate_params(query="tesla sourcecountry:US")

        self.assertEqual(params["source.country.code"], "us")

    def test_united_kingdom_maps_to_gb(self):
        params = silent().translate_params(query='tesla sourcecountry:"United Kingdom"')

        self.assertEqual(params["source.country.code"], "gb")

    def test_quoted_multiword_country_stays_one_token(self):
        params = silent().translate_params(query='tesla sourcecountry:"South Korea"')

        self.assertEqual(params["source.country.code"], "kr")
        self.assertEqual(params["title"], "tesla")

    def test_russian_dropped_with_reason(self):
        shim, warnings = recording()
        params = shim.translate_params(query="tesla sourcelang:russian")

        self.assertNotIn("language.code", params)
        self.assertTrue(any("ER0237" in w for w in warnings))

    def test_russia_country_dropped_with_reason(self):
        shim, warnings = recording()
        params = shim.translate_params(query="tesla sourcecountry:russia")

        self.assertNotIn("source.country.code", params)
        self.assertTrue(any("ER0212" in w for w in warnings))

    def test_unverified_language_dropped_not_guessed(self):
        shim, warnings = recording()
        params = shim.translate_params(query="tesla sourcelang:esperanto")

        self.assertNotIn("language.code", params)
        self.assertTrue(any("rather than guessed" in w.replace("\n", " ") for w in warnings))

    def test_theme_dropped_with_pointer(self):
        shim, warnings = recording()
        params = shim.translate_params(query="tesla theme:ECON_STOCKMARKET")

        self.assertFalse(any("theme" in key for key in params))
        self.assertTrue(any("category.id" in w for w in warnings))

    def test_unknown_operator_never_forwarded(self):
        shim, warnings = recording()
        params = shim.translate_params(query="tesla imagewebtag:foo")

        self.assertNotIn("imagewebtag", params)
        self.assertTrue(any("Unrecognised GDELT operator" in w for w in warnings))

    def test_no_gdelt_parameter_name_reaches_apitube(self):
        params = silent().translate_params(
            query="tesla", mode="artlist", format="json", maxrecords=50, timespan="1d", sort="datedesc"
        )

        for forbidden in ("query", "mode", "format", "maxrecords", "timespan", "sort"):
            self.assertNotIn(forbidden, params)

    def test_maxrecords_becomes_per_page(self):
        params = silent().translate_params(query="tesla", maxrecords=50)

        self.assertEqual(params["per_page"], 50)

    def test_maxrecords_above_limit_is_capped(self):
        shim, warnings = recording()
        params = shim.translate_params(query="tesla", maxrecords=251)

        self.assertEqual(params["per_page"], 250)
        self.assertTrue(any("ER0171" in w for w in warnings))

    def test_fourth_value_dropped_with_warning(self):
        shim, warnings = recording()
        params = shim.translate_params(query="tesla domain:a.com domain:b.com domain:c.com domain:d.com")

        self.assertEqual(params["source.domain"], "a.com,b.com,c.com")
        self.assertTrue(any("drops the rest without an error" in w for w in warnings))

    def test_unverified_parameters_dropped(self):
        shim, warnings = recording()
        shim.translate_params(query="tesla", timespan="1d", startdatetime="20260720000000")

        self.assertTrue(any("timespan" in w and "not been verified" in w for w in warnings))
        self.assertTrue(any("startdatetime" in w for w in warnings))

    def test_timelinevol_points_at_trends(self):
        shim, warnings = recording()
        shim.translate_params(query="tesla", mode="timelinevol")

        self.assertTrue(any("/v1/news/trends" in w for w in warnings))

    def test_tonechart_suggests_client_side(self):
        shim, warnings = recording()
        shim.translate_params(query="tesla", mode="tonechart")

        self.assertTrue(any("sentiment.overall.score" in w for w in warnings))

    def test_non_json_format_warns(self):
        shim, warnings = recording()
        shim.translate_params(query="tesla", format="csv")

        self.assertTrue(any("export=" in w for w in warnings))

    def test_to_gdelt_date(self):
        self.assertEqual(to_gdelt_date("2026-07-09T12:00:00.000Z"), "20260709T120000Z")
        self.assertEqual(to_gdelt_date("2026-07-27T07:40:49Z"), "20260727T074049Z")

    def test_to_gdelt_date_leaves_unrecognised(self):
        self.assertEqual(to_gdelt_date("not a date"), "not a date")
        self.assertEqual(to_gdelt_date(None), "")

    def test_response_reshaped_into_gdelt_fields(self):
        shaped = silent().shape_response(
            {
                "results": [
                    {
                        "id": 3067099440,
                        "title": "Tesla robotaxi rollout slips",
                        "href": "https://www.bbc.co.uk/news/1",
                        "published_at": "2026-07-27T07:40:49.000Z",
                        "image": "https://img/1.jpg",
                        "language": "en",
                        "source": {"domain": "bbc.co.uk", "country": {"code": "gb"}},
                    }
                ]
            }
        )

        article = shaped["articles"][0]

        self.assertEqual(article["url"], "https://www.bbc.co.uk/news/1")
        self.assertEqual(article["title"], "Tesla robotaxi rollout slips")
        self.assertEqual(article["seendate"], "20260727T074049Z")
        self.assertEqual(article["socialimage"], "https://img/1.jpg")
        self.assertEqual(article["domain"], "bbc.co.uk")
        self.assertEqual(article["language"], "English")
        self.assertEqual(article["sourcecountry"], "United Kingdom")
        self.assertEqual(article["url_mobile"], "")

    def test_full_article_kept_under_apitube_key(self):
        shaped = silent().shape_response(
            {"results": [{"title": "x", "href": "https://e/1", "sentiment": {"overall": {"score": 0.4}}}]}
        )

        self.assertEqual(shaped["articles"][0]["_apitube"]["sentiment"]["overall"]["score"], 0.4)

    def test_empty_payload_yields_empty_list(self):
        self.assertEqual(silent().shape_response({}), {"articles": []})

    def test_doc_sends_key_as_header(self):
        session = FakeSession({"results": [{"title": "a", "href": "https://e/1", "language": "en", "source": {"domain": "e"}}]})
        shim = GdeltShim(api_key="secret", on_warning=lambda m: None, session=session)

        result = shim.doc(query="tesla domain:e", maxrecords=10)

        self.assertTrue(session.url.endswith("/v1/news/everything"))
        self.assertEqual(session.params["title"], "tesla")
        self.assertEqual(session.params["per_page"], 10)
        self.assertEqual(session.headers["X-API-Key"], "secret")
        self.assertEqual(result["articles"][0]["domain"], "e")

    def test_apitube_error_becomes_typed_exception(self):
        session = FakeSession(
            {
                "status": "not_ok",
                "request_id": "req-9",
                "errors": [{"status": 400, "code": "ER0171", "message": "Limit is out of range. Your plan allows up to 250 results per page."}],
            }
        )
        shim = GdeltShim(api_key="secret", on_warning=lambda m: None, session=session)

        with self.assertRaises(GdeltShimError) as ctx:
            shim.doc(query="tesla")

        self.assertEqual(ctx.exception.code, "ER0171")
        self.assertEqual(ctx.exception.request_id, "req-9")


if __name__ == "__main__":
    unittest.main()
