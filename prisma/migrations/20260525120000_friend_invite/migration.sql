-- CreateTable (idempotent: safe to re-run if migration was interrupted)
CREATE TABLE IF NOT EXISTS "FriendInvite" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "usedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FriendInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "FriendInvite_token_key" ON "FriendInvite"("token");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "FriendInvite_fromUserId_createdAt_idx" ON "FriendInvite"("fromUserId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "FriendInvite_expiresAt_idx" ON "FriendInvite"("expiresAt");
