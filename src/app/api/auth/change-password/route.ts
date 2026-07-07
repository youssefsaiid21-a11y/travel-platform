import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import bcrypt from "bcryptjs";
import { checkRateLimit } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (process.env.NODE_ENV !== "test") {
    const rl = await checkRateLimit(`change-password:${session.user.id}`, { max: 5, windowMs: 60_000 });
    if (!rl.ok) {
      return NextResponse.json(
        { error: "Too many attempts. Please wait before trying again." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } }
      );
    }
  }

  const body = (await req.json()) as {
    currentPassword?: string;
    newPassword?: string;
  };
  const { currentPassword, newPassword } = body;

  if (!currentPassword || !newPassword) {
    return NextResponse.json(
      { error: "Current password and new password are required." },
      { status: 400 }
    );
  }

  if (newPassword.length < 8 || newPassword.length > 128) {
    return NextResponse.json(
      { error: "New password must be between 8 and 128 characters." },
      { status: 400 }
    );
  }

  if (currentPassword === newPassword) {
    return NextResponse.json(
      { error: "New password must differ from the current password." },
      { status: 400 }
    );
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { passwordHash: true },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) {
    return NextResponse.json(
      { error: "Current password is incorrect." },
      { status: 400 }
    );
  }

  const newHash = await bcrypt.hash(newPassword, 12);
  await db.user.update({
    where: { id: session.user.id },
    data: { passwordHash: newHash },
  });

  return NextResponse.json({ ok: true });
}
