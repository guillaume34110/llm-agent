-- AlterTable
ALTER TABLE "ModelMeta" ADD COLUMN "supportsImageOutput" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "supportsAudioOutput" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "musicCostCents" DOUBLE PRECISION;
