import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { duffelRequest } from "@/lib/duffel/client";
import type { NormalizedOffer } from "@/lib/duffel/types";
import type { SearchParams } from "@/lib/parser/types";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "");

export interface BookingPassenger {
  id: string;
  given_name: string;
  family_name: string;
  born_on: string;
  gender: "m" | "f";
  title: "mr" | "ms" | "mrs" | "dr" | "miss";
  email: string;
  phone_number: string;
}

interface CreateBookingBody {
  offerId: string;
  offer: NormalizedOffer;
  searchParams: SearchParams;
  passengers: BookingPassenger[];
  stripePaymentIntentId: string;
  specialRequests?: string;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as CreateBookingBody;
  const { offerId, offer, searchParams, passengers, stripePaymentIntentId, specialRequests } = body;

  // Verify payment succeeded before touching Duffel (CLAUDE.md guardrail #2)
  const pi = await stripe.paymentIntents.retrieve(stripePaymentIntentId);
  if (pi.status !== "succeeded") {
    return NextResponse.json(
      { error: "Payment has not been confirmed." },
      { status: 400 }
    );
  }

  if (pi.metadata.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (pi.metadata.offerId !== offerId) {
    return NextResponse.json(
      { error: "Payment intent does not match the selected offer." },
      { status: 400 }
    );
  }

  let duffelOrderId: string | null = null;
  let duffelBookingRef: string | null = null;
  let status = "failed";

  try {
    const order = await duffelRequest<{
      id: string;
      booking_reference: string;
    }>("/air/orders", {
      method: "POST",
      body: {
        data: {
          type: "instant",
          selected_offers: [offerId],
          passengers: passengers.map((p) => ({
            id: p.id,
            given_name: p.given_name,
            family_name: p.family_name,
            born_on: p.born_on,
            gender: p.gender,
            title: p.title,
            email: p.email,
            phone_number: p.phone_number,
          })),
          payments: [
            {
              type: "balance",
              amount: offer.total_amount,
              currency: offer.total_currency,
            },
          ],
        },
      },
    });
    duffelOrderId = order.id;
    duffelBookingRef = order.booking_reference;
    status = "confirmed";
  } catch (err) {
    console.error("Duffel order creation failed:", err);
  }

  const booking = await db.booking.create({
    data: {
      userId: session.user.id,
      duffelOrderId,
      duffelBookingRef,
      status,
      totalAmount: offer.total_amount,
      totalCurrency: offer.total_currency,
      offerSnapshot: JSON.stringify(offer),
      searchParams: JSON.stringify(searchParams),
      passengerNames: JSON.stringify(
        passengers.map((p) => `${p.given_name} ${p.family_name}`)
      ),
      stripePaymentIntentId,
      ...(specialRequests ? { specialRequests } : {}),
    },
  });

  return NextResponse.json({ booking }, { status: 201 });
}
