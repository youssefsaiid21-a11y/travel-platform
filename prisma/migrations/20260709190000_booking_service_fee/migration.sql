-- AlterTable
-- Adds the flat per-booking service fee (see src/lib/pricing.ts) as its own
-- column so margin can be reconciled against Duffel's cost. Existing rows
-- predate the fee model and are backfilled to "0.00" (they genuinely
-- carried zero margin). Deliberately NOT applied to the shared production
-- Neon DB yet - same approval gate as every other migration in this repo.
ALTER TABLE "Booking" ADD COLUMN "serviceFeeAmount" TEXT NOT NULL DEFAULT '0.00';
