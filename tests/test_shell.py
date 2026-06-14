"""Smoke tests for monkey/tools/shell.py — sandbox + AppleScript escape."""
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from monkey.tools.shell import _esc_as, _is_path_safe, run_command


def test_esc_as_handles_quotes_and_newlines():
    assert _esc_as('hi') == 'hi'
    assert _esc_as('a"b') == 'a\\"b'
    assert _esc_as('a\\b') == 'a\\\\b'
    assert _esc_as('a\nb') == 'a b'
    assert _esc_as('a\rb') == 'a b'


def test_path_safe_home_and_tmp():
    home = os.path.expanduser("~")
    assert _is_path_safe(home)
    assert _is_path_safe(home + "/Documents/x")
    assert _is_path_safe("/tmp/x")
    assert not _is_path_safe("/etc/passwd")
    assert not _is_path_safe("/")
    assert not _is_path_safe("")


def test_run_command_blocks_unallowed():
    out = run_command("danger_cmd /etc/passwd")
    assert "not allowed" in out.lower() or out.startswith("Command not allowed")


def test_run_command_blocks_rm_outside_home():
    out = run_command("rm /etc/passwd")
    assert "interdit" in out.lower() or "ERREUR" in out


def test_run_command_malformed_quotes():
    out = run_command('echo "unclosed')
    assert out.startswith("ERREUR:")


def test_run_command_blocks_preview_for_game_project(tmp_path):
    root = tmp_path
    (root / "src" / "scenes").mkdir(parents=True)
    (root / "dist").mkdir()
    (root / "package.json").write_text('{"dependencies":{"phaser":"^3.80.1"},"scripts":{"preview":"vite preview"}}')
    (root / "src" / "scenes" / "Game.ts").write_text("export {};")
    (root / "dist" / "index.html").write_text("<!doctype html>")

    out = run_command("npm run preview -- --host", cwd=str(root))
    assert out.startswith("ERREUR:")
    assert "file://" in out
    assert "dist/index.html" in out
