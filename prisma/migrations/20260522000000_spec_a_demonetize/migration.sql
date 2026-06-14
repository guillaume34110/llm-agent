-- Spec A (2026-05-22) — demonetization + friend graph pivot.
-- Drop credits, rewards, kudos, jobs, leaderboards.
-- Rebuild ProviderRegistration around (networkAddr, noisePubkey).
-- Add ProviderAcl (per-friend toggle, default OFF).

-- ── Drop obsolete tables ─────────────────────────────────────
DROP TABLE IF EXISTS "ProviderKudos"        CASCADE;
DROP TABLE IF EXISTS "ProviderKudosStats"   CASCADE;
DROP TABLE IF EXISTS "ProviderFirstBonus"   CASCADE;
DROP TABLE IF EXISTS "ProviderUptimeBonus"  CASCADE;
DROP TABLE IF EXISTS "ProviderStats"        CASCADE;
DROP TABLE IF EXISTS "ProviderCapacity"     CASCADE;
DROP TABLE IF EXISTS "P2pJob"               CASCADE;
DROP TABLE IF EXISTS "CreditTransaction"    CASCADE;
DROP TABLE IF EXISTS "LlmCallLog"           CASCADE;
DROP TABLE IF EXISTS "UserAnimal"           CASCADE;
DROP TABLE IF EXISTS "RouteTokenMapping"    CASCADE;
DROP TABLE IF EXISTS "AccessGrant"          CASCADE;
DROP TABLE IF EXISTS "AccessInvite"         CASCADE;

-- ── User: drop credits balance ───────────────────────────────
ALTER TABLE "User" DROP COLUMN IF EXISTS "credits";

-- ── AttestationSample: drop reward bookkeeping ──────────────
ALTER TABLE "AttestationSample" DROP COLUMN IF EXISTS "rewardedCents";

-- ── ModelMeta: drop monetization fields ─────────────────────
ALTER TABLE "ModelMeta" DROP COLUMN IF EXISTS "providerCostPer1MTokensCents";
ALTER TABLE "ModelMeta" DROP COLUMN IF EXISTS "inputCostPer1MTokensCents";
ALTER TABLE "ModelMeta" DROP COLUMN IF EXISTS "outputCostPer1MTokensCents";
ALTER TABLE "ModelMeta" DROP COLUMN IF EXISTS "minThroughput";
ALTER TABLE "ModelMeta" DROP COLUMN IF EXISTS "throughputUnit";
ALTER TABLE "ModelMeta" DROP COLUMN IF EXISTS "downgradeTo";
ALTER TABLE "ModelMeta" DROP COLUMN IF EXISTS "shardable";
ALTER TABLE "ModelMeta" DROP COLUMN IF EXISTS "slaPerArchetype";

-- ── ProviderRegistration: rebuild around Noise XK ────────────
ALTER TABLE "ProviderRegistration" DROP COLUMN IF EXISTS "archetype";
ALTER TABLE "ProviderRegistration" DROP COLUMN IF EXISTS "gpuCount";
ALTER TABLE "ProviderRegistration" DROP COLUMN IF EXISTS "gpuSingleVramMb";
ALTER TABLE "ProviderRegistration" DROP COLUMN IF EXISTS "gpuTotalVramMb";

ALTER TABLE "ProviderRegistration" RENAME COLUMN "endpoint"  TO "networkAddr";
ALTER TABLE "ProviderRegistration" RENAME COLUMN "publicKey" TO "noisePubkey";

ALTER TABLE "ProviderRegistration" ADD COLUMN IF NOT EXISTS "weightDigest" TEXT;

-- ── ProviderAcl: new — per-friend toggle ────────────────────
CREATE TABLE "ProviderAcl" (
  "id"         TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "friendId"   TEXT NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProviderAcl_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProviderAcl_providerId_friendId_key"
  ON "ProviderAcl"("providerId", "friendId");
CREATE INDEX "ProviderAcl_friendId_idx" ON "ProviderAcl"("friendId");

ALTER TABLE "ProviderAcl"
  ADD CONSTRAINT "ProviderAcl_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProviderAcl"
  ADD CONSTRAINT "ProviderAcl_friendId_fkey"
  FOREIGN KEY ("friendId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
