import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";
import { track } from "@vercel/analytics/server";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  const rateLimited = await enforceRateLimit(req, "waitlist");
  if (rateLimited) return rateLimited;

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { email, channel } = body as Record<string, unknown>;

  if (typeof email !== "string" || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "A valid email is required" }, { status: 400 });
  }

  try {
    await db.waitlistSignup.create({
      data: {
        email,
        channel: typeof channel === "string" && channel.trim() ? channel.trim() : "direct",
      },
    });
  } catch (err) {
    // Already on the list - treat as success rather than surfacing a
    // confusing "email already exists" error for a low-stakes interest form.
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) {
      throw err;
    }
  }

  track("waitlist_signup", {}).catch(() => {});

  return NextResponse.json({ ok: true }, { status: 201 });
}
