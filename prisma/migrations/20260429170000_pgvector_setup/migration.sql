CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE "MemoryAtom"  ADD COLUMN "embeddingVector" vector(512);
ALTER TABLE "MemoryDream" ADD COLUMN "embeddingVector" vector(512);

CREATE INDEX IF NOT EXISTS "MemoryAtom_embeddingVector_hnsw_idx"
  ON "MemoryAtom" USING hnsw ("embeddingVector" vector_cosine_ops)
  WHERE "archived" = false;

CREATE INDEX IF NOT EXISTS "MemoryDream_embeddingVector_hnsw_idx"
  ON "MemoryDream" USING hnsw ("embeddingVector" vector_cosine_ops);
