// Persistent record of the user's age + ToS/Privacy/AI-disclosure consent.
// Stored as a single global key (NOT animal-scoped) so changing animal does not reset it.
// Bumping CONSENT_VERSION forces re-acceptance after a material policy change.

export const CONSENT_VERSION = 1;
const STORAGE_KEY = 'compliance-consent';

export interface ConsentRecord {
  version: number;
  acceptedAt: number; // epoch ms
  ageConfirmed: boolean;
  consentDataProcessing: boolean;
}

export interface ConsentStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): ConsentStorage | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage;
}

export function readConsent(storage: ConsentStorage | null = defaultStorage()): ConsentRecord | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ConsentRecord;
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.version !== CONSENT_VERSION) return null;
    if (!parsed.ageConfirmed || !parsed.consentDataProcessing) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function hasValidConsent(storage: ConsentStorage | null = defaultStorage()): boolean {
  return readConsent(storage) !== null;
}

export function writeConsent(
  fields: { ageConfirmed: boolean; consentDataProcessing: boolean },
  storage: ConsentStorage | null = defaultStorage(),
): ConsentRecord | null {
  if (!storage) return null;
  if (!fields.ageConfirmed || !fields.consentDataProcessing) return null;
  const record: ConsentRecord = {
    version: CONSENT_VERSION,
    acceptedAt: Date.now(),
    ageConfirmed: true,
    consentDataProcessing: true,
  };
  storage.setItem(STORAGE_KEY, JSON.stringify(record));
  return record;
}

export function revokeConsent(storage: ConsentStorage | null = defaultStorage()): void {
  if (!storage) return;
  storage.removeItem(STORAGE_KEY);
}
