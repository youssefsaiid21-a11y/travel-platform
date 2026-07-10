-- AlterTable
-- Minimal admin/operator flag (src/app/admin/*, src/app/api/admin/*). Not
-- exposed via any API - flipped directly in the DB by the founder after
-- this migration is approved and deployed.
ALTER TABLE "User" ADD COLUMN "isAdmin" BOOLEAN NOT NULL DEFAULT false;
