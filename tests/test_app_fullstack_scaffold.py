"""Tests for app_fullstack_ts skeleton scaffold."""
import json
import shutil
import tempfile
from pathlib import Path

import pytest

from monkey.templates import app_fullstack_ts


@pytest.fixture
def tmpdir():
    d = tempfile.mkdtemp(prefix="afs-test-")
    yield d
    shutil.rmtree(d, ignore_errors=True)


def test_scaffold_emits_monorepo_root(tmpdir):
    r = app_fullstack_ts.apply(tmpdir, name="acme")
    root = Path(r["root"])
    assert (root / "package.json").exists()
    assert (root / "docker-compose.yml").exists()
    assert (root / "tsconfig.base.json").exists()
    assert (root / "AGENT.md").exists()
    assert (root / ".env.example").exists()


def test_root_package_uses_name(tmpdir):
    app_fullstack_ts.apply(tmpdir, name="acme")
    pkg = json.loads((Path(tmpdir) / "package.json").read_text())
    assert pkg["name"] == "acme"
    assert pkg["workspaces"] == ["apps/*"]


def test_server_layered_health(tmpdir):
    app_fullstack_ts.apply(tmpdir, name="acme")
    base = Path(tmpdir) / "apps/server/src/health"
    for f in ("controller.ts", "service.ts", "logic.ts", "module.ts", "dto.ts",
              "logic.spec.ts", "controller.spec.ts"):
        assert (base / f).exists(), f"missing {f}"


def test_server_logic_is_pure_no_prisma_no_nest(tmpdir):
    app_fullstack_ts.apply(tmpdir, name="acme")
    logic = (Path(tmpdir) / "apps/server/src/health/logic.ts").read_text()
    code = "\n".join(l for l in logic.splitlines() if not l.lstrip().startswith("//"))
    assert "prisma" not in code.lower()
    assert "@nestjs" not in code.lower()
    assert "import" not in code or "from '@nestjs" not in code


def test_server_controller_calls_service_only(tmpdir):
    app_fullstack_ts.apply(tmpdir, name="acme")
    ctrl = (Path(tmpdir) / "apps/server/src/health/controller.ts").read_text()
    assert "PrismaService" not in ctrl
    assert "this.svc" in ctrl


def test_web_redux_layered_health(tmpdir):
    app_fullstack_ts.apply(tmpdir, name="acme")
    base = Path(tmpdir) / "apps/web/src/features/health"
    for f in ("Slice.ts", "Thunks.ts", "Api.ts", "Selectors.ts", "Slice.test.ts"):
        assert (base / f).exists(), f"missing {f}"


def test_web_component_has_no_fetch(tmpdir):
    app_fullstack_ts.apply(tmpdir, name="acme")
    comp = (Path(tmpdir) / "apps/web/src/components/HealthStatus.tsx").read_text()
    assert "fetch(" not in comp
    assert "useAppSelector" in comp
    assert "useAppDispatch" in comp


def test_web_store_wires_health_reducer(tmpdir):
    app_fullstack_ts.apply(tmpdir, name="acme")
    rr = (Path(tmpdir) / "apps/web/src/app/rootReducer.ts").read_text()
    assert "health" in rr
    assert "combineReducers" in rr


def test_invalid_feature_raises(tmpdir):
    with pytest.raises(ValueError, match="unknown feature"):
        app_fullstack_ts.apply(tmpdir, features=["nope"])


def test_idempotent_skip(tmpdir):
    r1 = app_fullstack_ts.apply(tmpdir, name="acme")
    r2 = app_fullstack_ts.apply(tmpdir, name="acme")
    assert r1["created"]
    assert r2["created"] == []
    assert len(r2["skipped"]) == len(r1["created"])


def test_prisma_schema_emitted(tmpdir):
    app_fullstack_ts.apply(tmpdir, name="acme")
    schema = (Path(tmpdir) / "apps/server/prisma/schema.prisma").read_text()
    assert 'provider = "postgresql"' in schema
    assert "DATABASE_URL" in schema


def test_docker_compose_postgres(tmpdir):
    app_fullstack_ts.apply(tmpdir, name="acme")
    yml = (Path(tmpdir) / "docker-compose.yml").read_text()
    assert "postgres" in yml
    assert "5544:5432" in yml


