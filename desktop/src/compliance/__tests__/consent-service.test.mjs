// Pure-logic smoke test for consent-service. Runs under plain node with esbuild-register or tsx.
// Not wired to a runner — invoked manually: `npx tsx desktop/src/compliance/__tests__/consent-service.test.mjs`
import assert from 'node:assert/strict';

const mod = await import('../consent-service.ts').catch(async () => {
  // Fallback for environments without TS loader: compile inline.
  const { build } = await import('esbuild');
  const out = await build({ entryPoints: [new URL('../consent-service.ts', import.meta.url).pathname], bundle: false, write: false, format: 'esm', target: 'node20' });
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64');
  return import(dataUrl);
});

const { readConsent, hasValidConsent, writeConsent, revokeConsent, CONSENT_VERSION } = mod;

function makeStorage() {
  const map = new Map();
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
    removeItem: k => map.delete(k),
    _dump: () => Object.fromEntries(map),
  };
}

// 1. Empty storage = no consent.
{
  const s = makeStorage();
  assert.equal(hasValidConsent(s), false);
  assert.equal(readConsent(s), null);
}

// 2. writeConsent rejects partial accept.
{
  const s = makeStorage();
  assert.equal(writeConsent({ ageConfirmed: false, consentDataProcessing: true }, s), null);
  assert.equal(writeConsent({ ageConfirmed: true, consentDataProcessing: false }, s), null);
  assert.equal(hasValidConsent(s), false);
}

// 3. Full accept persists and reads back.
{
  const s = makeStorage();
  const rec = writeConsent({ ageConfirmed: true, consentDataProcessing: true }, s);
  assert.ok(rec);
  assert.equal(rec.version, CONSENT_VERSION);
  assert.equal(rec.ageConfirmed, true);
  assert.equal(rec.consentDataProcessing, true);
  assert.ok(rec.acceptedAt > 0);
  assert.equal(hasValidConsent(s), true);
}

// 4. Version mismatch invalidates.
{
  const s = makeStorage();
  s.setItem('compliance-consent', JSON.stringify({
    version: CONSENT_VERSION + 99,
    acceptedAt: Date.now(),
    ageConfirmed: true,
    consentDataProcessing: true,
  }));
  assert.equal(hasValidConsent(s), false);
}

// 5. Corrupted JSON does not throw.
{
  const s = makeStorage();
  s.setItem('compliance-consent', 'not-json{');
  assert.equal(readConsent(s), null);
  assert.equal(hasValidConsent(s), false);
}

// 6. revokeConsent clears.
{
  const s = makeStorage();
  writeConsent({ ageConfirmed: true, consentDataProcessing: true }, s);
  assert.equal(hasValidConsent(s), true);
  revokeConsent(s);
  assert.equal(hasValidConsent(s), false);
}

console.log('OK consent-service: 6 cases pass');
