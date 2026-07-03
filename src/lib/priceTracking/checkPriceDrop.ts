import { createOfferRequest, rankOffers } from "@/lib/duffel/search";
import { sendPriceDropAlert } from "@/lib/notifications";
import { db } from "@/lib/db";
import type { SearchParams } from "@/lib/parser/types";

export interface PriceComparisonResult {
  dropped: boolean;
  previousAmount: string;
  previousCurrency: string;
  newAmount: string;
  newCurrency: string;
}

// Pure comparison - a "drop" only fires when the currencies match. Comparing
// "200 GBP" to "180 USD" numerically would be meaningless without a live FX
// rate, which Duffel doesn't hand us here, so we just skip the comparison
// rather than guess.
export function comparePrices(
  previousAmount: string,
  previousCurrency: string,
  newAmount: string,
  newCurrency: string
): PriceComparisonResult {
  const dropped =
    newCurrency === previousCurrency && parseFloat(newAmount) < parseFloat(previousAmount);
  return { dropped, previousAmount, previousCurrency, newAmount, newCurrency };
}

export interface TrackedSearchRow {
  id: string;
  origin: string;
  destination: string;
  departureDate: string;
  returnDate: string | null;
  passengers: string; // JSON-encoded SearchParams["passengers"]
  cabinClass: string | null;
  lastKnownPrice: string;
  lastKnownCurrency: string;
}

// Rebuilds the SearchParams shape createOfferRequest expects from the
// flattened columns a TrackedSearch row is stored as.
export function trackedSearchToSearchParams(tracked: TrackedSearchRow): SearchParams {
  return {
    origin: tracked.origin,
    destination: tracked.destination,
    departure_date: tracked.departureDate,
    ...(tracked.returnDate ? { return_date: tracked.returnDate } : {}),
    passengers: JSON.parse(tracked.passengers) as SearchParams["passengers"],
    ...(tracked.cabinClass
      ? { cabin_class: tracked.cabinClass as SearchParams["cabin_class"] }
      : {}),
  };
}

export interface TrackedSearchWithUser extends TrackedSearchRow {
  user: {
    email: string;
    passengerProfile: { phone: string } | null;
  };
}

export interface CheckOutcome {
  trackedSearchId: string;
  // false when Duffel returned zero offers for this search (route might be
  // sold out or the date has passed) - lastKnownPrice is left untouched.
  checked: boolean;
  dropped: boolean;
  newAmount?: string;
  newCurrency?: string;
}

// Re-queries Duffel for a tracked search, compares the new cheapest fare to
// the last known price, and - if it dropped - sends the price-drop
// notification and persists the new price as the baseline for next time.
// This is read-only against Duffel (only ever calls createOfferRequest, the
// same search endpoint the main search flow uses) - it never creates or
// touches an order.
export async function checkTrackedSearchForPriceDrop(
  tracked: TrackedSearchWithUser
): Promise<CheckOutcome> {
  const params = trackedSearchToSearchParams(tracked);
  const offers = await createOfferRequest(params);
  const cheapest = rankOffers(offers)[0];

  if (!cheapest) {
    return { trackedSearchId: tracked.id, checked: false, dropped: false };
  }

  const comparison = comparePrices(
    tracked.lastKnownPrice,
    tracked.lastKnownCurrency,
    cheapest.total_amount,
    cheapest.total_currency
  );

  if (comparison.dropped) {
    await sendPriceDropAlert({
      trackedSearchId: tracked.id,
      origin: tracked.origin,
      destination: tracked.destination,
      departureDate: tracked.departureDate,
      returnDate: tracked.returnDate,
      previousAmount: comparison.previousAmount,
      previousCurrency: comparison.previousCurrency,
      newAmount: comparison.newAmount,
      newCurrency: comparison.newCurrency,
      userEmail: tracked.user.email,
      userPhone: tracked.user.passengerProfile?.phone ?? null,
      appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "https://orbi.travel",
    });
  }

  // Always refresh the baseline to today's cheapest fare (not only on a
  // drop) so the next check compares against reality instead of a stale
  // price - otherwise a price that rises then dips again would never
  // re-trigger an alert once it crossed the original baseline once.
  await db.trackedSearch.update({
    where: { id: tracked.id },
    data: {
      lastKnownPrice: cheapest.total_amount,
      lastKnownCurrency: cheapest.total_currency,
    },
  });

  return {
    trackedSearchId: tracked.id,
    checked: true,
    dropped: comparison.dropped,
    newAmount: cheapest.total_amount,
    newCurrency: cheapest.total_currency,
  };
}