def test_tailwind_shadcn_wired(tmpdir):
    app_fullstack_ts.apply(tmpdir, name="acme")
    root = Path(tmpdir)
    assert (root / "apps/web/tailwind.config.ts").exists()
    assert (root / "apps/web/postcss.config.js").exists()
    assert (root / "apps/web/src/index.css").read_text().startswith("@tailwind base")
    assert (root / "apps/web/src/lib/utils.ts").read_text().count("twMerge") >= 1
    for f in ("button.tsx", "input.tsx", "label.tsx", "card.tsx"):
        assert (root / f"apps/web/src/components/ui/{f}").exists()
    assert "import './index.css'" in (root / "apps/web/src/main.tsx").read_text()


def test_auth_feature_emits_layered_files(tmpdir):
    app_fullstack_ts.apply(tmpdir, name="acme", features=["auth"])
    base = Path(tmpdir) / "apps/server/src/auth"
    for f in ("dto.ts", "logic.ts", "logic.spec.ts", "repository.ts",
              "service.ts", "controller.ts", "controller.spec.ts",
              "guard.ts", "module.ts"):
        assert (base / f).exists(), f"missing server/auth/{f}"
    web = Path(tmpdir) / "apps/web/src/features/auth"
    for f in ("Api.ts", "Slice.ts", "Thunks.ts", "Selectors.ts", "Slice.test.ts"):
        assert (web / f).exists(), f"missing web/features/auth/{f}"
    for f in ("LoginForm.tsx", "SignupForm.tsx", "AuthGate.tsx"):
        assert (Path(tmpdir) / f"apps/web/src/components/{f}").exists()


def test_auth_logic_pure_no_prisma(tmpdir):
    app_fullstack_ts.apply(tmpdir, name="acme", features=["auth"])
    logic = (Path(tmpdir) / "apps/server/src/auth/logic.ts").read_text()
    code = "\n".join(l for l in logic.splitlines() if not l.lstrip().startswith("//"))
    assert "prisma" not in code.lower()
    assert "@nestjs" not in code.lower()


def test_auth_repository_uses_prisma_only(tmpdir):
    app_fullstack_ts.apply(tmpdir, name="acme", features=["auth"])
    repo = (Path(tmpdir) / "apps/server/src/auth/repository.ts").read_text()
    assert "PrismaService" in repo
    assert "scrypt" not in repo  # no logic in repo
    assert "BadRequestException" not in repo  # no orchestration


def test_auth_controller_no_prisma(tmpdir):
    app_fullstack_ts.apply(tmpdir, name="acme", features=["auth"])
    ctrl = (Path(tmpdir) / "apps/server/src/auth/controller.ts").read_text()
    assert "PrismaService" not in ctrl
    assert "this.svc" in ctrl


def test_auth_components_no_fetch(tmpdir):
    app_fullstack_ts.apply(tmpdir, name="acme", features=["auth"])
    for c in ("LoginForm.tsx", "SignupForm.tsx"):
        body = (Path(tmpdir) / f"apps/web/src/components/{c}").read_text()
        assert "fetch(" not in body, f"{c} has direct fetch"
        assert "useAppDispatch" in body


def test_auth_wires_app_module(tmpdir):
    app_fullstack_ts.apply(tmpdir, name="acme", features=["auth"])
    am = (Path(tmpdir) / "apps/server/src/app.module.ts").read_text()
    assert "AuthModule" in am
    assert "import { AuthModule }" in am


def test_auth_wires_root_reducer(tmpdir):
    app_fullstack_ts.apply(tmpdir, name="acme", features=["auth"])
    rr = (Path(tmpdir) / "apps/web/src/app/rootReducer.ts").read_text()
    assert "authReducer" in rr
    assert "auth: authReducer" in rr


def test_auth_adds_user_model(tmpdir):
    app_fullstack_ts.apply(tmpdir, name="acme", features=["auth"])
    schema = (Path(tmpdir) / "apps/server/prisma/schema.prisma").read_text()
    assert "model User" in schema
    assert "passwordHash" in schema


def test_auth_app_tsx_uses_authgate(tmpdir):
    app_fullstack_ts.apply(tmpdir, name="acme", features=["auth"])
    app = (Path(tmpdir) / "apps/web/src/App.tsx").read_text()
    assert "AuthGate" in app


