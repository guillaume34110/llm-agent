// Stable per-install device identifier. Tauri scopes localStorage to the
// app's data dir on disk, so each install has its own value. Survives app
// restarts. Server uses (userId, deviceId, modelId) to keep multiple devices
// of the same user listed as distinct providers.
const STORAGE_KEY = 'monkey-device-id';

export function getDeviceId(): string {
  let id = localStorage.getItem(STORAGE_KEY);
  if (id && /^[A-Za-z0-9_-]{8,128}$/.test(id)) return id;
  id = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID()
    : `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  localStorage.setItem(STORAGE_KEY, id);
  return id;
}
