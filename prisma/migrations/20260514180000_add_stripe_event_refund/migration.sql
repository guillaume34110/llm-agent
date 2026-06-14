-- CreateTable
CREATE TABLE "ProcessedStripeEvent" (
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedStripeEvent_pkey" PRIMARY KEY ("eventId")
);

-- CreateIndex
CREATE INDEX "ProcessedStripeEvent_processedAt_idx" ON "ProcessedStripeEvent"("processedAt");

-- CreateTable
CREATE TABLE "RefundEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "stripeEventId" TEXT NOT NULL,
    "stripeChargeId" TEXT,
    "stripePaymentIntentId" TEXT,
    "status" TEXT NOT NULL,
    "errorMessage" TEXT,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefundEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RefundEvent_userId_processedAt_idx" ON "RefundEvent"("userId", "processedAt");

-- CreateIndex
CREATE INDEX "RefundEvent_stripeEventId_idx" ON "RefundEvent"("stripeEventId");
