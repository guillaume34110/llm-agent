# Release CI — How it works

Every push to `main` triggers a 3-platform build pipeline that produces installable desktop apps and uploads them to the backend.

## What gets built

| Platform | Runner | Binary | Installer |
|----------|--------|--------|-----------|
| macOS (ARM) | `macos-latest` | `monkey-aarch64-apple-darwin` | `.dmg` |
| Windows | `windows-latest` | `monkey-x86_64-pc-windows-msvc.exe` | `.msi` |
| Linux | `ubuntu-22.04` | `monkey-x86_64-unknown-linux-gnu` | `.AppImage` |

## Pipeline steps (per platform)

```
1. PyInstaller — builds the monkey Python agent into a single binary
2. Copy binary → desktop/src-tauri/binaries/ (Tauri sidecar slot)
3. npm run tauri build — compiles Rust shell + bundles frontend + sidecar
4. curl → POST /api/admin/app/upload — uploads installer to backend DB
```

Users then download from the web frontend (`/api/downloads/app/:platform`).

## First-time setup

### 1. Add GitHub secrets

Go to your repo → **Settings → Secrets and variables → Actions → New repository secret**

| Secret | Value |
|--------|-------|
| `BACKEND_URL` | Your deployed backend URL, no trailing slash — e.g. `https://api.progsoft.ai` |
| `ADMIN_KEY` | Value of `ADMIN_KEY` in your production `.env` |

### 2. Push to main

```bash
git push origin main
```

The workflow starts automatically. Monitor it at:
`https://github.com/<your-org>/<repo>/actions`

### 3. Verify upload

```bash
curl https://your-backend.com/api/downloads/app | jq .
# → [{platform:"macos",...},{platform:"windows",...},{platform:"linux",...}]
```

The download buttons appear automatically on the web frontend once all 3 platforms are uploaded.

## Trigger manually

Go to Actions → Release → **Run workflow** → select `main` → Run.

## Build times

- First run: ~20-25 min (Rust compiles from scratch, cached after)
- Subsequent runs: ~10-15 min (cargo cache warm)

## Bump version

Edit `desktop/package.json` → `"version"` field. The CI picks it up automatically.

```json
{
  "version": "0.2.0"
}
```

## Troubleshooting

**PyInstaller fails on Windows:** Hidden imports may be missing. Add `--hidden-import=<module>` to the pyinstaller step in `.github/workflows/release.yml`.

**Tauri build fails — "binary not found":** The sidecar binary must be in `desktop/src-tauri/binaries/` with the exact triple suffix before `tauri build` runs. Check the "Place sidecar" step output.

**Upload fails (curl exit non-zero):** Check that `BACKEND_URL` has no trailing slash and `ADMIN_KEY` matches the backend env var exactly.

**Linux webkit error:** If a new Ubuntu runner version ships, update the apt packages in the "Install Linux system deps" step. Required: `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev`, `patchelf`, `libssl-dev`, `libgtk-3-dev`.

**`browser_navigate` tool doesn't work after install:** The Playwright browsers are not bundled. Users must run `playwright install chromium` once. All other tools (fetch, search, files, shell) work without it.
