-- CreateTable
CREATE TABLE "UserAnimal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "animalId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserAnimal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserAnimal_userId_idx" ON "UserAnimal"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserAnimal_userId_animalId_key" ON "UserAnimal"("userId", "animalId");

-- AddForeignKey
ALTER TABLE "UserAnimal" ADD CONSTRAINT "UserAnimal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
