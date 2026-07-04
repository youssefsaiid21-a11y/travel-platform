-- AlterTable
ALTER TABLE "TrackedSearch" ADD COLUMN "preferRefundable" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TrackedSearch" ADD COLUMN "preferChangeable" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TrackedSearch" ADD COLUMN "departAfter" TEXT;
ALTER TABLE "TrackedSearch" ADD COLUMN "departBefore" TEXT;
ALTER TABLE "TrackedSearch" ADD COLUMN "maxConnections" INTEGER;