def test_users_feature_emits_layered_files(tmpdir):
    app_fullstack_ts.apply(tmpdir, name="acme", features=["auth", "users"])
    base = Path(tmpdir) / "apps/server/src/users"
    for f in ("dto.ts", "logic.ts", "logic.spec.ts", "repository.ts",
              "service.ts", "controller.ts", "controller.spec.ts", "module.ts"):
        assert (base / f).exists(), f"missing server/users/{f}"
    web = Path(tmpdir) / "apps/web/src/features/users"
    for f in ("Api.ts", "Slice.ts", "Thunks.ts", "Selectors.ts", "Slice.test.ts"):
        assert (web / f).exists(), f"missing web/features/users/{f}"
    for f in ("ProfileForm.tsx", "UsersList.tsx"):
        assert (Path(tmpdir) / f"apps/web/src/components/{f}").exists()


def test_users_feature_auto_enables_auth(tmpdir):
    result = app_fullstack_ts.apply(tmpdir, name="acme", features=["users"])
    assert result["features"][:2] == ["auth", "users"]
    assert result["auto_added_features"] == ["auth"]
    assert (Path(tmpdir) / "apps/server/src/auth/controller.ts").exists()
    assert (Path(tmpdir) / "apps/web/src/features/auth/Slice.ts").exists()


def test_users_logic_pure(tmpdir):
    app_fullstack_ts.apply(tmpdir, name="acme", features=["auth", "users"])
    logic = (Path(tmpdir) / "apps/server/src/users/logic.ts").read_text()
    code = "\n".join(l for l in logic.splitlines() if not l.lstrip().startswith("//"))
    assert "prisma" not in code.lower()
    assert "@nestjs" not in code.lower()


def test_users_repository_uses_prisma_only(tmpdir):
    app_fullstack_ts.apply(tmpdir, name="acme", features=["auth", "users"])
    repo = (Path(tmpdir) / "apps/server/src/users/repository.ts").read_text()
    assert "PrismaService" in repo
    assert "ForbiddenException" not in repo
    assert "NotFoundException" not in repo


def test_users_controller_no_prisma(tmpdir):
    app_fullstack_ts.apply(tmpdir, name="acme", features=["auth", "users"])
    ctrl = (Path(tmpdir) / "apps/server/src/users/controller.ts").read_text()
    assert "PrismaService" not in ctrl
    assert "this.svc" in ctrl


def test_users_components_no_fetch(tmpdir):
    app_fullstack_ts.apply(tmpdir, name="acme", features=["auth", "users"])
    for c in ("ProfileForm.tsx", "UsersList.tsx"):
        body = (Path(tmpdir) / f"apps/web/src/components/{c}").read_text()
        assert "fetch(" not in body, f"{c} has direct fetch"
        assert "useAppDispatch" in body


def test_users_wires_app_module(tmpdir):
    app_fullstack_ts.apply(tmpdir, name="acme", features=["auth", "users"])
    am = (Path(tmpdir) / "apps/server/src/app.module.ts").read_text()
    assert "UsersModule" in am
    assert "import { UsersModule }" in am


def test_users_wires_root_reducer(tmpdir):
    app_fullstack_ts.apply(tmpdir, name="acme", features=["auth", "users"])
    rr = (Path(tmpdir) / "apps/web/src/app/rootReducer.ts").read_text()
    assert "usersReducer" in rr
    assert "users: usersReducer" in rr


def test_users_does_not_redeclare_user_model(tmpdir):
    app_fullstack_ts.apply(tmpdir, name="acme", features=["auth", "users"])
    schema = (Path(tmpdir) / "apps/server/prisma/schema.prisma").read_text()
    assert schema.count("model User ") == 1


def test_settings_feature_emits_layered_files(tmpdir):
    app_fullstack_ts.apply(tmpdir, name="acme", features=["auth", "settings"])
    base = Path(tmpdir) / "apps/server/src/settings"
    for f in ("dto.ts", "logic.ts", "logic.spec.ts", "repository.ts",
              "service.ts", "controller.ts", "controller.spec.ts", "module.ts"):
        assert (base / f).exists(), f"missing server/settings/{f}"
    web = Path(tmpdir) / "apps/web/src/features/settings"
    for f in ("Api.ts", "Slice.ts", "Thunks.ts", "Selectors.ts", "Slice.test.ts"):
        assert (web / f).exists(), f"missing web/features/settings/{f}"
    for f in ("ThemeToggle.tsx", "SettingsForm.tsx"):
        assert (Path(tmpdir) / f"apps/web/src/components/{f}").exists()


