"""Tests for game_2d_ts scaffold: kit dispatch + biome filtering."""
import shutil
import tempfile
from pathlib import Path

import pytest

from monkey.templates import game_2d_ts


@pytest.fixture
def tmpdir():
    d = tempfile.mkdtemp(prefix="g2d-test-")
    yield d
    shutil.rmtree(d, ignore_errors=True)


def test_default_scaffold_emits_all_biomes(tmpdir):
    r = game_2d_ts.apply(tmpdir, kit="platformer")
    assert len(r["biomes"]) == 16
    tiles = (Path(tmpdir) / "src/engine/Tiles.ts").read_text()
    assert "const BIOME_FILTER: string[] = [/* __BIOME_FILTER__ */];" in tiles


def test_biome_filter_replaces_constant(tmpdir):
    r = game_2d_ts.apply(tmpdir, kit="platformer", biomes=["lava", "ice", "castle"])
    assert r["biomes"] == ["lava", "ice", "castle"]
    tiles = (Path(tmpdir) / "src/engine/Tiles.ts").read_text()
    assert "const BIOME_FILTER: string[] = ['lava', 'ice', 'castle'];" in tiles


def test_invalid_biome_raises(tmpdir):
    with pytest.raises(ValueError, match="unknown biome"):
        game_2d_ts.apply(tmpdir, kit="platformer", biomes=["lava", "neon"])


def test_invalid_kit_raises(tmpdir):
    with pytest.raises(ValueError, match="unknown kit"):
        game_2d_ts.apply(tmpdir, kit="fps")


@pytest.mark.parametrize("kit", ["platformer", "metroidvania", "topdown-rpg", "shmup", "puzzle"])
def test_each_kit_scaffolds(kit, tmpdir):
    r = game_2d_ts.apply(tmpdir, kit=kit)
    assert r["kit"] == kit
    assert (Path(tmpdir) / "package.json").exists()
    assert (Path(tmpdir) / "src/scenes/Game.ts").exists()
    assert (Path(tmpdir) / "tests/unit/Autotile.test.ts").exists()
    assert (Path(tmpdir) / "playwright.config.ts").exists()


def test_default_config_emitted(tmpdir):
    game_2d_ts.apply(tmpdir)
    cfg = (Path(tmpdir) / "src/config.ts").read_text()
    assert "SPEED: 160" in cfg
    assert "GRAVITY: 900" in cfg
    assert "PLAYER: 0x4ade80" in cfg
    assert "SAVE_KEY: 'game-2d-ts:v1'" in cfg


def test_tuning_overrides_config(tmpdir):
    r = game_2d_ts.apply(tmpdir, tuning={
        "PLAYER": {"SPEED": 220, "JUMP_VELOCITY": -400, "LIVES": 5},
        "WORLD": {"GRAVITY": 1100, "LEVEL_WIDTH": 4800},
        "PALETTE": {"PLAYER": 0xff00aa},
        "DEBUG": True,
    })
    cfg = (Path(tmpdir) / "src/config.ts").read_text()
    assert "SPEED: 220" in cfg
    assert "JUMP_VELOCITY: -400" in cfg
    assert "LIVES: 5" in cfg
    assert "GRAVITY: 1100" in cfg
    assert "LEVEL_WIDTH: 4800" in cfg
    assert "PLAYER: 0xff00aa" in cfg
    assert "DEBUG: true" in cfg
    # untouched keys keep defaults
    assert "PATROL_SPEED: 50" in cfg
    assert r["config"]["PLAYER"]["SPEED"] == 220


def test_tuning_unknown_section_raises(tmpdir):
    with pytest.raises(ValueError, match="unknown config key"):
        game_2d_ts.apply(tmpdir, tuning={"WIZARD": {"MANA": 100}})


def test_tuning_unknown_subkey_raises(tmpdir):
    with pytest.raises(ValueError, match="PLAYER.NITRO"):
        game_2d_ts.apply(tmpdir, tuning={"PLAYER": {"NITRO": 1}})


def test_name_and_title_substituted(tmpdir):
    game_2d_ts.apply(tmpdir, name="lava-quest", title="Lava Quest")
    pkg = (Path(tmpdir) / "package.json").read_text()
    html = (Path(tmpdir) / "index.html").read_text()
    assert '"name": "lava-quest"' in pkg
    assert "<title>Lava Quest</title>" in html
    assert 'content="Lava Quest"' in html


def test_title_defaults_to_name(tmpdir):
    game_2d_ts.apply(tmpdir, name="ninja-run")
    html = (Path(tmpdir) / "index.html").read_text()
    assert "<title>ninja-run</title>" in html


def test_platformer_runtime_wires_editor_perf_and_i18n(tmpdir):
    game_2d_ts.apply(tmpdir, kit="platformer")
    game = (Path(tmpdir) / "src/scenes/Game.ts").read_text()
    menu = (Path(tmpdir) / "src/scenes/MainMenu.ts").read_text()
    pause = (Path(tmpdir) / "src/scenes/Pause.ts").read_text()
    gameover = (Path(tmpdir) / "src/scenes/GameOver.ts").read_text()
    assert "attachEditor" in game
    assert "PerfMonitor" in game
    assert "perfLabel" in game
    assert "t('hud.score'" in game
    assert "availableLocales" in menu
    assert "menu.controls" in menu
    assert "t('pause.title')" in pause
    assert "t('gameover.title')" in gameover


def test_save_schema_and_metroidvania_flags_are_typed(tmpdir):
    game_2d_ts.apply(tmpdir, kit="metroidvania")
    save = (Path(tmpdir) / "src/engine/Save.ts").read_text()
    menu = (Path(tmpdir) / "src/scenes/MainMenu.ts").read_text()
    game = (Path(tmpdir) / "src/scenes/Game.ts").read_text()
    assert "flags: {}" in save
    assert "setFlag" in save
    assert "as any" not in menu
    assert "as any" not in game
    assert "sd.flags.hasDash" in game


def test_tiled_loader_exposes_runtime_level_parser(tmpdir):
    game_2d_ts.apply(tmpdir, kit="platformer")
    tiled = (Path(tmpdir) / "src/engine/TiledLoader.ts").read_text()
    levels = (Path(tmpdir) / "src/levels/AGENT.md").read_text()
    assert "parseTiledLevel" in tiled
    assert "parseTilemap(rows.map" in tiled
    assert "parseTiledLevel(raw as any)" in levels


def test_scaffold_docs_prefer_build_then_file_smoke(tmpdir):
    game_2d_ts.apply(tmpdir, kit="platformer")
    root = Path(tmpdir)
    readme = (root / "README.md").read_text()
    agent_md = (root / "AGENT.md").read_text()

    assert "npm run build" in readme
    assert "file://.../dist/index.html" in readme
    assert "npm run preview" not in readme
    assert "npm run build" in agent_md
    assert "file://.../dist/index.html" in agent_md
