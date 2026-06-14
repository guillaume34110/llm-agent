CREATE TABLE "P2pJob" (
  "id" TEXT NOT NULL,
  "consumerId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "modelId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "tokensIn" INTEGER,
  "tokensOut" INTEGER,
  "costCents" INTEGER,
  "earnedCents" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "settledAt" TIMESTAMP(3),
  CONSTRAINT "P2pJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "P2pJob_providerId_settledAt_idx" ON "P2pJob"("providerId", "settledAt");
CREATE INDEX "P2pJob_consumerId_settledAt_idx" ON "P2pJob"("consumerId", "settledAt");
CREATE INDEX "P2pJob_status_createdAt_idx" ON "P2pJob"("status", "createdAt");
