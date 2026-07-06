import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const sig = req.headers.get("stripe-signature") ?? "";

  try {
    // The return value (the parsed event) isn't needed - see below for why
    // payment_intent.succeeded has no handling here. Calling this is still
    // required: it's what verifies the request genuinely came from Stripe.
    getStripe().webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET ?? ""
    );
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  // payment_intent.succeeded intentionally has no handling here anymore.
  // POST /api/booking - triggered client-side by the same
  // confirmCardPayment() call that causes Stripe to emit this event - is
  // what actually creates the Booking row, creates the real Duffel order,
  // and sends the confirmation. This handler used to race that: it isn't
  // aware of the Duffel outcome, so flipping status to "confirmed" here on
  // payment success alone could mark a booking confirmed before an order
  // existed - or, since this webhook typically arrives before that client
  // round-trip finishes, match no row at all and silently never notify.
  //
  // A payment that succeeds but never gets a booking row at all (client
  // tab closed, network failure right after charging) is a real gap this
  // signature-verified event could help catch - but doing it correctly
  // needs a delayed/reconciliation check (there's no reliable way to tell
  // "client hasn't finished yet" apart from "client will never finish"
  // synchronously inside this request), not a same-request lookup, which
  // would flag nearly every normal booking as an anomaly. Flagged as a
  // follow-up: a periodic job that finds Bookings still "pending" past a
  // few minutes old is the more correct way to catch that case.
  return NextResponse.json({ received: true });
}
