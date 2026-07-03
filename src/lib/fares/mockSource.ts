import type { NormalizedOffer } from "@/lib/duffel/types";
import type { FareSource } from "./types";

// A deterministic, network-free FareSource used to prove the multi-source
// merge/rank logic in aggregate.ts actually combines results from more than
// one provider. Not part of defaultFareSources - wire it in explicitly
// (e.g. in tests) rather than by default.
export function createFixtureFareSource(
  id: string,
  name: string,
  offers: NormalizedOffer[]
): FareSource {
  return {
    id,
    name,
    search: async () => offers,
  };
}
