import { describe, it, expect } from 'vitest';
import {
  CATALOG,
  catalogByModality,
  findByGgufFile,
  findCatalogModel,
  verifyDigest,
  DEFAULT_MODEL_ID,
  type Modality,
} from './catalog';

const MODALITIES: Modality[] = ['chat', 'embed', 'image', 'transcribe', 'tts'];

describe('catalog', () => {
  it('covers all 5 modalities', () => {
    for (const m of MODALITIES) {
      expect(catalogByModality(m).length).toBeGreaterThan(0);
    }
  });

  it('has chat entries from each of the 3 families (phi, llama, qwen)', () => {
    const chat = catalogByModality('chat');
    const families = new Set(chat.map(m => m.family));
    expect(families.has('phi')).toBe(true);
    expect(families.has('llama')).toBe(true);
    expect(families.has('qwen')).toBe(true);
  });

  it('has unique ids', () => {
    const ids = CATALOG.map(m => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has unique ggufFile names', () => {
    const files = CATALOG.map(m => m.ggufFile.toLowerCase());
    expect(new Set(files).size).toBe(files.length);
  });

  it('populates kvCacheBytesPerToken for chat & embed', () => {
    for (const m of [...catalogByModality('chat'), ...catalogByModality('embed')]) {
      expect(m.kvCacheBytesPerToken).toBeGreaterThan(0);
      expect(m.peakRamBytes).toBe(0);
    }
  });

  it('populates peakRamBytes for image / transcribe / tts (not kv cache)', () => {
    for (const m of [
      ...catalogByModality('image'),
      ...catalogByModality('transcribe'),
      ...catalogByModality('tts'),
    ]) {
      expect(m.peakRamBytes).toBeGreaterThan(0);
      expect(m.kvCacheBytesPerToken).toBe(0);
    }
  });

  it('every entry has a positive throughput floor and sizeBytes', () => {
    for (const m of CATALOG) {
      expect(m.sizeBytes).toBeGreaterThan(0);
      expect(m.minThroughputBytesPerSec).toBeGreaterThan(0);
      expect(m.contextLen).toBeGreaterThan(0);
    }
  });

  it('every entry has a runtime consistent with its modality', () => {
    for (const m of CATALOG) {
      if (m.modality === 'chat' || m.modality === 'embed') expect(m.runtime).toBe('llama');
      if (m.modality === 'image') expect(m.runtime).toBe('sd');
      if (m.modality === 'transcribe') expect(m.runtime).toBe('whisper');
      if (m.modality === 'tts') expect(m.runtime).toBe('piper');
    }
  });

  it('sha256 empty → verifyDigest returns false (blocks activation)', () => {
    for (const m of CATALOG) {
      if (!m.sha256) {
        expect(verifyDigest(m, 'a'.repeat(64))).toBe(false);
      }
    }
  });

  it('verifyDigest is case-insensitive', () => {
    const m = { ...CATALOG[0], sha256: 'ABCDEF0123' };
    expect(verifyDigest(m, 'abcdef0123')).toBe(true);
    expect(verifyDigest(m, 'abcdef0124')).toBe(false);
  });

  it('findCatalogModel / findByGgufFile resolve the default chat model', () => {
    const def = findCatalogModel(DEFAULT_MODEL_ID);
    expect(def).toBeDefined();
    expect(def!.modality).toBe('chat');
    const byFile = findByGgufFile(def!.ggufFile.toUpperCase());
    expect(byFile?.id).toBe(def!.id);
  });
});
