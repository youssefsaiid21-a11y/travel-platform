-- CreateTable
-- Pre-launch waitlist/interest capture (see docs/channel-plan.md and
-- CLAUDE.md's Executive Charter). Deliberately NOT applied to the shared
-- production Neon DB yet - per this repo's existing convention (see the
-- SupportTicket migration), any schema change against the shared prod
-- database needs explicit founder approval before running
-- `prisma migrate deploy`. Written by hand for the same reason those were:
-- `prisma migrate dev` needs an interactive TTY and would apply immediately
-- against whatever DATABASE_URL points to, which is the shared prod DB in
-- this repo's local setup.
CREATE TABLE "WaitlistSignup" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'direct',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaitlistSignup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WaitlistSignup_email_key" ON "WaitlistSignup"("email");
