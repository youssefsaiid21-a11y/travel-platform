-- CreateTable
-- Support intake for the Customer Support agent (see CLAUDE.md's Executive
-- Charter and .claude/BUSINESS_STATE.md's agent roster). Deliberately NOT
-- applied to the shared production Neon DB yet - per this repo's existing
-- convention (see Phase 2/5 migrations), any schema change against the
-- shared prod database needs explicit founder approval before running
-- `prisma migrate deploy`. Written by hand rather than via `prisma migrate
-- dev` for the same reason those did: that command needs an interactive TTY
-- and would apply immediately against whatever DATABASE_URL points to,
-- which is the shared prod DB in this repo's local setup.
CREATE TABLE "SupportTicket" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "bookingRef" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupportTicket_status_createdAt_idx" ON "SupportTicket"("status", "createdAt");
