import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { generateTotpSecret, generateOtpAuthUrl } from "@/lib/totp";
import { checkRateLimit } from "@/lib/rate-limit";

// Generates and stores a new TOTP secret, but does NOT enable MFA yet -
// totpEnabled only flips to true once /api/auth/mfa/confirm verifies the
// user can actually produce a valid code with it, so a botched enrollment
// (secret never scanned, wrong app) can't lock anyone out.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (process.env.NODE_ENV !== "test") {
    const rl = await checkRateLimit(`mfa-setup:${session.user.id}`, { max: 5, windowMs: 60_000 });
    if (!rl.ok) {
      return NextResponse.json(
        { error: "Too many attempts. Please wait before trying again." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } }
      );
    }
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { email: true, passwordHash: true, totpEnabled: true },
  });
  if (!user) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  // Calling this again while MFA is already ON immediately clears
  // totpEnabled/backupCodes below (until the new secret is confirmed) -
  // that must not be reachable with just a live session, or a stolen
  // session cookie (no password needed) could silently turn off 2FA the
  // same way /disable is guarded against requiring one.
  if (user.totpEnabled) {
    const body = (await req.json().catch(() => null)) as { password?: string } | null;
    if (!body?.password) {
      return NextResponse.json(
        { error: "Password confirmation is required to re-enroll two-factor authentication." },
        { status: 400 }
      );
    }
    const valid = await bcrypt.compare(body.password, user.passwordHash);
    if (!valid) {
      return NextResponse.json({ error: "Incorrect password." }, { status: 400 });
    }
  }

  const secret = generateTotpSecret();
  await db.user.update({
    where: { id: session.user.id },
    data: { totpSecret: secret, totpEnabled: false, backupCodes: Prisma.JsonNull },
  });

  return NextResponse.json({
    secret,
    otpauthUrl: generateOtpAuthUrl(secret, user.email),
  });
}
