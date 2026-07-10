import crypto from "node:crypto";

// One-time password/MFA-recovery tokens (src/app/api/auth/recovery/*).
// Pure helpers, kept separate from src/auth.ts for the same reason
// src/lib/authorizeCredentials.ts is: importing next-auth's index pulls in
// next/server, which breaks Vitest module resolution outside Next's own
// bundler.
//
// tokenHash is HMAC-SHA256(raw, NEXTAUTH_SECRET), not bcrypt - redemption
// needs an indexed exact-match DB lookup by the presented token, which
// bcrypt's per-call salting makes impossible without already knowing which
// user's hash to compare against.
export const RECOVERY_TOKEN_TTL_MS = 60 * 60_000;

function recoverySecret(): string {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET is not set - cannot hash recovery tokens.");
  return secret;
}

export function hashRecoveryToken(raw: string): string {
  return crypto.createHmac("sha256", recoverySecret()).update(raw).digest("hex");
}

export function generateRecoveryToken(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(32).toString("base64url");
  return { raw, hash: hashRecoveryToken(raw) };
}
