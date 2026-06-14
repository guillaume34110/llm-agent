import pytest


def test_llm_chat_local_mode_does_not_fallback(monkeypatch):
    from monkey import llm

    called = {"p2p": False}

    def fail_local(*_args, **_kwargs):
        raise RuntimeError("local down")

    def fake_p2p(*_args, **_kwargs):
        called["p2p"] = True
        return {"text": "peer", "tool_calls": [], "usage": {}}

    monkeypatch.setattr(llm, "_chat_ollama", fail_local)
    monkeypatch.setattr(llm, "_chat_p2p", fake_p2p)

    with pytest.raises(RuntimeError, match="local down"):
        llm.chat([{"role": "user", "content": "hi"}], model_id="qwen3:8b", provider_mode="local")

    assert called["p2p"] is False


def test_llm_chat_friend_mode_forwards_selected_friend(monkeypatch):
    from monkey import llm

    captured = {}

    def fake_p2p(_messages, _model_id, _tools, _force_tool, provider_user_id=None):
      captured["provider_user_id"] = provider_user_id
      return {"text": "peer", "tool_calls": [], "usage": {}}

    monkeypatch.setattr(llm, "_chat_p2p", fake_p2p)

    out = llm.chat(
        [{"role": "user", "content": "hi"}],
        model_id="qwen3:8b",
        provider_mode="friend",
        provider_user_id="friend-42",
    )

    assert captured["provider_user_id"] == "friend-42"
    assert out["text"] == "peer"


def test_llm_chat_default_still_falls_back_to_p2p(monkeypatch):
    from monkey import llm

    def fail_local(*_args, **_kwargs):
        raise RuntimeError("local down")

    def fake_p2p(*_args, **_kwargs):
        return {"text": "peer", "tool_calls": [], "usage": {}}

    monkeypatch.setattr(llm, "_chat_ollama", fail_local)
    monkeypatch.setattr(llm, "_chat_p2p", fake_p2p)

    out = llm.chat([{"role": "user", "content": "hi"}], model_id="qwen3:8b")

    assert out["text"] == "peer"


def test_agent_forwards_provider_choice_to_llm(monkeypatch):
    from monkey import agent

    captured = {}

    def fake_chat(_messages, _model_id, _tools=None, force_tool=False, provider_mode=None, provider_user_id=None):
        captured["force_tool"] = force_tool
        captured["provider_mode"] = provider_mode
        captured["provider_user_id"] = provider_user_id
        return {"text": "ok", "tool_calls": [], "usage": {}}

    monkeypatch.setattr(agent.llm_mod, "chat", fake_chat)
    prev_mode = agent._CURRENT_PROVIDER_MODE
    prev_user = agent._CURRENT_PROVIDER_USER_ID
    agent._CURRENT_PROVIDER_MODE = "friend"
    agent._CURRENT_PROVIDER_USER_ID = "friend-99"

    out = agent._call_llm_raw([{"role": "user", "content": "hello"}], "qwen3:8b", [])

    agent._CURRENT_PROVIDER_MODE = prev_mode
    agent._CURRENT_PROVIDER_USER_ID = prev_user

    assert out["text"] == "ok"
    assert captured["provider_mode"] == "friend"
    assert captured["provider_user_id"] == "friend-99"
