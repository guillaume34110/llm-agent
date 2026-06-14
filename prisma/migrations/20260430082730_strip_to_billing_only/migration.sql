-- DropForeignKey
ALTER TABLE IF EXISTS "Bookmark" DROP CONSTRAINT IF EXISTS "Bookmark_userId_fkey";

-- DropForeignKey
ALTER TABLE IF EXISTS "Conversation" DROP CONSTRAINT IF EXISTS "Conversation_userId_fkey";

-- DropForeignKey
ALTER TABLE IF EXISTS "MemoryAtom" DROP CONSTRAINT IF EXISTS "MemoryAtom_userId_fkey";

-- DropForeignKey
ALTER TABLE IF EXISTS "MemoryDream" DROP CONSTRAINT IF EXISTS "MemoryDream_userId_fkey";

-- DropForeignKey
ALTER TABLE IF EXISTS "Message" DROP CONSTRAINT IF EXISTS "Message_conversationId_fkey";

-- DropForeignKey
ALTER TABLE IF EXISTS "PlanRevision" DROP CONSTRAINT IF EXISTS "PlanRevision_planId_fkey";

-- DropForeignKey
ALTER TABLE IF EXISTS "PlanStepRow" DROP CONSTRAINT IF EXISTS "PlanStepRow_planId_fkey";

-- DropForeignKey
ALTER TABLE IF EXISTS "UserFact" DROP CONSTRAINT IF EXISTS "UserFact_userId_fkey";

-- DropForeignKey
ALTER TABLE IF EXISTS "UserProfile" DROP CONSTRAINT IF EXISTS "UserProfile_userId_fkey";

-- DropTable
DROP TABLE IF EXISTS "BackgroundTask" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "Bookmark" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "Conversation" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "MemoryAtom" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "MemoryDream" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "Message" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "Plan" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "PlanRevision" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "PlanStepRow" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "ToolCallLog" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "UserFact" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "UserProfile" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "UserQuota" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "WorkflowTemplate" CASCADE;

-- CreateTable
CREATE TABLE "LlmCallLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "costCents" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "endpoint" TEXT NOT NULL DEFAULT 'chat',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LlmCallLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LlmCallLog_userId_createdAt_idx" ON "LlmCallLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "LlmCallLog_model_createdAt_idx" ON "LlmCallLog"("model", "createdAt");

-- AddForeignKey
ALTER TABLE "LlmCallLog" ADD CONSTRAINT "LlmCallLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


