import { Logger } from '@nestjs/common';

const log = new Logger('Resilience');

export interface RetryOpts {
  attempts?: number;
  backoffMs?: number[];
  shouldRetry?: (e: any) => boolean;
  label?: string;
}

const DEFAULT_BACKOFF = [500, 1500, 4000];

const DEFAULT_SHOULD_RETRY = (e: any): boolean => {
  if (!e) return false;
  if (e?.code === 'ECONNRESET' || e?.code === 'ETIMEDOUT' || e?.code === 'ECONNABORTED' || e?.code === 'EAI_AGAIN' || e?.code === 'ENOTFOUND') return true;
  const status = e?.response?.status;
  if (typeof status === 'number') {
    if (status === 408 || status === 425 || status === 429) return true;
    if (status >= 500 && status < 600) return true;
  }
  return false;
};

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOpts = {}): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const backoff = opts.backoffMs ?? DEFAULT_BACKOFF;
  const shouldRetry = opts.shouldRetry ?? DEFAULT_SHOULD_RETRY;
  const label = opts.label ?? 'op';
  let lastErr: any;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); }
    catch (e: any) {
      lastErr = e;
      if (i === attempts - 1) break;
      if (!shouldRetry(e)) break;
      const wait = backoff[Math.min(i, backoff.length - 1)];
      log.warn(`${label} attempt ${i + 1}/${attempts} failed (${e?.code ?? e?.response?.status ?? 'err'}); retrying in ${wait}ms`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

interface BreakerEntry {
  failures: number;
  openedAt: number | null;
  lastFailure: number;
}

const FAIL_THRESHOLD = 5;
const COOLDOWN_MS = 30_000;
const FAIL_WINDOW_MS = 60_000;

const breakers = new Map<string, BreakerEntry>();

export function circuitOk(host: string): boolean {
  const e = breakers.get(host);
  if (!e?.openedAt) return true;
  if (Date.now() - e.openedAt >= COOLDOWN_MS) {
    breakers.set(host, { failures: 0, openedAt: null, lastFailure: 0 });
    return true;
  }
  return false;
}

export function circuitRecord(host: string, ok: boolean): void {
  let e = breakers.get(host);
  if (!e) { e = { failures: 0, openedAt: null, lastFailure: 0 }; breakers.set(host, e); }
  if (ok) {
    if (e.failures > 0) e.failures = 0;
    return;
  }
  const now = Date.now();
  if (now - e.lastFailure > FAIL_WINDOW_MS) e.failures = 0;
  e.failures++;
  e.lastFailure = now;
  if (e.failures >= FAIL_THRESHOLD && !e.openedAt) {
    e.openedAt = now;
    log.warn(`circuit OPEN for ${host} (${e.failures} failures)`);
  }
}

export async function withCircuit<T>(host: string, fn: () => Promise<T>): Promise<T> {
  if (!circuitOk(host)) throw new Error(`circuit-open: ${host} (cooling down)`);
  try {
    const r = await fn();
    circuitRecord(host, true);
    return r;
  } catch (e) {
    circuitRecord(host, false);
    throw e;
  }
}

export async function resilient<T>(label: string, host: string, fn: () => Promise<T>, retry: RetryOpts = {}): Promise<T> {
  return withCircuit(host, () => withRetry(fn, { ...retry, label: retry.label ?? label }));
}
