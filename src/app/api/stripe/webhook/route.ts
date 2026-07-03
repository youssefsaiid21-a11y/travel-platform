import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { db } from "@/lib/db";
import { sendBookingConfirmations } from "@/lib/notifications";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "");

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const sig = req.headers.get("stripe-signature") ?? "";

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET ?? ""
    );
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (event.type === "payment_intent.succeeded") {
    const pi = event.data.object as Stripe.PaymentIntent;

    await db.booking.updateMany({
      where: { stripePaymentIntentId: pi.id, status: "pending" },
      data: { status: "confirmed" },
    });

    const booking = await db.booking.findFirst({
      where: { stripePaymentIntentId: pi.id, status: "confirmed" },
      select: {
        id: true,
        duffelBookingRef: true,
        totalAmount: true,
        totalCurrency: true,
        offerSnapshot: true,
        passengerNames: true,
        user: {
          select: {
            email: true,
            passengerProfile: { select: { phone: true } },
          },
        },
      },
    });

    if (booking) {
      // Non-blocking - notification failures must not affect the webhook response
      sendBookingConfirmations(booking).catch((err) =>
        console.error("[webhook] notification error:", err)
      );
    }
  }

  return NextResponse.json({ received: true });
}
