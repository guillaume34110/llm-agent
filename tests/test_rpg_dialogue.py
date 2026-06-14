"""Tests for the RPG dialogue parse/clamp path. The player types freely; the
model voices one NPC and may pick a single world-effect token. The server must
(a) accept clean JSON, (b) clamp the effect to what the client allowed (the
client owns the mechanics — an out-of-scope effect must collapse to "none"),
and (c) salvage reply/effect from the malformed JSON small models emit. The
main quest trame is never touched here: effects only ever name a token, the
client decides the consequence."""
from monkey.main import _coerce_dialogue, _salvage_dialogue, _extract_json, _game_model_id


ALLOWED = {"none", "rumor", "warn", "heal"}


def test_coerce_clean_json():
    data = _extract_json('{"reply": "Beware the marsh.", "effect": "warn", "end": false}')
    out = _coerce_dialogue(data, ALLOWED)
    assert out == {"reply": "Beware the marsh.", "effect": "warn", "end": False}


def test_coerce_disallowed_effect_collapses_to_none():
    # Model picked an effect the client did not offer (recruit not in ALLOWED).
    # The client gates feasibility, so the server must not honor it.
    data = {"reply": "Join us.", "effect": "recruit", "end": False}
    out = _coerce_dialogue(data, ALLOWED)
    assert out["effect"] == "none"
    assert out["reply"] == "Join us."


def test_coerce_clamps_reply_to_400():
    data = {"reply": "x" * 999, "effect": "none"}
    out = _coerce_dialogue(data, ALLOWED)
    assert len(out["reply"]) == 400


def test_coerce_end_accepts_string_true():
    out = _coerce_dialogue({"reply": "Farewell.", "end": "true"}, ALLOWED)
    assert out["end"] is True
    out2 = _coerce_dialogue({"reply": "Farewell.", "end": "false"}, ALLOWED)
    assert out2["end"] is False


def test_coerce_accepts_text_and_say_aliases():
    assert _coerce_dialogue({"text": "Hi."}, ALLOWED)["reply"] == "Hi."
    assert _coerce_dialogue({"say": "Hi."}, ALLOWED)["reply"] == "Hi."


def test_coerce_returns_none_without_reply():
    assert _coerce_dialogue({"effect": "warn"}, ALLOWED) is None


def test_salvage_recovers_reply_and_effect_from_broken_json():
    raw = '{"reply": "The old mill hides a lead." "effect": "rumor" "end": false'
    out = _salvage_dialogue(raw, ALLOWED)
    assert out["reply"] == "The old mill hides a lead."
    assert out["effect"] == "rumor"
    assert out["end"] is False


def test_salvage_disallowed_effect_collapses_to_none():
    raw = '{"reply": "Take this ally." "effect": "recruit"}'
    out = _salvage_dialogue(raw, ALLOWED)
    assert out["effect"] == "none"


def test_salvage_returns_none_on_pure_prose():
    assert _salvage_dialogue("Just some narration with no fields.", ALLOWED) is None


def test_game_model_id_rejects_waaagh_base_models():
    # Tiny experimental nGPT bases can't honour the JSON contract — they emit
    # word-salad — so they're never a valid GM. An explicit request resolves to
    # None (game falls back to deterministic offline content, badge stays honest).
    assert _game_model_id("waaagh-sft-80m") is None
    assert _game_model_id("WAAAGH-base") is None
    # A real chat model passes through unchanged.
    assert _game_model_id("llama3.2:3b") == "llama3.2:3b"
