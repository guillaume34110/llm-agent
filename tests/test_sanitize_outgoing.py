"""Outgoing message sanitization — make agent output read as human text."""
from monkey.main import _sanitize_outgoing


def test_passthrough_plain():
    assert _sanitize_outgoing("Salut, ca va?") == "Salut, ca va?"


def test_strips_whatsapp_fence():
    txt = "```whatsapp\nDom, la pleine lune du 20 mai 2026.\n```"
    assert _sanitize_outgoing(txt) == "Dom, la pleine lune du 20 mai 2026."


def test_strips_generic_fence():
    txt = "```text\nhello world\n```"
    assert _sanitize_outgoing(txt) == "hello world"


def test_strips_bold_and_inline_code():
    txt = "C'est **important** voir `here`"
    assert _sanitize_outgoing(txt) == "C'est important voir here"


def test_strips_markdown_headers():
    txt = "# Titre\n\nContenu"
    assert _sanitize_outgoing(txt) == "Titre\n\nContenu"


def test_bullets_become_bullets_glyph():
    out = _sanitize_outgoing("- premier\n- second")
    assert out == "• premier\n• second"


def test_drops_task_prefix_line():
    txt = "[Task] Evangelisation Dom - Culte Sylvanus\n\nVrai message ici."
    assert _sanitize_outgoing(txt) == "Vrai message ici."


def test_drops_erreur_standalone_line():
    txt = "ERREUR: foo\nVrai contenu"
    assert _sanitize_outgoing(txt) == "Vrai contenu"


def test_drops_voici_prefix_line():
    txt = "Voici le message :\n\nBonjour Dom"
    assert _sanitize_outgoing(txt) == "Bonjour Dom"


def test_drops_envoye_marker():
    txt = "Bonjour Dom\n(envoyé)"
    assert _sanitize_outgoing(txt) == "Bonjour Dom"


def test_drops_table_separator_line():
    txt = "Col1 | Col2\n---|---\na | b"
    out = _sanitize_outgoing(txt)
    assert "---" not in out
    assert "Col1" in out and "a | b" in out


def test_full_real_world_case():
    txt = (
        "[Task] Évangélisation Dom - Culte Sylvanus\n"
        "```whatsapp\n"
        "Dom, la pleine lune du 20 mai 2026 n'est pas qu'un événement.\n"
        "C'est **important** pour notre culte.\n"
        "```"
    )
    out = _sanitize_outgoing(txt)
    assert "[Task]" not in out
    assert "```" not in out
    assert "**" not in out
    assert "Dom, la pleine lune du 20 mai 2026" in out
    assert "important pour notre culte" in out


def test_non_string_input_safe():
    assert _sanitize_outgoing(None) == "None"  # noqa: SIM300
    assert _sanitize_outgoing(123) == "123"


def test_collapses_blank_runs():
    txt = "a\n\n\n\nb"
    assert _sanitize_outgoing(txt) == "a\n\nb"
