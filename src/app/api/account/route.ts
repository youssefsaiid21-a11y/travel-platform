import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";

// Account deletion. Passport/contact data is deleted outright. Booking rows
// are deliberately KEPT, not deleted - they're the business's own financial/
// legal transaction records (refunds, disputes, accounting), not personal
// profile data, and a Booking row never stores passport data itself (see
// CLAUDE.md - Duffel is the system of record for that). The User row is
// anonymized rather than hard-deleted: Booking.userId is a required foreign
// key with no cascade rule configured, so a real SQL DELETE on User would
// fail outright while Booking rows exist for that user.
export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (process.env.NODE_ENV !== "test") {
    const rl = await checkRateLimit(`delete-account:${session.user.id}`, { max: 3, windowMs: 60_000 });
    if (!rl.ok) {
      return NextResponse.json(
        { error: "Too many attempts. Please wait before trying again." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } }
      );
    }
  }

  const body = (await req.json().catch(() => null)) as { password?: string } | null;
  if (!body?.password) {
    return NextResponse.json({ error: "Password confirmation is required." }, { status: 400 });
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { passwordHash: true },
  });
  if (!user) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  const valid = await bcrypt.compare(body.password, user.passwordHash);
  if (!valid) {
    return NextResponse.json({ error: "Incorrect password." }, { status: 400 });
  }

  await db.passengerProfile.deleteMany({ where: { userId: session.user.id } });
  await db.trackedSearch.deleteMany({ where: { userId: session.user.id } });

  // A random, never-typeable password so no credential could ever log back
  // into this account, plus tokenVersion bump to revoke every existing
  // session immediately (same mechanism as change-password).
  const unusableHash = await bcrypt.hash(crypto.randomUUID() + crypto.randomUUID(), 12);

  await db.user.update({
    where: { id: session.user.id },
    data: {
      email: `deleted-${session.user.id}@deleted.orbi.invalid`,
      name: null,
      passwordHash: unusableHash,
      tokenVersion: { increment: 1 },
      // Written before MFA existed and never updated - a "deleted" account
      // was still leaving its TOTP secret and backup-code hashes in the DB
      // indefinitely. Not exploitable on its own (the password above is
      // already unusable), but real cryptographic secrets tied to an
      // anonymized person shouldn't just sit there.
      totpSecret: null,
      totpEnabled: false,
      backupCodes: Prisma.JsonNull,
    },
  });

  return NextResponse.json({ ok: true });
}
