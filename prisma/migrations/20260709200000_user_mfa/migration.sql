-- AlterTable
-- TOTP-based two-factor auth (see src/lib/totp.ts, src/auth.ts). Deliberately
-- NOT applied to the shared production Neon DB yet - same approval gate as
-- every other migration in this repo.
ALTER TABLE "User" ADD COLUMN "totpSecret" TEXT;
ALTER TABLE "User" ADD COLUMN "totpEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "backupCodes" JSONB;
