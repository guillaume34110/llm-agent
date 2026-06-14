import { invoke } from '@tauri-apps/api/core';

export async function dbQuery<T = unknown[]>(sql: string, params: unknown[] = []): Promise<T[]> {
  const rows = await invoke<unknown[][]>('db_query', { sql, paramsJson: JSON.stringify(params) });
  return rows as T[];
}

export async function dbExecute(sql: string, params: unknown[] = []): Promise<number> {
  return invoke<number>('db_execute', { sql, paramsJson: JSON.stringify(params) });
}

export async function dbExecuteBatch(sql: string): Promise<void> {
  await invoke<void>('db_execute_batch', { sql });
}

export function vecToBlob(vec: number[]): number[] {
  // serialize Float32 array to Vec<u8>
  const buf = new ArrayBuffer(vec.length * 4);
  const f32 = new Float32Array(buf);
  for (let i = 0; i < vec.length; i++) f32[i] = vec[i];
  return Array.from(new Uint8Array(buf));
}

export function blobToVec(blob: number[] | Uint8Array): number[] {
  const u8 = blob instanceof Uint8Array ? blob : new Uint8Array(blob);
  const f32 = new Float32Array(u8.buffer, u8.byteOffset, u8.byteLength / 4);
  return Array.from(f32);
}

export function cosine(a: number[], b: number[]): number {
  if (!a.length || !b.length || a.length !== b.length) return 0;
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na === 0 || nb === 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb));
}
