import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import type { SearchParams } from "@/lib/parser/types";

interface CreateTrackedSearchBody {
  searchParams: SearchParams;
  cheapestAmount: string;
  cheapestCurrency: string;
}

// "Track this price" - saves a search server-side so /api/cron/check-price-drops
// can re-check it later and notify the user if the price drops. Read-only
// against Duffel elsewhere; this route only ever touches our own DB.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as CreateTrackedSearchBody;
  const { searchParams, cheapestAmount, cheapestCurrency } = body;

  if (!searchParams?.origin || !searchParams?.destination || !searchParams?.departure_date) {
    return NextResponse.json({ error: "Missing search parameters" }, { status: 400 });
  }
  if (!cheapestAmount || !cheapestCurrency) {
    return NextResponse.json({ error: "Missing current price" }, { status: 400 });
  }

  // Avoid piling up duplicate rows if the user clicks "track" on the same
  // search twice - refresh the existing row's price instead.
  const existing = await db.trackedSearch.findFirst({
    where: {
      userId: session.user.id,
      origin: searchParams.origin,
      destination: searchParams.destination,
      departureDate: searchParams.departure_date,
      returnDate: searchParams.return_date ?? null,
      cabinClass: searchParams.cabin_class ?? null,
    },
  });

  const data = {
    userId: session.user.id,
    origin: searchParams.origin,
    destination: searchParams.destination,
    departureDate: searchParams.departure_date,
    returnDate: searchParams.return_date ?? null,
    passengers: JSON.stringify(searchParams.passengers),
    cabinClass: searchParams.cabin_class ?? null,
    lastKnownPrice: cheapestAmount,
    lastKnownCurrency: cheapestCurrency,
  };

  const trackedSearch = existing
    ? await db.trackedSearch.update({ where: { id: existing.id }, data })
    : await db.trackedSearch.create({ data });

  return NextResponse.json({ trackedSearch }, { status: existing ? 200 : 201 });
}

// Lists the current user's tracked searches (used by a future "my alerts" UI).
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const trackedSearches = await db.trackedSearch.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ trackedSearches });
}
