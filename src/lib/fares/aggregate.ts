import { rankOffers } from "@/lib/duffel/search";
import type { NormalizedOffer } from "@/lib/duffel/types";
import type { SearchParams } from "@/lib/parser/types";
import type { FareSource } from "./types";

// NOT wired into the production search path - `chat/route.ts` calls
// `search.ts`'s `searchWithFallback` directly, never this file. This module
// was built deliberately, ahead of having a second real fare source, to
// prove the multi-source merge/rank logic works (see `mockSource.ts` and
// its tests) - it's a real, tested exercise, not an accidental orphan, but
// nothing else marked it as inactive. Wire it in for real when a second
// provider (e.g. Amadeus) is actually scoped; otherwise reconsider deleting
// this directory if it's still unused a few months from now.
//
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
