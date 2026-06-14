"""Tests for monkey.tools.osint_geo — Nominatim, GDELT, recherche-entreprises, Wikidata."""
from __future__ import annotations

import json

import pytest

from monkey.tools import osint_geo as geo
from monkey.tools import _netcache


@pytest.fixture(autouse=True)
def _isolated_cache(tmp_path, monkeypatch):
    monkeypatch.setattr(_netcache, "CACHE_DIR", tmp_path / "c")
    _netcache._HOST_LAST.clear()
    yield


def _stub(monkeypatch, status: int, text: str):
    def fake(method, url, **kw):
        return {"status": status, "headers": {}, "text": text, "url": url, "from_cache": False}
    monkeypatch.setattr(geo._netcache, "request", fake)


def test_nominatim_geocode_empty():
    assert geo.nominatim_geocode("").startswith("ERREUR")


def test_nominatim_geocode_results(monkeypatch):
    payload = json.dumps([
        {"display_name": "Paris, France", "lat": "48.8566", "lon": "2.3522",
         "type": "city", "class": "place", "osm_id": 7444, "osm_type": "relation",
         "address": {"country": "France"}, "importance": 0.9},
    ])
    _stub(monkeypatch, 200, payload)
    out = json.loads(geo.nominatim_geocode("Paris"))
    assert out["count"] == 1
    assert out["results"][0]["lat"] == 48.8566


def test_nominatim_reverse_bad_input():
    assert geo.nominatim_reverse("foo", "bar").startswith("ERREUR")


def test_nominatim_reverse_ok(monkeypatch):
    payload = json.dumps({"display_name": "Eiffel Tower", "address": {"city": "Paris"},
                          "osm_id": 1, "osm_type": "way"})
    _stub(monkeypatch, 200, payload)
    out = json.loads(geo.nominatim_reverse(48.8584, 2.2945))
    assert out["display_name"] == "Eiffel Tower"


def test_gdelt_empty():
    assert geo.gdelt_search("").startswith("ERREUR")


def test_gdelt_no_results(monkeypatch):
    _stub(monkeypatch, 200, "")
    assert "no GDELT" in geo.gdelt_search("zzznoresults")


def test_gdelt_results(monkeypatch):
    payload = json.dumps({"articles": [
        {"title": "Big news", "url": "https://news.example/big",
         "domain": "news.example", "language": "English",
         "seendate": "20260101T000000Z", "sourcecountry": "France"},
    ]})
    _stub(monkeypatch, 200, payload)
    out = json.loads(geo.gdelt_search("acme"))
    assert out["count"] == 1
    assert out["articles"][0]["domain"] == "news.example"


def test_recherche_entreprises_empty():
    assert geo.recherche_entreprises("").startswith("ERREUR")


def test_recherche_entreprises_results(monkeypatch):
    payload = json.dumps({"total_results": 1, "results": [{
        "nom_complet": "ACME SAS", "siren": "123456789",
        "siege": {"siret": "12345678900012", "adresse": "10 rue de la Paix",
                  "code_postal": "75002", "libelle_commune": "Paris"},
        "activite_principale": "6201Z",
        "date_creation": "2010-01-01",
        "dirigeants": [{"nom": "DOE", "prenoms": "John", "qualite": "Président",
                        "date_de_naissance": "1980-01"}],
    }]})
    _stub(monkeypatch, 200, payload)
    out = json.loads(geo.recherche_entreprises("acme"))
    assert out["count"] == 1
    r = out["results"][0]
    assert r["siren"] == "123456789"
    assert r["dirigeants"][0]["nom"] == "DOE"


def test_wikidata_empty():
    assert geo.wikidata_search("").startswith("ERREUR")


def test_wikidata_results(monkeypatch):
    payload = json.dumps({"search": [
        {"id": "Q42", "label": "Douglas Adams", "description": "writer",
         "concepturi": "http://www.wikidata.org/entity/Q42"},
    ]})
    _stub(monkeypatch, 200, payload)
    out = json.loads(geo.wikidata_search("Douglas Adams"))
    assert out["count"] == 1
    assert out["results"][0]["id"] == "Q42"
