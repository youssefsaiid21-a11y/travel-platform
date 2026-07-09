-- AlterTable
-- Tracks the last TOTP time-step accepted per user, closing a replay gap:
-- without this, the same valid 6-digit code could be reused repeatedly
-- within its ~90s validity window (the clock-drift tolerance). Deliberately
-- NOT applied to the shared production Neon DB yet - same approval gate as
-- every other migration in this repo.
ALTER TABLE "User" ADD COLUMN "totpLastUsedStep" INTEGER;
