-- CreateTable
CREATE TABLE "TrackedSearch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "departureDate" TEXT NOT NULL,
    "returnDate" TEXT,
    "passengers" TEXT NOT NULL,
    "cabinClass" TEXT,
    "lastKnownPrice" TEXT NOT NULL,
    "lastKnownCurrency" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TrackedSearch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "TrackedSearch_userId_createdAt_idx" ON "TrackedSearch"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "TrackedSearch_departureDate_idx" ON "TrackedSearch"("departureDate");

-- CreateIndex
CREATE INDEX "Booking_userId_createdAt_idx" ON "Booking"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Booking_stripePaymentIntentId_idx" ON "Booking"("stripePaymentIntentId");

-- CreateIndex
CREATE INDEX "ChatSession_updatedAt_idx" ON "ChatSession"("updatedAt");
