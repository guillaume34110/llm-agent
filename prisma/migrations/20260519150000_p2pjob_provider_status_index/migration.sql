-- Speed up route() capacity throttle: groupBy(providerId) WHERE status='pending'.
CREATE INDEX IF NOT EXISTS "P2pJob_providerId_status_idx" ON "P2pJob"("providerId", "status");
