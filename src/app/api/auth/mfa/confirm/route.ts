import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { verifyTotp, generateBackupCodes } from "@/lib/totp";
import { checkRateLimit } from "@/lib/rate-limit";

// Proves the user can generate a real code with the secret from
// /api/auth/mfa/setup before actually turning MFA on. Returns backup codes
// in plaintext exactly once - only the bcrypt hashes are ever persisted.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (process.env.NODE_ENV !== "test") {
    const rl = await checkRateLimit(`mfa-confirm:${session.user.id}`, { max: 5, windowMs: 60_000 });
    if (!rl.ok) {
      return NextResponse.json(
        { error: "Too many attempts. Please wait before trying again." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } }
      );
    }
  }

  const body = (await req.json().catch(() => null)) as { code?: string } | null;
  if (!body?.code) {
    return NextResponse.json({ error: "A 6-digit code is required." }, { status: 400 });
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { totpSecret: true },
  });
  if (!user?.totpSecret) {
    return NextResponse.json(
      { error: "No two-factor setup in progress. Start setup again." },
      { status: 400 }
    );
  }

  const verification = verifyTotp(user.totpSecret, body.code.trim());
  if (!verification.valid) {
    return NextResponse.json({ error: "Incorrect code." }, { status: 400 });
  }

  const backupCodes = generateBackupCodes();
  const hashedCodes = await Promise.all(backupCodes.map((code) => bcrypt.hash(code, 10)));

  await db.user.update({
    where: { id: session.user.id },
    data: {
      totpEnabled: true,
      backupCodes: hashedCodes,
      // Records this confirmation code as already-used so it can't also be
      // replayed as the user's first login attempt.
      totpLastUsedStep: verification.step,
    },
  });

  return NextResponse.json({ ok: true, backupCodes });
}
