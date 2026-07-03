import type { NormalizedOffer } from "@/lib/duffel/types";
import type { SearchParams } from "@/lib/parser/types";

// A pluggable fare provider. Duffel is the only real implementation today -
// this interface exists so a second source (e.g. Kiwi, Amadeus) can be added
// later without touching the merge/rank logic in aggregate.ts.
export interface FareSource {
  id: string;
  name: string;
  search(params: SearchParams): Promise<NormalizedOffer[]>;
}
