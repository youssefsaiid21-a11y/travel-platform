import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { auth } from "@/auth";
import { checkRateLimit } from "@/lib/rate-limit";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "");

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (process.env.NODE_ENV !== "test") {
    const rl = checkRateLimit(`pi:${session.user.id}`, { max: 5, windowMs: 60_000 });
    if (!rl.ok) {
      return NextResponse.json(
        { error: "Too many payment attempts. Please wait before trying again." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } }
      );
    }
  }

  const { amount, currency, offerId } = (await req.json()) as {
    amount: string;
    currency: string;
    offerId: string;
  };

  if (!amount || !currency || !offerId) {
    return NextResponse.json({ error: "Missing required fields." }, { status: 400 });
  }

  const amountCents = Math.round(parseFloat(amount) * 100);
  if (isNaN(amountCents) || amountCents <= 0) {
    return NextResponse.json({ error: "Invalid amount." }, { status: 400 });
  }

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: currency.toLowerCase(),
      metadata: { userId: session.user.id, offerId },
    });
    return NextResponse.json({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Payment setup failed.";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
