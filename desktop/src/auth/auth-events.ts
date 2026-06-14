// Global unauthorized handler. Installed once at app boot, watches every
// fetch to the backend (VITE_BACKEND_URL). When the server returns 401 we
// purge the JWT, notify the OpenAI connector to drop its cached token, and
// emit a CustomEvent so App.tsx can route back to the login screen.
//
// Why a global hook: dozens of files do `fetch(`${backendUrl}/...`)` with
// their own `authHeaders()` helper. Migrating them all to a wrapper would be
// invasive and easy to miss. Hooking `window.fetch` once catches everything,
// existing and future.
//
// Re-entrancy: signOut() itself calls fetch on /api/auth/logout — we must
// never recurse on its 401. A boolean latch covers that, and an in-flight
// guard avoids stacking events when many parallel calls fail at once.
//
// Scope: only requests whose URL starts with backendUrl trigger the handler.
// The sidecar (baseUrl) and Ollama do not use this token.

import { setConnectorCredentials } from '../openai/connector-client';

const EVENT_NAME = 'app:unauthorized';
const backendUrl = (import.meta as any).env?.VITE_BACKEND_URL || 'http://localhost:3469';

let installed = false;
let firing = false;

function purgeJwt() {
  try { localStorage.removeItem('jwt'); } catch {}
  setConnectorCredentials({ jwt: '' }).catch(() => {});
}

export function signalUnauthorized() {
  if (firing) return;
  firing = true;
  purgeJwt();
  try { window.dispatchEvent(new CustomEvent(EVENT_NAME)); } catch {}
  setTimeout(() => { firing = false; }, 500);
}

export function subscribeUnauthorized(cb: () => void): () => void {
  const handler = () => cb();
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}

export function installFetchAuthInterceptor() {
  if (installed) return;
  installed = true;
  const orig = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const res = await orig(input, init);
    if (res.status !== 401) return res;
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    if (!url.startsWith(backendUrl)) return res;
    // Whitelist endpoints that legitimately 401 without meaning the session
    // died: login itself returns 401 on wrong password, and logout doesn't
    // care if the token is already invalid.
    if (url.includes('/api/auth/login') || url.includes('/api/auth/logout')) {
      return res;
    }
    signalUnauthorized();
    return res;
  };
}
