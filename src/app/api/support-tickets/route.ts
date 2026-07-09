import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";
import { track } from "@vercel/analytics/server";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  const rateLimited = await enforceRateLimit(req, "support-tickets");
  if (rateLimited) return rateLimited;

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { email, subject, message, bookingRef } = body as Record<string, unknown>;

  if (typeof email !== "string" || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "A valid email is required" }, { status: 400 });
  }
  if (typeof subject !== "string" || subject.trim().length === 0) {
    return NextResponse.json({ error: "Subject is required" }, { status: 400 });
  }
  if (typeof message !== "string" || message.trim().length === 0) {
    return NextResponse.json({ error: "Message is required" }, { status: 400 });
  }
  if (message.length > 5000) {
    return NextResponse.json({ error: "Message is too long" }, { status: 400 });
  }

  const ticket = await db.supportTicket.create({
    data: {
      email,
      subject: subject.trim().slice(0, 200),
      message: message.trim(),
      bookingRef: typeof bookingRef === "string" && bookingRef.trim() ? bookingRef.trim() : null,
    },
  });

  track("support_ticket_created", { hasBookingRef: !!ticket.bookingRef }).catch(() => {});

  return NextResponse.json({ id: ticket.id }, { status: 201 });
}
