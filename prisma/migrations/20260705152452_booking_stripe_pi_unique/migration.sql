-- DropIndex
DROP INDEX "Booking_stripePaymentIntentId_idx";

-- CreateIndex
CREATE UNIQUE INDEX "Booking_stripePaymentIntentId_key" ON "Booking"("stripePaymentIntentId");
