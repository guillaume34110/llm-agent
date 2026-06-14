-- Declared compute envelope for online providers. Replaces the per-modelId
-- runtime config: provider tells server "I have X VRAM, Y RAM" and the
-- balancer (runtime-side) queries /demand to decide what to load.

CREATE TABLE "ProviderCapacity" (
  "providerId"    TEXT NOT NULL,
  "vramMb"        INTEGER NOT NULL DEFAULT 0,
  "ramMb"         INTEGER NOT NULL DEFAULT 0,
  "maxConcurrent" INTEGER NOT NULL DEFAULT 1,
  "serving"       TEXT NOT NULL DEFAULT '',
  "declaredAt"    TIMESTAMP(3) NOT NULL,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProviderCapacity_pkey" PRIMARY KEY ("providerId")
);

CREATE INDEX "ProviderCapacity_declaredAt_idx" ON "ProviderCapacity"("declaredAt");
