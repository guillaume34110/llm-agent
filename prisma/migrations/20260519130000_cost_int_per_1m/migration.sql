-- Billing invariant (CLAUDE.md): all cost fields are INTEGER cents.
-- Token rates rescaled from cents-per-1k (Float) to cents-per-1M (Int),
-- which lets the smallest sub-cent rates (0.008 cents/1k = 8 cents/1M)
-- fit cleanly in Int without losing precision. Multimedia rates were
-- already cents-per-unit, just converted Float→Int.

-- ModelMeta token rates
ALTER TABLE "ModelMeta" RENAME COLUMN "inputCostPer1kCents" TO "inputCostPer1MTokensCents";
ALTER TABLE "ModelMeta" RENAME COLUMN "outputCostPer1kCents" TO "outputCostPer1MTokensCents";
ALTER TABLE "ModelMeta" RENAME COLUMN "providerCostPer1kCents" TO "providerCostPer1MTokensCents";

ALTER TABLE "ModelMeta"
  ALTER COLUMN "inputCostPer1MTokensCents"    TYPE INTEGER USING ROUND("inputCostPer1MTokensCents" * 1000),
  ALTER COLUMN "outputCostPer1MTokensCents"   TYPE INTEGER USING ROUND("outputCostPer1MTokensCents" * 1000),
  ALTER COLUMN "providerCostPer1MTokensCents" TYPE INTEGER USING ROUND("providerCostPer1MTokensCents" * 1000);

-- ModelMeta multimedia rates (already cents-per-unit, just Float→Int)
ALTER TABLE "ModelMeta"
  ALTER COLUMN "imageCostCents"       TYPE INTEGER USING ROUND("imageCostCents"),
  ALTER COLUMN "musicCostCents"       TYPE INTEGER USING ROUND("musicCostCents"),
  ALTER COLUMN "videoCostCentsPerSec" TYPE INTEGER USING ROUND("videoCostCentsPerSec");

-- LlmCallLog costCents Float → Int
ALTER TABLE "LlmCallLog"
  ALTER COLUMN "costCents" TYPE INTEGER USING ROUND("costCents");