def test_settings_feature_auto_enables_auth(tmpdir):
    result = app_fullstack_ts.apply(tmpdir, name="acme", features=["settings"])
    assert result["features"][:2] == ["auth", "settings"]
    assert result["auto_added_features"] == ["auth"]


def test_settings_logic_pure(tmpdir):
    app_fullstack_ts.apply(tmpdir, name="acme", features=["auth", "settings"])
    logic = (Path(tmpdir) / "apps/server/src/settings/logic.ts").read_text()
    code = "\n".join(l for l in logic.splitlines() if not l.lstrip().startswith("//"))
    assert "prisma" not in code.lower()
    assert "@nestjs" not in code.lower()


def test_settings_controller_no_prisma(tmpdir):
    app_fullstack_ts.apply(tmpdir, name="acme", features=["auth", "settings"])
    ctrl = (Path(tmpdir) / "apps/server/src/settings/controller.ts").read_text()
    assert "PrismaService" not in ctrl
    assert "this.svc" in ctrl


def test_settings_components_no_fetch(tmpdir):
    app_fullstack_ts.apply(tmpdir, name="acme", features=["auth", "settings"])
    for c in ("ThemeToggle.tsx", "SettingsForm.tsx"):
        body = (Path(tmpdir) / f"apps/web/src/components/{c}").read_text()
        assert "fetch(" not in body, f"{c} has direct fetch"


def test_settings_wires_app_module(tmpdir):
    app_fullstack_ts.apply(tmpdir, name="acme", features=["auth", "settings"])
    am = (Path(tmpdir) / "apps/server/src/app.module.ts").read_text()
    assert "SettingsModule" in am


def test_settings_wires_root_reducer(tmpdir):
    app_fullstack_ts.apply(tmpdir, name="acme", features=["auth", "settings"])
    rr = (Path(tmpdir) / "apps/web/src/app/rootReducer.ts").read_text()
    assert "settingsReducer" in rr
    assert "settings: settingsReducer" in rr


def test_settings_adds_user_settings_model(tmpdir):
    app_fullstack_ts.apply(tmpdir, name="acme", features=["auth", "settings"])
    schema = (Path(tmpdir) / "apps/server/prisma/schema.prisma").read_text()
    assert "model UserSettings" in schema


def test_uploads_feature_emits_layered_files(tmpdir):
    app_fullstack_ts.apply(tmpdir, name="acme", features=["auth", "uploads"])
    base = Path(tmpdir) / "apps/server/src/uploads"
    for f in ("dto.ts", "logic.ts", "logic.spec.ts", "repository.ts", "storage.ts",
              "service.ts", "controller.ts", "controller.spec.ts", "module.ts"):
        assert (base / f).exists(), f"missing server/uploads/{f}"
    web = Path(tmpdir) / "apps/web/src/features/uploads"
    for f in ("Api.ts", "Slice.ts", "Thunks.ts", "Selectors.ts", "Slice.test.ts"):
        assert (web / f).exists(), f"missing web/features/uploads/{f}"
    assert (Path(tmpdir) / "apps/web/src/components/UploadForm.tsx").exists()


def test_uploads_feature_auto_enables_auth(tmpdir):
    result = app_fullstack_ts.apply(tmpdir, name="acme", features=["uploads"])
    assert result["features"][:2] == ["auth", "uploads"]
    assert result["auto_added_features"] == ["auth"]


def test_uploads_logic_pure(tmpdir):
    app_fullstack_ts.apply(tmpdir, name="acme", features=["auth", "uploads"])
    logic = (Path(tmpdir) / "apps/server/src/uploads/logic.ts").read_text()
    code = "\n".join(l for l in logic.splitlines() if not l.lstrip().startswith("//"))
    assert "prisma" not in code.lower()
    assert "@nestjs" not in code.lower()


def test_uploads_controller_no_prisma(tmpdir):
    app_fullstack_ts.apply(tmpdir, name="acme", features=["auth", "uploads"])
    ctrl = (Path(tmpdir) / "apps/server/src/uploads/controller.ts").read_text()
    assert "PrismaService" not in ctrl
    assert "this.svc" in ctrl


