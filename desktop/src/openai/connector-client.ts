// OpenAI-compatible connector — TS bridge to the Rust HTTP server.
//
// The connector exposes an OpenAI /v1 surface on 127.0.0.1 so external apps
// (LangChain, LiteLLM, IDE plugins, curl scripts) can route through MonkeyAgent's
// transport stack (local llama → own devices → friend providers) without
// embedding a Tauri webview.
//
// JWT rotates on login — call setCredentials({ jwt }) after every relogin so
// the running connector can keep authenticating presence queries.

import { invoke } from '@tauri-apps/api/core';
import { catalogByModality } from '../models/catalog';

const backendUrl = (import.meta as any).env?.VITE_BACKEND_URL || 'http://localhost:3469';

export interface ConnectorInfo {
  running: boolean;
  port: number | null;
  url: string | null;
  apiKey: string;
}

export async function getConnectorStatus(): Promise<ConnectorInfo> {
  return invoke<ConnectorInfo>('openai_connector_status');
}

export async function startConnector(opts?: {
  port?: number;
  jwt?: string;
  serverBase?: string;
  models?: string[];
}): Promise<ConnectorInfo> {
  const jwt = opts?.jwt ?? localStorage.getItem('jwt') ?? '';
  const serverBase = opts?.serverBase ?? backendUrl;
  const models = opts?.models ?? catalogByModality('chat').map((m) => m.id);
  return invoke<ConnectorInfo>('openai_connector_start', {
    jwt,
    serverBase,
    models,
    port: opts?.port ?? null,
  });
}

export async function stopConnector(): Promise<void> {
  await invoke('openai_connector_stop');
}

export async function setConnectorCredentials(opts: {
  jwt?: string;
  serverBase?: string;
  models?: string[];
}): Promise<void> {
  await invoke('openai_connector_set_credentials', {
    jwt: opts.jwt ?? null,
    serverBase: opts.serverBase ?? null,
    models: opts.models ?? null,
  });
}

// Generates a fresh key and persists it. The running instance keeps validating
// against its boot-time key — caller must stop+start for the new key to apply.
export async function regenerateConnectorKey(): Promise<string> {
  return invoke<string>('openai_connector_regenerate_key');
}
