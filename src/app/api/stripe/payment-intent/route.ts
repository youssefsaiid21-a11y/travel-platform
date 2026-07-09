import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { getStripe } from "@/lib/stripe";
import { getOfferWithServices } from "@/lib/duffel/search";
import { DuffelError } from "@/lib/duffel/client";
import { chargeAmountCents } from "@/lib/pricing";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (process.env.NODE_ENV !== "test") {
    const rl = await checkRateLimit(`pi:${session.user.id}`, { max: 5, windowMs: 60_000 });
    if (!rl.ok) {
      return NextResponse.json(
        { error: "Too many payment attempts. Please wait before trying again." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } }
      );
    }
  }

  const { offerId } = (await req.json()) as { offerId: string };

  if (!offerId) {
    return NextResponse.json({ error: "Missing required fields." }, { status: 400 });
  }

  // The amount charged must come from Duffel's own live offer, never from
  // the client - a client-supplied amount would let a user pay $0.01 for
  // a real fare while still presenting the genuine offerId (CLAUDE.md
  // guardrail #2: money-moving code needs a real, unspoofable price check).
  let offer;
  try {
    offer = await getOfferWithServices(offerId);
  } catch (err) {
    if (err instanceof DuffelError) {
      return NextResponse.json(
        { error: "That offer is no longer available. Please search again." },
        { status: 410 }
      );
    }
    return NextResponse.json({ error: "Could not verify the offer price." }, { status: 502 });
  }

  const amountCents = chargeAmountCents(offer.total_amount);
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    return NextResponse.json({ error: "Invalid offer amount." }, { status: 400 });
  }

  try {
    const paymentIntent = await getStripe().paymentIntents.create({
      amount: amountCents,
      currency: offer.total_currency.toLowerCase(),
      metadata: { userId: session.user.id, offerId },
    });
    return NextResponse.json({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Payment setup failed.";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
