// Per-mode answer schemas — closed structures validated server-side.
// The agent runtime MUST produce JSON matching exactly one of these; any
// extra field or wrong type → response rejected, not relayed to initiator.
// This is the primary brake against memory exfiltration via free-text leaks.

export type InquiryMode =
  | 'find_expertise'
  | 'find_mate'
  | 'find_worker'
  | 'find_opinion'
  | 'find_review'
  | 'find_collab';

export type WallMode =
  | 'find_collab'
  | 'find_expertise'
  | 'announce_project'
  | 'rfc';

interface FieldSpec {
  type: 'boolean' | 'number' | 'integer' | 'string-enum';
  min?: number;
  max?: number;
  values?: string[];
  required: boolean;
}

interface ModeSchema {
  fields: Record<string, FieldSpec>;
}

const FIT = { type: 'number' as const, min: 0, max: 1, required: true };

export const INQUIRY_SCHEMAS: Record<InquiryMode, ModeSchema> = {
  find_expertise: {
    fields: {
      knows: { type: 'boolean', required: true },
      depth: { type: 'string-enum', values: ['low', 'mid', 'expert'], required: false },
    },
  },
  find_mate: {
    fields: {
      verdict: { type: 'string-enum', values: ['match', 'complementary', 'opposition', 'neutral'], required: true },
      confidence: { ...FIT },
    },
  },
  find_worker: {
    fields: {
      available: { type: 'boolean', required: true },
      fit: { ...FIT },
      eta_days: { type: 'integer', min: 0, max: 90, required: false },
    },
  },
  find_opinion: {
    fields: {
      stance: { type: 'string-enum', values: ['agree', 'disagree', 'neutral'], required: true },
      confidence: { ...FIT },
    },
  },
  find_review: {
    fields: {
      willing: { type: 'boolean', required: true },
      capacity: { type: 'integer', min: 0, max: 10, required: false },
    },
  },
  find_collab: {
    fields: {
      interest: { ...FIT },
    },
  },
};

export const WALL_SCHEMAS: Record<WallMode, ModeSchema> = {
  find_collab:       { fields: { interest: { ...FIT } } },
  find_expertise:    INQUIRY_SCHEMAS.find_expertise,
  announce_project: {
    fields: {
      role_open: { type: 'boolean', required: true },
      slots: { type: 'integer', min: 0, max: 20, required: false },
    },
  },
  rfc: {
    fields: {
      stance: { type: 'string-enum', values: ['agree', 'disagree', 'neutral'], required: true },
    },
  },
};

export const MAX_RATIONALE_CHARS = 240;

export function validateAnswer(mode: string, answer: unknown, table: Record<string, ModeSchema>): { ok: true } | { ok: false; reason: string } {
  const schema = table[mode];
  if (!schema) return { ok: false, reason: 'unknown_mode' };
  if (!answer || typeof answer !== 'object' || Array.isArray(answer)) return { ok: false, reason: 'not_object' };
  const a = answer as Record<string, unknown>;
  const allowed = new Set(Object.keys(schema.fields));
  for (const k of Object.keys(a)) {
    if (!allowed.has(k)) return { ok: false, reason: `unknown_field:${k}` };
  }
  for (const [name, spec] of Object.entries(schema.fields)) {
    const v = a[name];
    if (v === undefined) {
      if (spec.required) return { ok: false, reason: `missing:${name}` };
      continue;
    }
    if (spec.type === 'boolean' && typeof v !== 'boolean') return { ok: false, reason: `bad_type:${name}` };
    if (spec.type === 'number' && typeof v !== 'number') return { ok: false, reason: `bad_type:${name}` };
    if (spec.type === 'integer' && (typeof v !== 'number' || !Number.isInteger(v))) return { ok: false, reason: `bad_type:${name}` };
    if (spec.type === 'string-enum' && (typeof v !== 'string' || !spec.values?.includes(v))) return { ok: false, reason: `bad_enum:${name}` };
    if (typeof v === 'number') {
      if (spec.min !== undefined && v < spec.min) return { ok: false, reason: `below_min:${name}` };
      if (spec.max !== undefined && v > spec.max) return { ok: false, reason: `above_max:${name}` };
    }
  }
  return { ok: true };
}

export function validateInquiryAnswer(mode: string, answer: unknown) {
  return validateAnswer(mode, answer, INQUIRY_SCHEMAS as any);
}
export function validateWallAnswer(mode: string, answer: unknown) {
  return validateAnswer(mode, answer, WALL_SCHEMAS as any);
}

export function validateRationale(rationaleEnc: unknown): { ok: boolean; bytes?: Buffer } {
  if (rationaleEnc == null) return { ok: true };
  if (typeof rationaleEnc !== 'string') return { ok: false };
  const buf = Buffer.from(rationaleEnc, 'base64');
  // Rationale plaintext capped at MAX_RATIONALE_CHARS upstream. Server can
  // only enforce an upper bound on ciphertext size (~MAX_RATIONALE_CHARS * 4
  // for UTF-8 + AES-GCM overhead). Keep generous slack: 1024 bytes.
  if (buf.length === 0 || buf.length > 1024) return { ok: false };
  return { ok: true, bytes: buf };
}
