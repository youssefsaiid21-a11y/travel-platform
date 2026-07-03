import { createOfferRequest, filterByPreferences, rankOffers } from "./search";
import { POPULAR_DESTINATIONS } from "@/lib/airlines/popularDestinations";
import type { ExploreDestinationResult, ExploreParams } from "@/lib/parser/types";
import type { SearchParams } from "@/lib/parser/types";

// Duffel has no "anywhere" wildcard search - there's always a required
// destination per request. This fans out one search per curated popular
// destination (skipping the origin itself, in case it's in the list) and
// ranks by cheapest offer. Each per-destination search reuses the exact same
// createOfferRequest -> filterByPreferences -> rankOffers pipeline as a
// normal search, so a result's advertised price matches exactly what
// re-searching that destination would return (the same invariant
// getPriceCalendar upholds for dates).
export async function exploreDestinations(
  params: ExploreParams
): Promise<ExploreDestinationResult[]> {
  const candidates = POPULAR_DESTINATIONS.filter((d) => d.iata !== params.origin);

  const results = await Promise.all(
    candidates.map(async (dest): Promise<ExploreDestinationResult | null> => {
      const searchParams: SearchParams = {
        origin: params.origin,
        destination: dest.iata,
        departure_date: params.departure_date,
        ...(params.return_date ? { return_date: params.return_date } : {}),
        passengers: params.passengers,
        ...(params.cabin_class ? { cabin_class: params.cabin_class } : {}),
      };

      try {
        const offers = await createOfferRequest(searchParams);
        const { offers: filtered } = filterByPreferences(offers, searchParams);
        const cheapest = rankOffers(filtered)[0];
        if (!cheapest) return null;

        if (
          params.max_budget !== undefined &&
          parseFloat(cheapest.total_amount) > params.max_budget
        ) {
          return null;
        }

        return {
          destination: dest.iata,
          city: dest.city,
          country: dest.country,
          cheapestAmount: cheapest.total_amount,
          currency: cheapest.total_currency,
          airline: cheapest.owner.name,
        };
      } catch {
        // One destination erroring out (bad route, no availability, etc.)
        // shouldn't sink the whole explore search - just omit it.
        return null;
      }
    })
  );

  return results
    .filter((r): r is ExploreDestinationResult => r !== null)
    .sort((a, b) => parseFloat(a.cheapestAmount) - parseFloat(b.cheapestAmount));
}
