import { CredentialsSignin } from "@auth/core/errors";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { verifyTotp } from "@/lib/totp";

// Imported from @auth/core/errors directly, not the next-auth package root -
// next-auth's own index pulls in next/server via its internal env-detection
// module, which only resolves correctly inside Next's own bundler/runtime.
// Importing from here keeps this file (and its unit tests) plain Node/Vitest
// compatible, since authorizeCredentials needs to be testable in isolation
// without going through NextAuth's internals at all.

// Distinct error codes so the login page can tell "wrong password" apart
// from "right password, now enter your 2FA code" apart from "wrong 2FA
// code" - CredentialsSignin's `code` ends up in next-auth/react's signIn()
// return value even with redirect: false (see @auth/core/errors.ts).
export class MfaRequiredError extends CredentialsSignin {
  code = "mfa_required";
}
export class InvalidMfaCodeError extends CredentialsSignin {
  code = "invalid_code";
}

// Extracted from the Credentials provider config (rather than inlined in
// src/auth.ts) so this security-critical logic - password check, then
// TOTP/backup-code verification - is directly unit-testable.
export async function authorizeCredentials(
  credentials: Partial<Record<"email" | "password" | "otp", unknown>>
) {
  if (!credentials?.email || !credentials?.password) return null;
  const user = await db.user.findUnique({
    where: { email: credentials.email as string },
  });
  if (!user) return null;
  const valid = await bcrypt.compare(
    credentials.password as string,
    user.passwordHash
  );
  if (!valid) return null;

  if (user.totpEnabled) {
    const otp = (credentials.otp as string | undefined)?.trim();
    if (!otp) throw new MfaRequiredError();

    const totpResult = user.totpSecret ? verifyTotp(user.totpSecret, otp) : { valid: false };
    // A code is only accepted once - without this, the same valid 6-digit
    // code could be replayed for its whole ~90s validity window (the
    // clock-drift tolerance in verifyTotp).
    const validTotp = totpResult.valid && totpResult.step !== user.totpLastUsedStep;
    let usedBackupIndex = -1;

    if (!validTotp) {
      const codes = (user.backupCodes as string[] | null) ?? [];
      for (let i = 0; i < codes.length; i++) {
        if (await bcrypt.compare(otp, codes[i])) {
          usedBackupIndex = i;
          break;
        }
      }
    }

    if (!validTotp && usedBackupIndex === -1) throw new InvalidMfaCodeError();

    if (validTotp) {
      await db.user.update({
        where: { id: user.id },
        data: { totpLastUsedStep: totpResult.step },
      });
    } else if (usedBackupIndex !== -1) {
      // Single-use: remove the code the moment it's spent, so a
      // leaked/observed backup code can't be replayed.
      const codes = (user.backupCodes as string[] | null) ?? [];
      const remaining = codes.filter((_, i) => i !== usedBackupIndex);
      await db.user.update({
        where: { id: user.id },
        data: { backupCodes: remaining },
      });
    }
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    tokenVersion: user.tokenVersion,
  };
}
