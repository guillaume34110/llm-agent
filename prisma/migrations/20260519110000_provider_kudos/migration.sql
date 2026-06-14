-- Kudos ("cheers") sent user → provider. Sender pays CHEER_COST_CENTS,
-- provider receives 100%. One row per (sender, provider, UTC day) — that
-- unique constraint is also the sybil cap.

CREATE TABLE "ProviderKudos" (
  "id"           TEXT NOT NULL,
  "providerId"   TEXT NOT NULL,
  "fromUserId"   TEXT NOT NULL,
  "day"          TEXT NOT NULL,
  "modelId"      TEXT,
  "amountCents"  INTEGER NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProviderKudos_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProviderKudos_fromUserId_providerId_day_key"
  ON "ProviderKudos"("fromUserId", "providerId", "day");

CREATE INDEX "ProviderKudos_providerId_createdAt_idx"
  ON "ProviderKudos"("providerId", "createdAt");

CREATE TABLE "ProviderKudosStats" (
  "providerId"    TEXT NOT NULL,
  "kudosTotal"    INTEGER NOT NULL DEFAULT 0,
  "kudosCents30d" INTEGER NOT NULL DEFAULT 0,
  "kudosCount30d" INTEGER NOT NULL DEFAULT 0,
  "uniqueFans30d" INTEGER NOT NULL DEFAULT 0,
  "lastKudosAt"   TIMESTAMP(3),
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProviderKudosStats_pkey" PRIMARY KEY ("providerId")
);
