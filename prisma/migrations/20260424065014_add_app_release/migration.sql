-- CreateTable
CREATE TABLE "AppRelease" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "sha256" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppRelease_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AppRelease_platform_key" ON "AppRelease"("platform");
