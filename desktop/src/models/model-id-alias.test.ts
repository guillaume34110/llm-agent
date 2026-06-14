import { describe, expect, it } from 'vitest';
import { canonicalModelId, resolveModelIdAlias } from './model-id-alias';

describe('model id aliases', () => {
  it('canonicalizes legacy bundled ids to backend ids', () => {
    expect(canonicalModelId('phi-4-mini-instruct')).toBe('phi-4-mini:3.8b');
    expect(canonicalModelId('qwen3-8b')).toBe('qwen3:8b');
  });

  it('resolves to an available alias when ids differ across layers', () => {
    expect(resolveModelIdAlias('phi-4-mini-instruct', ['phi-4-mini:3.8b', 'phi-4:14b'])).toBe('phi-4-mini:3.8b');
    expect(resolveModelIdAlias('qwen3:8b', ['qwen3-8b'])).toBe('qwen3-8b');
  });
});
