import { createOfferRequest, filterByPreferences, rankOffers } from "@/lib/duffel/search";
import { sendPriceDropAlert } from "@/lib/notifications";
import { db } from "@/lib/db";
import type { NormalizedOffer } from "@/lib/duffel/types";
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
  passengers: unknown; // SearchParams["passengers"]
  cabinClass: string | null;
  preferRefundable: boolean;
  preferChangeable: boolean;
  departAfter: string | null;
  departBefore: string | null;
  maxConnections: number | null;
  lastKnownPrice: string;
  lastKnownCurrency: string;
}

// Rebuilds the SearchParams shape createOfferRequest/filterByPreferences
// expect from the flattened columns a TrackedSearch row is stored as. Must
// include every preference filter the original search applied - otherwise
// the re-check compares against a differently-filtered (and differently
// priced) result set than what the user actually tracked.
export function trackedSearchToSearchParams(tracked: TrackedSearchRow): SearchParams {
  return {
    origin: tracked.origin,
    destination: tracked.destination,
    departure_date: tracked.departureDate,
    ...(tracked.returnDate ? { return_date: tracked.returnDate } : {}),
    passengers: tracked.passengers as SearchParams["passengers"],
    ...(tracked.cabinClass
      ? { cabin_class: tracked.cabinClass as SearchParams["cabin_class"] }
      : {}),
    ...(tracked.preferRefundable ? { prefer_refundable: true } : {}),
    ...(tracked.preferChangeable ? { prefer_changeable: true } : {}),
    ...(tracked.departAfter ? { depart_after: tracked.departAfter } : {}),
    ...(tracked.departBefore ? { depart_before: tracked.departBefore } : {}),
    ...(tracked.maxConnections !== null ? { max_connections: tracked.maxConnections } : {}),
  };
}

// filterByPreferences() is built for the interactive chat UI, where falling
// back to the unfiltered offer list (with an explanatory note) when a
// preference matches nothing is the right UX - showing something beats
// showing nothing. That fallback is wrong for this automated comparison: it
// would silently compare against a fare that doesn't actually satisfy the
// preference the user tracked (e.g. alerting on a cheaper *non-refundable*
// fare for a search tracked as "refundable only"). Re-verify the cheapest
// candidate actually satisfies every preference the search asked for -
// mirrors filterByPreferences' own per-field checks exactly.
function satisfiesTrackedPreferences(offer: NormalizedOffer, params: SearchParams): boolean {
  if (params.prefer_refundable && !offer.conditions.refundable) return false;
  if (params.prefer_changeable && !offer.conditions.changeable) return false;
  if (params.depart_after || params.depart_before) {
    const dep = offer.slices[0]?.segments[0]?.departing_at;
    if (dep) {
      const time = dep.slice(11, 16);
      if (params.depart_after && time < params.depart_after) return false;
      if (params.depart_before && time > params.depart_before) return false;
    }
  }
  return true;
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
  // Same preference filters as the original search - otherwise a "refundable
  // nonstop" tracked search could alert on an unrelated, unfiltered cheaper
  // fare the user never asked to be compared against.
  const { offers: filtered } = filterByPreferences(offers, params);
  const cheapest = rankOffers(filtered)[0];

  // No offers at all, or filterByPreferences fell back to the unfiltered
  // list because nothing currently satisfies the tracked preference(s) -
  // either way there's no valid fare to compare against right now.
  if (!cheapest || !satisfiesTrackedPreferences(cheapest, params)) {
    return { trackedSearchId: tracked.id, checked: false, dropped: false };
  }

  const comparison = comparePrices(
    tracked.lastKnownPrice,
    tracked.lastKnownCurrency,
    cheapest.total_amount,
    cheapest.total_currency
  );

  // Always refresh the baseline to today's cheapest fare (not only on a
  // drop) so the next check compares against reality instead of a stale
  // price - otherwise a price that rises then dips again would never
  // re-trigger an alert once it crossed the original baseline once.
  //
  // Persisted before sending the alert (not after): sendPriceDropAlert
  // swallows its own per-channel failures internally (Promise.allSettled)
  // and never throws, so the only realistic failure point in this
  // sequence is this update. Doing it first means a failed update simply
  // skips this round's alert and retries both together next run, instead
  // of the alert having already gone out with the stale baseline never
  // advancing - which would re-send an identical alert next time.
  await db.trackedSearch.update({
    where: { id: tracked.id },
    data: {
      lastKnownPrice: cheapest.total_amount,
      lastKnownCurrency: cheapest.total_currency,
    },
  });

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

  return {
    trackedSearchId: tracked.id,
    checked: true,
    dropped: comparison.dropped,
    newAmount: cheapest.total_amount,
    newCurrency: cheapest.total_currency,
  };
}
