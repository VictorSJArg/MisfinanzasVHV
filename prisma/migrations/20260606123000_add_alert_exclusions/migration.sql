CREATE TABLE "AlertExclusion" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertExclusion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AlertExclusion_userId_categoryId_description_key" ON "AlertExclusion"("userId", "categoryId", "description");
CREATE INDEX "AlertExclusion_userId_categoryId_idx" ON "AlertExclusion"("userId", "categoryId");

ALTER TABLE "AlertExclusion" ADD CONSTRAINT "AlertExclusion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
