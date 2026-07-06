import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import bcrypt from "bcryptjs";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV !== "test") {
    const rl = checkRateLimit(`reg:${getClientIp(req)}`, { max: 5, windowMs: 60 * 60 * 1000 });
    if (!rl.ok) {
      return NextResponse.json(
        { error: "Too many registration attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 3600) } }
      );
    }
  }
  const body = (await req.json()) as {
    email?: string;
    password?: string;
    name?: string;
  };
  const { email, password, name } = body;

  if (!email || !password) {
    return NextResponse.json(
      { error: "Email and password are required." },
      { status: 400 }
    );
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json(
      { error: "Please enter a valid email address." },
      { status: 400 }
    );
  }

  if (password.length < 8 || password.length > 128) {
    return NextResponse.json(
      { error: "Password must be between 8 and 128 characters." },
      { status: 400 }
    );
  }

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json(
      { error: "An account with that email already exists." },
      { status: 409 }
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);
  try {
    const user = await db.user.create({
      data: { email, name: name ?? null, passwordHash },
      select: { id: true, email: true, name: true },
    });
    return NextResponse.json(user, { status: 201 });
  } catch (err) {
    // The findUnique check above is check-then-act, not atomic - two
    // concurrent signups for the same email can both pass it and race here.
    // email's DB-level unique constraint stops the second create from
    // succeeding; without this catch that surfaces as an unhandled 500
    // instead of the same friendly 409 the check above already returns.
    if (isUniqueConstraintError(err)) {
      return NextResponse.json(
        { error: "An account with that email already exists." },
        { status: 409 }
      );
    }
    throw err;
  }
}
