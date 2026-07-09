import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { generateTotpSecret, generateOtpAuthUrl } from "@/lib/totp";

// Generates and stores a new TOTP secret, but does NOT enable MFA yet -
// totpEnabled only flips to true once /api/auth/mfa/confirm verifies the
// user can actually produce a valid code with it, so a botched enrollment
// (secret never scanned, wrong app) can't lock anyone out.
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { email: true },
  });
  if (!user) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
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
