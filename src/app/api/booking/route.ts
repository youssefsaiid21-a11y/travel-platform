import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { duffelRequest, DuffelError } from "@/lib/duffel/client";
import { getOfferWithServices } from "@/lib/duffel/search";
import type { SearchParams } from "@/lib/parser/types";
import { getStripe } from "@/lib/stripe";
import { checkRateLimit } from "@/lib/rate-limit";

function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

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

  if (process.env.NODE_ENV !== "test") {
    const rl = checkRateLimit(`booking:${session.user.id}`, { max: 5, windowMs: 60_000 });
    if (!rl.ok) {
      return NextResponse.json(
        { error: "Too many booking attempts. Please wait before trying again." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } }
      );
    }
  }

  const body = (await req.json()) as CreateBookingBody;
  const { offerId, searchParams, passengers, stripePaymentIntentId, specialRequests } = body;

  // Verify payment succeeded before touching Duffel (CLAUDE.md guardrail #2)
  const pi = await getStripe().paymentIntents.retrieve(stripePaymentIntentId);
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

  const passengerNames = JSON.stringify(
    passengers.map((p) => `${p.given_name} ${p.family_name}`)
  );

  // Claim this PaymentIntent with a "pending" row BEFORE doing anything
  // expensive (verifying the offer, calling Duffel). stripePaymentIntentId
  // is DB-unique, so if two requests for the same succeeded payment race
  // each other, only one create() below can win - the loser gets a unique-
  // constraint error here and never reaches the Duffel order call at all.
  // Verifying-then-writing-once (the previous approach) only stopped a
  // second *row*, not a second real Duffel order, since both requests would
  // already be past the point of calling Duffel by the time either wrote to
  // the database.
  let booking;
  try {
    booking = await db.booking.create({
      data: {
        userId: session.user.id,
        duffelOrderId: null,
        duffelBookingRef: null,
        status: "pending",
        totalAmount: (pi.amount / 100).toFixed(2),
        totalCurrency: pi.currency.toUpperCase(),
        offerSnapshot: JSON.stringify({ offerId }),
        searchParams: JSON.stringify(searchParams),
        passengerNames,
        stripePaymentIntentId,
        ...(specialRequests ? { specialRequests } : {}),
      },
    });
  } catch (err) {
    if (!isUniqueConstraintError(err)) throw err;
    const existingBooking = await db.booking.findFirst({
      where: { stripePaymentIntentId, userId: session.user.id },
    });
    // Only a genuinely completed booking is safe to report as success on
    // retry - a prior "failed"/"pending" row (offer gone, amount mismatch,
    // concurrent request still in flight) must keep surfacing as an error,
    // or a client retrying after a transient failure clears would be told
    // it succeeded when no order was ever placed.
    if (existingBooking?.status === "confirmed") {
      return NextResponse.json({ booking: existingBooking }, { status: 200 });
    }
    return NextResponse.json(
      {
        error: "This payment did not result in a completed booking. Contact support.",
        booking: existingBooking,
      },
      { status: 409 }
    );
  }

  // Re-fetch the offer from Duffel rather than trusting a client-supplied
  // one, and confirm the amount actually charged matches its real price -
  // otherwise a client could pay $0.01 via a tampered payment-intent request
  // while still supplying a genuine, expensive offerId here (CLAUDE.md
  // guardrail #2: no money-moving step without a real, unspoofable check).
  let offer;
  try {
    offer = await getOfferWithServices(offerId);
  } catch (err) {
    // Stripe has already charged the card at this point - even though the
    // booking can't proceed, the claimed row above must be updated to
    // reflect that (not left "pending" forever) so support can find and
    // refund a charged-but-unbooked customer.
    const failedBooking = await db.booking.update({
      where: { id: booking.id },
      data: {
        status: "failed",
        offerSnapshot: JSON.stringify({
          offerId,
          reason: err instanceof DuffelError ? "offer_unavailable" : "offer_verification_failed",
        }),
      },
    });
    if (err instanceof DuffelError) {
      return NextResponse.json(
        { error: "That offer is no longer available.", booking: failedBooking },
        { status: 410 }
      );
    }
    return NextResponse.json(
      { error: "Could not verify the offer.", booking: failedBooking },
      { status: 502 }
    );
  }

  const expectedCents = Math.round(parseFloat(offer.total_amount) * 100);
  if (
    pi.amount !== expectedCents ||
    pi.currency !== offer.total_currency.toLowerCase()
  ) {
    const failedBooking = await db.booking.update({
      where: { id: booking.id },
      data: {
        status: "failed",
        totalAmount: offer.total_amount,
        totalCurrency: offer.total_currency,
        offerSnapshot: JSON.stringify(offer),
      },
    });
    return NextResponse.json(
      { error: "The amount charged does not match this offer's price.", booking: failedBooking },
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

  const finalBooking = await db.booking.update({
    where: { id: booking.id },
    data: {
      duffelOrderId,
      duffelBookingRef,
      status,
      totalAmount: offer.total_amount,
      totalCurrency: offer.total_currency,
      offerSnapshot: JSON.stringify(offer),
    },
  });

  return NextResponse.json({ booking: finalBooking }, { status: 201 });
}
