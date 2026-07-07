import { NextRequest, NextResponse } from "next/server";
import { getMonthPriceCalendar } from "@/lib/duffel/search";
import type { PriceCalendarEntry } from "@/lib/duffel/search";
import type { SearchParams } from "@/lib/parser/types";
import { enforceRateLimit } from "@/lib/rate-limit";

export interface MonthCalendarRequest {
  search_params: SearchParams;
  // The client usually already knows the price for search_params.departure_date
  // from the search it just ran - passing it in avoids re-querying Duffel for
  // a date whose answer we already have (same trick getPriceCalendar uses).
  known_exact_date?: Pick<PriceCalendarEntry, "cheapestAmount" | "currency">;
}

export interface MonthCalendarResponse {
  entries: PriceCalendarEntry[];
}

// Lazily fetched only when the user expands "view full month" on the price
// calendar - a full month is up to ~31 Duffel searches, so it's kept out of
// the hot chat/route.ts path (which only ever loads the ±3 day strip).
export async function POST(req: NextRequest) {
  const rateLimited = await enforceRateLimit(req, "calendar-month");
  if (rateLimited) return rateLimited;

  let body: MonthCalendarRequest;
  try {
    body = (await req.json()) as MonthCalendarRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { search_params, known_exact_date } = body ?? {};

  if (
    !search_params ||
    typeof search_params.origin !== "string" ||
    typeof search_params.destination !== "string" ||
    typeof search_params.departure_date !== "string"
  ) {
    return NextResponse.json(
      { error: "search_params with origin, destination and departure_date is required" },
      { status: 400 }
    );
  }

  try {
    const entries = await getMonthPriceCalendar(search_params, known_exact_date);
    return NextResponse.json({ entries } satisfies MonthCalendarResponse);
  } catch {
    return NextResponse.json({ error: "Failed to load month calendar" }, { status: 500 });
  }
}