def test_uploads_component_no_fetch(tmpdir):
    app_fullstack_ts.apply(tmpdir, name="acme", features=["auth", "uploads"])
    body = (Path(tmpdir) / "apps/web/src/components/UploadForm.tsx").read_text()
    assert "fetch(" not in body
    assert "useAppDispatch" in body


def test_uploads_wires_app_module(tmpdir):
    app_fullstack_ts.apply(tmpdir, name="acme", features=["auth", "uploads"])
    am = (Path(tmpdir) / "apps/server/src/app.module.ts").read_text()
    assert "UploadsModule" in am


def test_uploads_wires_root_reducer(tmpdir):
    app_fullstack_ts.apply(tmpdir, name="acme", features=["auth", "uploads"])
    rr = (Path(tmpdir) / "apps/web/src/app/rootReducer.ts").read_text()
    assert "uploadsReducer" in rr


def test_uploads_adds_file_blob_model(tmpdir):
    app_fullstack_ts.apply(tmpdir, name="acme", features=["auth", "uploads"])
    schema = (Path(tmpdir) / "apps/server/prisma/schema.prisma").read_text()
    assert "model FileBlob" in schema


def test_dashboard_feature_emits_layered_files(tmpdir):
    app_fullstack_ts.apply(tmpdir, name="acme", features=["auth", "dashboard"])
    base = Path(tmpdir) / "apps/server/src/dashboard"
    for f in ("logic.ts", "logic.spec.ts", "repository.ts", "service.ts",
              "controller.ts", "controller.spec.ts", "module.ts"):
        assert (base / f).exists()
    web = Path(tmpdir) / "apps/web/src/features/dashboard"
    for f in ("Api.ts", "Slice.ts", "Thunks.ts", "Selectors.ts", "Slice.test.ts"):
        assert (web / f).exists()
    assert (Path(tmpdir) / "apps/web/src/components/DashboardCard.tsx").exists()


def test_dashboard_feature_auto_enables_auth(tmpdir):
    result = app_fullstack_ts.apply(tmpdir, name="acme", features=["dashboard"])
    assert result["features"][:2] == ["auth", "dashboard"]
    assert result["auto_added_features"] == ["auth"]


def test_dashboard_wires_root(tmpdir):
    app_fullstack_ts.apply(tmpdir, name="acme", features=["auth", "dashboard"])
    am = (Path(tmpdir) / "apps/server/src/app.module.ts").read_text()
    assert "DashboardModule" in am
    rr = (Path(tmpdir) / "apps/web/src/app/rootReducer.ts").read_text()
    assert "dashboard: dashboardReducer" in rr


def test_dashboard_card_no_fetch(tmpdir):
    app_fullstack_ts.apply(tmpdir, name="acme", features=["auth", "dashboard"])
    body = (Path(tmpdir) / "apps/web/src/components/DashboardCard.tsx").read_text()
    assert "fetch(" not in body
    assert "useAppSelector" in body


def test_notifications_feature_emits_files(tmpdir):
    app_fullstack_ts.apply(tmpdir, name="acme", features=["notifications"])
    web = Path(tmpdir) / "apps/web/src/features/notifications"
    for f in ("Slice.ts", "Selectors.ts", "Slice.test.ts"):
        assert (web / f).exists()
    assert (Path(tmpdir) / "apps/web/src/components/Toaster.tsx").exists()


def test_notifications_wires_root_reducer_only(tmpdir):
    app_fullstack_ts.apply(tmpdir, name="acme", features=["notifications"])
    rr = (Path(tmpdir) / "apps/web/src/app/rootReducer.ts").read_text()
    assert "notifications: notificationsReducer" in rr
    am = (Path(tmpdir) / "apps/server/src/app.module.ts").read_text()
    assert "Notifications" not in am


def test_notifications_toaster_no_fetch(tmpdir):
    app_fullstack_ts.apply(tmpdir, name="acme", features=["notifications"])
    body = (Path(tmpdir) / "apps/web/src/components/Toaster.tsx").read_text()
    assert "fetch(" not in body


def test_no_features_keeps_clean_app(tmpdir):
    app_fullstack_ts.apply(tmpdir, name="acme")
    app = (Path(tmpdir) / "apps/web/src/App.tsx").read_text()
    assert "AuthGate" not in app
    am = (Path(tmpdir) / "apps/server/src/app.module.ts").read_text()
    assert "AuthModule" not in am
