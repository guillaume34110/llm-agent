-- Reference (canary, model) → expected responseHash. When present,
-- recordSample requires an exact match for `valid=true`.
CREATE TABLE "CanaryReference" (
  "canaryHash"   TEXT NOT NULL,
  "modelId"      TEXT NOT NULL,
  "responseHash" TEXT NOT NULL,
  "note"         TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CanaryReference_pkey" PRIMARY KEY ("canaryHash", "modelId")
);

CREATE INDEX "CanaryReference_modelId_idx" ON "CanaryReference"("modelId");
