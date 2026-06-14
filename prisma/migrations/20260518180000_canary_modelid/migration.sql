ALTER TABLE "AttestationSample" ADD COLUMN "modelId" TEXT;
CREATE INDEX "AttestationSample_modelId_canaryHash_idx" ON "AttestationSample"("modelId", "canaryHash");
