ALTER TABLE "ModelMeta" ADD COLUMN IF NOT EXISTS "weightDigest" TEXT;
ALTER TABLE "ProviderRegistration" ADD COLUMN IF NOT EXISTS "modelDigest" TEXT;
