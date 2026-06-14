-- AlterTable
ALTER TABLE "ModelMeta" ADD COLUMN     "supportsAudioInput" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "supportsVision" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ToolCallLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "costCents" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "errorMsg" TEXT,
    "argsPreview" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ToolCallLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserQuota" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "dayKey" TEXT NOT NULL,
    "used" INTEGER NOT NULL DEFAULT 0,
    "limit" INTEGER NOT NULL DEFAULT 100,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserQuota_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowTemplate" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "steps" JSONB NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackgroundTask" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "payload" JSONB NOT NULL,
    "result" TEXT,
    "errorMsg" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackgroundTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "successCriteria" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'active',
    "version" INTEGER NOT NULL DEFAULT 1,
    "replanCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanStepRow" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "stepKey" TEXT NOT NULL,
    "orderIdx" INTEGER NOT NULL,
    "parentId" TEXT,
    "dependsOn" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "label" TEXT NOT NULL,
    "doneCriteria" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "estimatedIters" INTEGER NOT NULL DEFAULT 5,
    "itersSpent" INTEGER NOT NULL DEFAULT 0,
    "costSpentCents" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "qualityScore" DOUBLE PRECISION,
    "dodResults" JSONB,
    "skipReason" TEXT,
    "finding" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanStepRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanRevision" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserFact" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'identity',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "source" TEXT NOT NULL DEFAULT 'user_explicit',
    "sessionId" TEXT,
    "ttlDays" INTEGER,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserFact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ToolCallLog_userId_createdAt_idx" ON "ToolCallLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ToolCallLog_sessionId_idx" ON "ToolCallLog"("sessionId");

-- CreateIndex
CREATE INDEX "ToolCallLog_tool_idx" ON "ToolCallLog"("tool");

-- CreateIndex
CREATE INDEX "UserQuota_userId_idx" ON "UserQuota"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserQuota_userId_category_dayKey_key" ON "UserQuota"("userId", "category", "dayKey");

-- CreateIndex
CREATE INDEX "WorkflowTemplate_userId_idx" ON "WorkflowTemplate"("userId");

-- CreateIndex
CREATE INDEX "WorkflowTemplate_isPublic_idx" ON "WorkflowTemplate"("isPublic");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowTemplate_userId_name_key" ON "WorkflowTemplate"("userId", "name");

-- CreateIndex
CREATE INDEX "BackgroundTask_userId_status_idx" ON "BackgroundTask"("userId", "status");

-- CreateIndex
CREATE INDEX "BackgroundTask_status_scheduledAt_idx" ON "BackgroundTask"("status", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "Plan_sessionId_key" ON "Plan"("sessionId");

-- CreateIndex
CREATE INDEX "Plan_userId_idx" ON "Plan"("userId");

-- CreateIndex
CREATE INDEX "PlanStepRow_planId_orderIdx_idx" ON "PlanStepRow"("planId", "orderIdx");

-- CreateIndex
CREATE INDEX "PlanStepRow_planId_status_idx" ON "PlanStepRow"("planId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PlanStepRow_planId_stepKey_key" ON "PlanStepRow"("planId", "stepKey");

-- CreateIndex
CREATE UNIQUE INDEX "PlanRevision_planId_version_key" ON "PlanRevision"("planId", "version");

-- CreateIndex
CREATE INDEX "UserFact_userId_category_idx" ON "UserFact"("userId", "category");

-- CreateIndex
CREATE INDEX "UserFact_userId_lastSeen_idx" ON "UserFact"("userId", "lastSeen");

-- CreateIndex
CREATE UNIQUE INDEX "UserFact_userId_key_key" ON "UserFact"("userId", "key");

-- AddForeignKey
ALTER TABLE "PlanStepRow" ADD CONSTRAINT "PlanStepRow_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanRevision" ADD CONSTRAINT "PlanRevision_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserFact" ADD CONSTRAINT "UserFact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

