// Pluggable provider transport. Two implementations live behind this interface:
//   - LocalLlamaTransport    — direct OpenAI-compatible call to the bundled
//                              llama-server sidecar over loopback + bearer token
//   - NoiseP2PTransport      — E2E-encrypted call to a remote provider over
//                              the Noise XK protocol. The remote provider
//                              runs the signed Progsoft binary.
//
// Spec A (2026-05-22): the server hosts presence-only — no jobs, no settle.
// The peer call carries the prompt under Noise and the response comes back
// the same way. No jobId, no per-call payment.

import { invoke } from '@tauri-apps/api/core';
import { listMyDevices, listProviders } from './matchmaking-client';
import { chat as llamaChat, isRunning as isLlamaRunning } from '../llama/client';
import type { ChatCompletionRequest, ChatCompletionResponse, ProviderHandle } from './types';

export interface ProviderTransport {
  chat(req: ChatCompletionRequest): Promise<ChatCompletionResponse>;
}

export class LocalLlamaTransport implements ProviderTransport {
  async chat(req: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const res = await llamaChat({ ...req, messages: req.messages });
    return { text: res.text, tool_calls: res.tool_calls, usage: res.usage };
  }
}

export class NoiseP2PTransport implements ProviderTransport {
  constructor(private provider: ProviderHandle) {}

  async chat(req: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    if (!this.provider.attested) {
      throw new Error('Provider is not attested. Refusing to send prompt.');
    }
    // Hand the work to the Rust side: it owns the Noise XK keypair, drives the
    // handshake against provider.publicKey, encrypts the request, and decrypts
    // the response. The JS side never sees the wire ciphertext.
    const payload: any = { ...req, stream: false };
    const responseJson = await invoke<string>('p2p_noise_chat', {
      endpoint: this.provider.endpoint,
      providerPubkeyB64: this.provider.publicKey,
      requestJson: JSON.stringify(payload),
    });
    const body = JSON.parse(responseJson);
    if (typeof body.text === 'string') {
      return { text: body.text, tool_calls: body.tool_calls, usage: body.usage };
    }
    const choice = body.choices?.[0] ?? {};
    return {
      text: choice.message?.content ?? '',
      tool_calls: choice.message?.tool_calls,
      usage: body.usage,
    };
  }
}

// Pick the best transport for a given model. Order:
//   1. bundled llama runtime on this install
//   2. another device of the same user (own provider running elsewhere)
//   3. mutual-friend P2P provider
//   4. hard error. No cloud fallback.
export async function pickTransport(modelId: string): Promise<ProviderTransport> {
  if (await isLlamaRunning()) {
    return new LocalLlamaTransport();
  }
  try {
    const own = await listMyDevices(modelId);
    // Attested only: NoiseP2PTransport.chat() refuses unattested providers, so
    // picking one here would guarantee a throw at call time AND skip the
    // friends fallback below. Unattested own device → keep falling through.
    const mine = own.providers.find(p => p.attested);
    if (mine) return new NoiseP2PTransport(mine);
  } catch {
    // own-devices lookup failed (offline, auth, etc.) — fall through to friends
  }
  const { providers } = await listProviders(modelId);
  const attested = providers.find(p => p.attested);
  if (attested) {
    return new NoiseP2PTransport(attested);
  }
  throw new Error(
    `No local model active and no P2P provider online for "${modelId}". ` +
    `Activate a model in Settings → Local LLM, or wait for a peer. ` +
    `Cloud fallback is disabled by design.`
  );
}
