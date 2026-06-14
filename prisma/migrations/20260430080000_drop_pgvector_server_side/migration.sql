-- Memory + RAG moved client-side. Drop pgvector dependency from server schema.
-- Idempotent: works whether pgvector previously installed or not.

DROP INDEX IF EXISTS "MemoryAtom_embeddingVector_hnsw_idx";
DROP INDEX IF EXISTS "MemoryDream_embeddingVector_hnsw_idx";

ALTER TABLE "MemoryAtom"  DROP COLUMN IF EXISTS "embeddingVector";
ALTER TABLE "MemoryDream" DROP COLUMN IF EXISTS "embeddingVector";

-- Try to drop the extension. If other DBs share it, this will warn but not fail (RESTRICT default).
-- If we can't drop it, that's fine — leaving it installed is harmless.
DO $$
BEGIN
  EXECUTE 'DROP EXTENSION IF EXISTS vector RESTRICT';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'vector extension not dropped (still in use or insufficient privilege) — non-fatal';
END $$;
