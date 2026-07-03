import { rankOffers } from "@/lib/duffel/search";
import type { NormalizedOffer } from "@/lib/duffel/types";
import type { SearchParams } from "@/lib/parser/types";
import type { FareSource } from "./types";

// Queries every source in parallel and merges the results into one ranked
// list. A source failing (network error, no key configured, etc.) doesn't
// take down the others - its offers are just absent from the result.
export async function searchSources(
  sources: FareSource[],
  params: SearchParams
): Promise<NormalizedOffer[]> {
  const settled = await Promise.allSettled(sources.map((s) => s.search(params)));
  const offers = settled.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  return rankOffers(offers);
}
