import {
  validateInquiryAnswer,
  validateWallAnswer,
  validateRationale,
} from '../src/social/schemas';
import { isValidTag, sanitizeTags, MAX_USER_TAGS } from '../src/social/tags';

describe('inquiry schemas — primary memory exfiltration brake', () => {
  it('accepts well-formed find_expertise answers', () => {
    expect(validateInquiryAnswer('find_expertise', { knows: true })).toEqual({ ok: true });
    expect(validateInquiryAnswer('find_expertise', { knows: false, depth: 'mid' })).toEqual({ ok: true });
  });

  it('rejects unknown fields (anti-leak)', () => {
    const r = validateInquiryAnswer('find_expertise', { knows: true, secret: 'memory dump' });
    expect(r.ok).toBe(false);
  });

  it('rejects wrong types and out-of-range numbers', () => {
    expect(validateInquiryAnswer('find_mate', { verdict: 'match', confidence: 1.5 }).ok).toBe(false);
    expect(validateInquiryAnswer('find_worker', { available: 'yes', fit: 0.5 }).ok).toBe(false);
    expect(validateInquiryAnswer('find_review', { willing: true, capacity: 99 }).ok).toBe(false);
  });

  it('rejects missing required field', () => {
    expect(validateInquiryAnswer('find_opinion', { confidence: 0.8 }).ok).toBe(false);
  });

  it('rejects unknown mode', () => {
    expect(validateInquiryAnswer('find_secret', { x: 1 }).ok).toBe(false);
  });

  it('rejects array/non-object answer', () => {
    expect(validateInquiryAnswer('find_expertise', [true]).ok).toBe(false);
    expect(validateInquiryAnswer('find_expertise', null).ok).toBe(false);
  });
});

describe('wall schemas', () => {
  it('validates announce_project + rfc', () => {
    expect(validateWallAnswer('announce_project', { role_open: true, slots: 3 })).toEqual({ ok: true });
    expect(validateWallAnswer('rfc', { stance: 'agree' })).toEqual({ ok: true });
    expect(validateWallAnswer('rfc', { stance: 'maybe' }).ok).toBe(false);
  });
});

describe('rationale ciphertext bound', () => {
  it('rejects empty', () => {
    expect(validateRationale('').ok).toBe(false);
  });
  it('accepts null/undefined as absent', () => {
    expect(validateRationale(undefined).ok).toBe(true);
    expect(validateRationale(null).ok).toBe(true);
  });
  it('rejects oversized', () => {
    const big = Buffer.alloc(2048).toString('base64');
    expect(validateRationale(big).ok).toBe(false);
  });
});

describe('tags closed vocab', () => {
  it('rejects unknown', () => {
    expect(isValidTag('rust')).toBe(true);
    expect(isValidTag('totally-fake-tag')).toBe(false);
  });
  it('sanitizes to dedup + cap', () => {
    expect(sanitizeTags(['rust', 'rust', 'python', 'totally-fake'])).toEqual(['rust', 'python']);
    expect(sanitizeTags('not array')).toEqual([]);
  });
  it('has MAX_USER_TAGS exported', () => {
    expect(MAX_USER_TAGS).toBeGreaterThan(0);
  });
});
