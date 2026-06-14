"""Tests for the RPG setup salvage path — small local models emit malformed
JSON (stray ``*`` before values, missing object braces, broken nesting). The
salvage must recover authored flavor instead of falling back to the canned
template world."""
from monkey.main import _coerce_setup, _extract_json, _salvage_setup


def test_salvage_recovers_from_stray_star_before_value():
    # Real failure mode: `"blurb": *"A graveyard..."` breaks json.loads.
    raw = (
        '{"title": "Tides", "intro": "High seas.", "locations": ['
        '{"name": "Port Royal", "kind": "town", "blurb": "Busy harbour."},'
        '{"name": "Salt Marsh", "kind": "wild", "blurb": "Brackish flats."},'
        '{"name": "Wreckers Bay", "kind": "ruin", "blurb": *"A graveyard of ships."}],'
        '"heroes": [{"className": "Buccaneer", "blurb": "Sharp cutlass."},'
        '{"className": "Navigator", "blurb": "Reads the stars."}],'
        '"quest": {"title": "The Map", "desc": "Find it."}}'
    )
    assert _extract_json(raw) is None  # genuinely unparseable
    salvaged = _salvage_setup(raw)
    coerced = _coerce_setup(salvaged or {})
    assert coerced is not None
    names = {l["name"] for l in coerced["locations"]}
    assert "Port Royal" in names and "Wreckers Bay" in names
    assert coerced["title"] == "Tides"


def test_salvage_recovers_siblings_despite_missing_object_brace():
    # Missing `}` after "Cypress Cove" merges its braces with the next object's
    # `{`, so that one corrupted entry is lost — but every well-formed sibling
    # is still recovered (real worlds carry 6 locations, so coerce pads the rest).
    raw = (
        '{"title": "Plunder", "intro": "Arr.", "locations": [\n'
        '{"name": "Cypress Cove", "kind": "village", "blurb": "Haunted swamp.",\n'
        '{"name": "Tidal Flats", "kind": "wild", "blurb": "Sunken sands."},\n'
        '{"name": "Black Reef", "kind": "cave", "blurb": "Jagged rocks."},\n'
        '{"name": "Ravens Spire", "kind": "dungeon", "blurb": "Dark tower."}],'
        '"heroes": [{"className": "Ranger", "blurb": "Keen eye."},'
        '{"className": "Corsair", "blurb": "Bold blade."}]}'
    )
    salvaged = _salvage_setup(raw)
    coerced = _coerce_setup(salvaged or {})
    assert coerced is not None
    names = {l["name"] for l in coerced["locations"]}
    assert {"Tidal Flats", "Black Reef", "Ravens Spire"} <= names


def test_salvage_returns_none_on_pure_prose():
    assert _salvage_setup("Sorry, I cannot generate that world.") is None


def test_extract_json_strips_trailing_commas():
    raw = '{"title": "X", "locations": [{"name": "A", "kind": "town", "blurb": "b"},],}'
    parsed = _extract_json(raw)
    assert parsed is not None and parsed["title"] == "X"
