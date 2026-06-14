-- Provider rewards: per-(providerId, modelId) aggregated stats + tier,
-- plus idempotency markers for first-provider and daily uptime bonuses.

ALTER TABLE "AttestationSample" ADD COLUMN "rewardedCents" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "ProviderStats" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "jobsServed" INTEGER NOT NULL DEFAULT 0,
    "tokensTotal" INTEGER NOT NULL DEFAULT 0,
    "totalEarnedCents" INTEGER NOT NULL DEFAULT 0,
    "samplesTotal" INTEGER NOT NULL DEFAULT 0,
    "samplesValid" INTEGER NOT NULL DEFAULT 0,
    "demotedCount90d" INTEGER NOT NULL DEFAULT 0,
    "uptimeStreakDays" INTEGER NOT NULL DEFAULT 0,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastJobAt" TIMESTAMP(3),
    "lastSampleAt" TIMESTAMP(3),
    "lastUptimeAt" TIMESTAMP(3),
    "tier" TEXT NOT NULL DEFAULT 'bronze',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProviderStats_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProviderStats_providerId_modelId_key" ON "ProviderStats"("providerId", "modelId");
CREATE INDEX "ProviderStats_modelId_tier_idx" ON "ProviderStats"("modelId", "tier");
CREATE INDEX "ProviderStats_providerId_idx" ON "ProviderStats"("providerId");

CREATE TABLE "ProviderFirstBonus" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "awardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProviderFirstBonus_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProviderFirstBonus_providerId_modelId_key" ON "ProviderFirstBonus"("providerId", "modelId");

CREATE TABLE "ProviderUptimeBonus" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "awardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProviderUptimeBonus_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProviderUptimeBonus_providerId_day_key" ON "ProviderUptimeBonus"("providerId", "day");
