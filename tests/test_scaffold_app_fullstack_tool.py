"""Tests for scaffold_app_fullstack runtime tool."""
import shutil
import tempfile
from pathlib import Path

import pytest

from monkey.tools.repo_skills_tool import scaffold_app_fullstack


@pytest.fixture
def tmpdir():
    d = tempfile.mkdtemp(prefix="scaffold-fs-")
    yield d
    shutil.rmtree(d, ignore_errors=True)


def test_skeleton_only(tmpdir):
    out = scaffold_app_fullstack(tmpdir, name="acme")
    assert out.startswith("OK:")
    assert "(skeleton only)" in out
    assert (Path(tmpdir) / "package.json").exists()


def test_with_features(tmpdir):
    out = scaffold_app_fullstack(tmpdir, name="acme", features=["auth", "users"])
    assert out.startswith("OK:")
    assert (Path(tmpdir) / "apps/server/src/auth/controller.ts").exists()
    assert (Path(tmpdir) / "apps/web/src/features/users/Slice.ts").exists()


def test_dependency_feature_reports_auto_enabled_auth(tmpdir):
    out = scaffold_app_fullstack(tmpdir, name="acme", features=["users"])
    assert out.startswith("OK:")
    assert "features: auth, users" in out
    assert "auto-enabled deps: auth" in out


def test_unknown_feature_returns_error(tmpdir):
    out = scaffold_app_fullstack(tmpdir, features=["nope"])
    assert out.startswith("ERREUR:")
    assert "inconnues" in out


def test_missing_target_dir_returns_error():
    out = scaffold_app_fullstack("", name="x")
    assert out.startswith("ERREUR:")
