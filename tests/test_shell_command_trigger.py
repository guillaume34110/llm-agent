"""Universal-trigger regression: literal UNIX commands ('ls /path', 'find . -name')
must auto-load the 'shell' pack so run_command is available. Without this, the
agent silently lacks the tool and falls back to talking about the command
instead of executing it (user-reported bug, 2026-05-22).

False positives matter equally — natural English ("my cat is funny") must NOT
trigger pack loading.
"""
from __future__ import annotations

import pytest

from monkey import agent as ag


# Literal CLI invocations: cmd + (flag|path|quote). MUST load shell+files.
LITERAL_COMMANDS = [
    "ls /tmp/example_dir",
    "ls -la",
    'cat "foo bar.txt"',
    "cat ./file.txt",
    "find . -name foo",
    "find .. -type f",
    "grep -r foo .",
    "rm -rf /tmp/junk",
    "cp ~/file ./dst",
    "mkdir -p /tmp/x",
    "chmod +x ./script.sh",
    "tar -xzf archive.tar.gz",
    "wc -l /var/log/system.log",
    "head -n 20 /etc/hosts",
    "tail -f /tmp/log",
]


# Natural-language usage of CLI-cmd-shaped words. MUST NOT trigger shell pack.
NATURAL_LANGUAGE = [
    "my cat is funny",
    "I will find out tomorrow",
    "help me grep for documentation",
    "tell me about cat behavior",
    "how do I find a good restaurant",
    "rm 100 from the list",
    "kill the noise from the chart",
    "I head over there sometimes",
]


@pytest.mark.parametrize("msg", LITERAL_COMMANDS)
def test_literal_cli_command_loads_shell_pack(msg: str) -> None:
    packs = ag._select_packs("chat", msg, session_id=None)
    assert "shell" in packs, f"expected 'shell' for {msg!r}, got {sorted(packs)}"
    assert "files" in packs, f"expected 'files' for {msg!r}, got {sorted(packs)}"


@pytest.mark.parametrize("msg", NATURAL_LANGUAGE)
def test_natural_language_does_not_load_shell(msg: str) -> None:
    packs = ag._select_packs("chat", msg, session_id=None)
    assert "shell" not in packs, f"false positive 'shell' for {msg!r}, got {sorted(packs)}"


def test_existing_git_trigger_still_works() -> None:
    """Regression guard: existing universal triggers (git/npm/docker/...) untouched."""
    packs = ag._select_packs("chat", "git push origin main", session_id=None)
    assert "shell" in packs
    assert "code" in packs


# Multilingual NL hints: "le dossier X" / "the folder Y" / "el archivo Z".
# 2026-05-22 — without this, user requests like "depuis le dossier sylvanus"
# left the agent with no file tools, so it narrated `ls` instead of acting.
NL_FILE_HINTS = [
    "donne moi les images depuis le dossier sylvanus",
    "show me the folder photos",
    "whats in the directory foo",
    "open el archivo config",
    "le fichier python est cassé",
    "ouvre le répertoire ~/Downloads",
    "der Ordner bilder",
    "muestra la carpeta documentos",
]


@pytest.mark.parametrize("msg", NL_FILE_HINTS)
def test_natural_language_file_hint_loads_files_pack(msg: str) -> None:
    packs = ag._select_packs("chat", msg, session_id=None)
    assert "files" in packs, f"expected 'files' for {msg!r}, got {sorted(packs)}"


def test_file_as_verb_does_not_trigger() -> None:
    """'I file my taxes' uses 'file' as a verb — must not load files pack."""
    packs = ag._select_packs("chat", "I file my taxes annually", session_id=None)
    assert "files" not in packs


# Pure chat = ZERO tools (deliberate, 2026-06-08). A bare conversational turn
# ("hello") fires no pack trigger → packs == {core_min} → lean allowlist resolves
# to an empty toolset. Weak 3B models substitute *any* dangled tool, over-tooling
# direct-answer questions (7-14 calls, 90-250s, empty replies). File inspectors
# are NOT in the default chat toolset; they arrive only when a file-intent trigger
# loads the files pack (see test below). See monkeyAgent over-tooling notes.
def test_pure_chat_exposes_zero_tools() -> None:
    packs = ag._select_packs("chat", "hello", session_id=None)
    tools = ag._get_active_tools("local", packs)
    assert tools == [], f"pure chat must expose zero tools, got {[t['function']['name'] for t in tools]}"


def test_file_inspectors_present_when_files_pack_loads() -> None:
    """A folder/file request fires the files-pack trigger → read-only inspectors appear."""
    packs = ag._select_packs("chat", "show me the files in my documents folder", session_id=None)
    assert "files" in packs, f"expected files pack, got {sorted(packs)}"
    tools = ag._get_active_tools("local", packs)
    names = {t["function"]["name"] for t in tools}
    assert "list_dir" in names, "list_dir must load with the files pack"
    assert "read_file" in names, "read_file must load with the files pack"
    assert "get_file_info" in names, "get_file_info must load with the files pack"


def test_write_tools_still_gated_behind_files_pack() -> None:
    """Pure chat exposes no tools at all, so write/delete must be absent."""
    packs = ag._select_packs("chat", "hello", session_id=None)
    tools = ag._get_active_tools("local", packs)
    names = {t["function"]["name"] for t in tools}
    for write_tool in ["write_file", "edit_file", "delete_file", "move_file", "copy_file", "run_command"]:
        assert write_tool not in names, f"{write_tool} leaked into default toolset — should require expand_tools"


def test_schedule_request_loads_calendar_pack() -> None:
    packs = ag._select_packs("chat", "schedule a daily summary at 8am every weekday", session_id=None)
    assert "calendar" in packs


def test_skill_request_loads_skills_pack() -> None:
    packs = ag._select_packs("chat", "show me the available skills", session_id=None)
    assert "skills_mgmt" in packs


def test_image_gen_request_loads_image_pack() -> None:
    packs = ag._select_packs("chat", "draw a cat on the moon in watercolor style", session_id=None)
    assert "image" in packs


def test_short_file_request_loads_files_pack() -> None:
    packs = ag._select_packs("chat", "lis le fichier package.json", session_id=None)
    assert "files" in packs
