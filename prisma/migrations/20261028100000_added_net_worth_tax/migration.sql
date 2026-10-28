-- CreateTable
CREATE TABLE "NetWorthTax" (
    "amount" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "id" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,

    CONSTRAINT "NetWorthTax_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NetWorthTax_userId_idx" ON "NetWorthTax"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "NetWorthTax_userId_year_key" ON "NetWorthTax"("userId", "year");

-- AddForeignKey
ALTER TABLE "NetWorthTax" ADD CONSTRAINT "NetWorthTax_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
