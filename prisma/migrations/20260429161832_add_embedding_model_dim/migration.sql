-- AlterTable
ALTER TABLE "MemoryAtom" ADD COLUMN     "embeddingDim" INTEGER,
ADD COLUMN     "embeddingModel" TEXT;

-- AlterTable
ALTER TABLE "MemoryDream" ADD COLUMN     "embeddingDim" INTEGER,
ADD COLUMN     "embeddingModel" TEXT;
