import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";
import { hashRecoveryToken } from "@/lib/recoveryToken";

const GENERIC_ERROR = "This reset link is invalid or has expired.";

export async function POST(req: NextRequest) {
  const rateLimited = await enforceRateLimit(req, "recovery-redeem", { max: 10, windowMs: 15 * 60_000 });
  if (rateLimited) return rateLimited;

  const body = await req.json().catch(() => null);
  const { token, newPassword } = (body as Record<string, unknown> | null) ?? {};

  if (typeof token !== "string" || !token) {
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 400 });
  }
  if (typeof newPassword !== "string" || newPassword.length < 8 || newPassword.length > 128) {
    return NextResponse.json(
      { error: "New password must be between 8 and 128 characters." },
      { status: 400 }
    );
  }

  const record = await db.accountRecoveryToken.findUnique({
    where: { tokenHash: hashRecoveryToken(token) },
  });

  if (!record || record.usedAt || record.expiresAt < new Date()) {
    // One generic message for not-found/expired/already-used - don't give
    // an attacker probing tokens any signal about which case they hit.
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 400 });
  }

  const newHash = await bcrypt.hash(newPassword, 12);

  await db.$transaction([
    // Same teardown as account deletion/MFA-loss: a recovery redemption is
    // credential-compromise-adjacent, so every existing session and MFA
    // secret is invalidated, not just the password.
    db.user.update({
      where: { id: record.userId },
      data: {
        passwordHash: newHash,
        tokenVersion: { increment: 1 },
        totpSecret: null,
        totpEnabled: false,
        totpLastUsedStep: null,
        backupCodes: Prisma.JsonNull,
      },
    }),
    db.accountRecoveryToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    }),
    db.accountRecoveryToken.updateMany({
      where: { userId: record.userId, usedAt: null, id: { not: record.id } },
      data: { usedAt: new Date() },
    }),
  ]);

  return NextResponse.json({ ok: true });
}
