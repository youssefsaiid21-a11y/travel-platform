import { createOfferRequest } from "@/lib/duffel/search";
import type { FareSource } from "./types";

export const duffelSource: FareSource = {
  id: "duffel",
  name: "Duffel",
  search: createOfferRequest,
};

// NOT YET WIRED INTO PRODUCTION SEARCH: chat/route.ts's searchWithFallback and
// getPriceCalendar still call duffel/search.ts's createOfferRequest directly,
// not searchSources(defaultFareSources, ...) - this array and searchSources()
// are exercised only by aggregate.test.ts today. Appending a second source
// here does nothing to real searches until searchWithFallback/getPriceCalendar
// are updated to route through searchSources() instead. Sandbox-only per
// CLAUDE.md guardrail #1 regardless.
export const defaultFareSources: FareSource[] = [duffelSource];
