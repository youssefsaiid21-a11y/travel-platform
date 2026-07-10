import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";
import { generateRecoveryToken, RECOVERY_TOKEN_TTL_MS } from "@/lib/recoveryToken";
import { sendAccountRecoveryEmail } from "@/lib/notifications/email";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Always returns the same 200 { ok: true } whether or not the email
// matches a real account (non-enumeration-safe) - a "forgot password"
// endpoint that responds differently for existing vs. non-existing emails
// lets an attacker enumerate registered accounts one guess at a time.
export async function POST(req: NextRequest) {
  const rateLimited = await enforceRateLimit(req, "recovery-request", { max: 3, windowMs: 15 * 60_000 });
  if (rateLimited) return rateLimited;

  const body = await req.json().catch(() => null);
  const email = (body as Record<string, unknown> | null)?.email;

  if (typeof email !== "string" || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "A valid email is required" }, { status: 400 });
  }

  const user = await db.user.findUnique({ where: { email }, select: { id: true } });

  if (user) {
    // Invalidate any outstanding unused tokens before issuing a new one -
    // at most one live recovery link per account at a time.
    await db.accountRecoveryToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    const { raw, hash } = generateRecoveryToken();
    await db.accountRecoveryToken.create({
      data: {
        userId: user.id,
        tokenHash: hash,
        expiresAt: new Date(Date.now() + RECOVERY_TOKEN_TTL_MS),
      },
    });

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://orbi.travel";
    const recoveryUrl = `${appUrl}/reset-password?token=${raw}`;

    // Unawaited: email latency must not leak into response-timing
    // differences between the "user exists" and "user doesn't exist"
    // branches.
    sendAccountRecoveryEmail({ userEmail: email, recoveryUrl }).catch((err) =>
      console.error("Failed to send account recovery email:", err)
    );
  }

  return NextResponse.json({ ok: true });
}
