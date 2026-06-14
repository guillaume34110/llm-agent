-- AlterTable
ALTER TABLE "ModelMeta" ADD COLUMN "supportsVideoOutput" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "videoCostCentsPerSec" DOUBLE PRECISION;
