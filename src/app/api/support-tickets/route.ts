import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";
import { track } from "@vercel/analytics/server";
import { sendAlertEmail } from "@/lib/notifications/email";

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

  const trimmedSubject = subject.trim().slice(0, 200);
  const trimmedMessage = message.trim();
  const trimmedBookingRef = typeof bookingRef === "string" && bookingRef.trim() ? bookingRef.trim() : null;

  const ticket = await db.supportTicket.create({
    data: {
      email,
      subject: trimmedSubject,
      message: trimmedMessage,
      bookingRef: trimmedBookingRef,
    },
  });

  track("support_ticket_created", { hasBookingRef: !!ticket.bookingRef }).catch(() => {});

  sendAlertEmail(
    `New support ticket: ${trimmedSubject}`,
    `From: ${email}\n${trimmedBookingRef ? `Booking ref: ${trimmedBookingRef}\n` : ""}\n${trimmedMessage}`
  ).catch((err) => console.error("Failed to send support ticket alert:", err));

  return NextResponse.json({ id: ticket.id }, { status: 201 });
}
