import { duffelRequest } from "./client";
import type {
  NormalizedBaggageAllowance,
  NormalizedOffer,
  NormalizedSlice,
  NormalizedSegment,
  NormalizedService,
  RawOffer,
  RawOfferRequest,
  RawSegment,
  RawService,
  RawSlice,
} from "./types";
import type { SearchParams } from "@/lib/parser/types";

function isMultiCity(params: SearchParams): boolean {
  return (params.additional_slices?.length ?? 0) > 0;
}

function normalizeSegment(seg: RawSegment): NormalizedSegment {
  return {
    departing_at: seg.departing_at,
    arriving_at: seg.arriving_at,
    duration: seg.duration,
    origin: { iata_code: seg.origin.iata_code, name: seg.origin.name },
    destination: {
      iata_code: seg.destination.iata_code,
      name: seg.destination.name,
    },
    marketing_carrier: {
      iata_code: seg.marketing_carrier.iata_code,
      name: seg.marketing_carrier.name,
    },
    operating_carrier: {
      iata_code: seg.operating_carrier.iata_code,
      name: seg.operating_carrier.name,
    },
    flight_number: seg.marketing_carrier_flight_number,
  };
}

// Exported so other modules that receive raw Duffel slice data (e.g.
// orders.ts, which shares the exact same slice/segment shape) don't
// reimplement this normalization.
export function normalizeSlice(slice: RawSlice): NormalizedSlice {
  const segments = slice.segments.map(normalizeSegment);
  return {
    duration: slice.duration,
    stops: segments.length - 1,
    segments,
  };
}

// Included (free) baggage allowance comes from the first segment's primary
// passenger - Duffel repeats the same allowance across all segments/passengers
// of a given fare, so the first entry is representative of the whole offer.
function normalizeIncludedBaggage(
  offer: RawOffer
): NormalizedBaggageAllowance | undefined {
  const passengers = offer.slices[0]?.segments[0]?.passengers;
  const primary = passengers?.[0];
  if (!primary?.baggages) return undefined;
  return {
    checked: primary.baggages.find((b) => b.type === "checked")?.quantity ?? 0,
    carryOn: primary.baggages.find((b) => b.type === "carry_on")?.quantity ?? 0,
  };
}

function serviceLabel(service: RawService): string {
  if (service.type === "baggage") {
    const weight = service.metadata?.maximum_weight_kg;
    return weight ? `Extra checked bag (${weight}kg)` : "Extra checked bag";
  }
  if (service.type === "seat") {
    const designator = service.metadata?.designator;
    return designator ? `Seat ${designator}` : "Seat selection";
  }
  return service.type;
}

function normalizeService(service: RawService): NormalizedService {
  return {
    id: service.id,
    type: service.type,
    amount: service.total_amount,
    currency: service.total_currency,
    label: serviceLabel(service),
  };
}

// Turns a raw refund/change condition into a fee, when Duffel discloses one.
// Returns null (not just undefined) when the amount/currency aren't both
// present, so callers can rely on "falsy = no known fee" without guessing.
function normalizeFee(
  condition: { penalty_amount?: string | null; penalty_currency?: string | null } | null | undefined
): { amount: string; currency: string } | null {
  if (!condition?.penalty_amount || !condition?.penalty_currency) return null;
  return { amount: condition.penalty_amount, currency: condition.penalty_currency };
}

function normalizeOffer(offer: RawOffer): NormalizedOffer {
  return {
    id: offer.id,
    expires_at: offer.expires_at,
    total_amount: offer.total_amount,
    total_currency: offer.total_currency,
    base_amount: offer.base_amount,
    tax_amount: offer.tax_amount,
    owner: {
      iata_code: offer.owner.iata_code,
      name: offer.owner.name,
      logo_symbol_url: offer.owner.logo_symbol_url,
    },
    slices: offer.slices.map(normalizeSlice),
    conditions: {
      refundable: offer.conditions.refund_before_departure?.allowed ?? false,
      changeable: offer.conditions.change_before_departure?.allowed ?? false,
      refundFee: normalizeFee(offer.conditions.refund_before_departure),
      changeFee: normalizeFee(offer.conditions.change_before_departure),
    },
    passengers: offer.passengers ?? [],
    includedBaggage: normalizeIncludedBaggage(offer),
    ...(offer.available_services
      ? { services: offer.available_services.map(normalizeService) }
      : {}),
  };
}

// Parse ISO 8601 duration to minutes (e.g. "PT2H30M" → 150)
function durationToMinutes(iso: string): number {
  const h = iso.match(/(\d+)H/)?.[1] ?? "0";
  const m = iso.match(/(\d+)M/)?.[1] ?? "0";
  return parseInt(h) * 60 + parseInt(m);
}

export function rankOffers(offers: NormalizedOffer[]): NormalizedOffer[] {
  return [...offers].sort((a, b) => {
    const priceDiff = parseFloat(a.total_amount) - parseFloat(b.total_amount);
    if (priceDiff !== 0) return priceDiff;
    const aDuration = a.slices.reduce(
      (sum, s) => sum + durationToMinutes(s.duration),
      0
    );
    const bDuration = b.slices.reduce(
      (sum, s) => sum + durationToMinutes(s.duration),
      0
    );
    return aDuration - bDuration;
  });
}

export async function createOfferRequest(
  params: SearchParams
): Promise<NormalizedOffer[]> {
  const slices = buildSlices(params);
  const passengers = expandPassengers(params.passengers);

  const body = {
    data: {
      slices,
      passengers,
      ...(params.cabin_class ? { cabin_class: params.cabin_class } : {}),
      ...(params.max_connections !== undefined
        ? { max_connections: params.max_connections }
        : {}),
    },
  };

  const result = await duffelRequest<RawOfferRequest>("/air/offer_requests", {
    method: "POST",
    body,
    params: { return_offers: true },
  });

  return result.offers.map(normalizeOffer);
}

// Fetches purchasable ancillaries (extra bags, seat selection) for a single offer.
// Duffel doesn't compute these for every offer in a bulk search - it's an
// on-demand lookup, requested only when the user expands "bag & seat options".
export async function getOfferWithServices(
  offerId: string
): Promise<NormalizedOffer> {
  const raw = await duffelRequest<RawOffer>(`/air/offers/${offerId}`, {
    params: { return_available_services: true },
  });
  return normalizeOffer(raw);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}

export interface SearchResult {
  offers: NormalizedOffer[];
  usedParams: SearchParams;
  dateAdjusted: boolean;
}

// Try the exact date first; if 0 results try ±1 and ±2 days
export async function searchWithFallback(
  params: SearchParams
): Promise<SearchResult> {
  const raw = await createOfferRequest(params);
  if (raw.length > 0) {
    return { offers: rankOffers(raw), usedParams: params, dateAdjusted: false };
  }

  // Multi-city legs are chronologically interdependent - shifting only the
  // first leg's date could put it after a later leg, so we don't guess here.
  if (isMultiCity(params)) {
    return { offers: [], usedParams: params, dateAdjusted: false };
  }

  const today = new Date().toISOString().split("T")[0];
  for (const delta of [1, -1, 2, -2, 3]) {
    const altDate = addDays(params.departure_date, delta);
    if (altDate < today) continue;

    let altReturn = params.return_date;
    if (altReturn && params.return_date) {
      altReturn = addDays(params.return_date, delta);
    }

    const altParams: SearchParams = {
      ...params,
      departure_date: altDate,
      ...(altReturn ? { return_date: altReturn } : {}),
    };

    try {
      const altRaw = await createOfferRequest(altParams);
      if (altRaw.length > 0) {
        return {
          offers: rankOffers(altRaw),
          usedParams: altParams,
          dateAdjusted: true,
        };
      }
    } catch {
      // try next delta
    }
  }

  return { offers: [], usedParams: params, dateAdjusted: false };
}

export interface PriceCalendarEntry {
  date: string;
  cheapestAmount: string | null;
  currency: string | null;
}

// Builds a visible price-per-date strip around the requested departure date -
// like Google Flights' date grid - instead of silently picking one alternative
// the way searchWithFallback does. Independent of searchWithFallback so it never
// changes its call count/behavior; the caller runs this alongside it.
export async function getPriceCalendar(
  params: SearchParams,
  windowDays = 3,
  // The caller (e.g. chat/route.ts) has usually already searched
  // params.departure_date itself moments earlier - passing that result in
  // avoids re-querying Duffel for a date we already have the answer for.
  knownExactDate?: Pick<PriceCalendarEntry, "cheapestAmount" | "currency">
): Promise<PriceCalendarEntry[]> {
  // Same reasoning as searchWithFallback: shifting one leg of a multi-city
  // itinerary in isolation doesn't produce a meaningful comparison.
  if (isMultiCity(params)) return [];

  const today = new Date().toISOString().split("T")[0];
  const deltas = Array.from({ length: windowDays * 2 + 1 }, (_, i) => i - windowDays);

  const entries = await Promise.all(
    deltas.map(async (delta): Promise<PriceCalendarEntry | null> => {
      const date = addDays(params.departure_date, delta);
      if (date < today) return null;

      if (delta === 0 && knownExactDate) {
        return { date, ...knownExactDate };
      }

      const shifted: SearchParams = {
        ...params,
        departure_date: date,
        ...(params.return_date ? { return_date: addDays(params.return_date, delta) } : {}),
      };

      try {
        const offers = await createOfferRequest(shifted);
        // Apply the same preference filters as the main search - otherwise a
        // date tile can advertise a price (e.g. the cheapest non-refundable
        // fare) that "refundable only" would never actually return if clicked.
        const { offers: filtered } = filterByPreferences(offers, shifted);
        const cheapest = rankOffers(filtered)[0];
        return {
          date,
          cheapestAmount: cheapest?.total_amount ?? null,
          currency: cheapest?.total_currency ?? null,
        };
      } catch {
        return { date, cheapestAmount: null, currency: null };
      }
    })
  );

  return entries
    .filter((e): e is PriceCalendarEntry => e !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export interface FilterResult {
  offers: NormalizedOffer[];
  note: string | null;
}

export function filterByPreferences(
  offers: NormalizedOffer[],
  params: SearchParams
): FilterResult {
  // Nothing to filter, and "no matches - showing all options" notes would be
  // self-contradictory alongside a "no flights found" reply.
  if (offers.length === 0) return { offers, note: null };

  let filtered = offers;
  const notes: string[] = [];

  if (params.prefer_refundable) {
    const refundable = filtered.filter((o) => o.conditions.refundable);
    if (refundable.length > 0) {
      notes.push(`Showing ${refundable.length} refundable flight${refundable.length !== 1 ? "s" : ""} only.`);
      filtered = refundable;
    } else {
      notes.push("No refundable flights found - showing all options (check the badge on each result).");
    }
  }

  if (params.prefer_changeable) {
    const changeable = filtered.filter((o) => o.conditions.changeable);
    if (changeable.length > 0) {
      notes.push(`Showing ${changeable.length} changeable flight${changeable.length !== 1 ? "s" : ""} only.`);
      filtered = changeable;
    } else {
      notes.push("No changeable flights found - showing all options.");
    }
  }

  if (params.depart_after || params.depart_before) {
    const timeFiltered = filtered.filter((o) => {
      const dep = o.slices[0]?.segments[0]?.departing_at;
      if (!dep) return true;
      const time = dep.slice(11, 16); // "HH:MM" from ISO datetime
      if (params.depart_after && time < params.depart_after) return false;
      if (params.depart_before && time > params.depart_before) return false;
      return true;
    });

    const range = [
      params.depart_after ? `after ${params.depart_after}` : "",
      params.depart_before ? `before ${params.depart_before}` : "",
    ]
      .filter(Boolean)
      .join(" and ");

    if (timeFiltered.length > 0) {
      notes.push(`Filtered to ${timeFiltered.length} flight${timeFiltered.length !== 1 ? "s" : ""} departing ${range}.`);
      filtered = timeFiltered;
    } else {
      notes.push(`No flights departing ${range} - showing all departure times.`);
    }
  }

  return { offers: filtered, note: notes.length > 0 ? notes.join(" ") : null };
}

function buildSlices(params: SearchParams) {
  const outbound = {
    origin: params.origin,
    destination: params.destination,
    departure_date: params.departure_date,
  };
  if (params.additional_slices?.length) {
    return [outbound, ...params.additional_slices];
  }
  if (!params.return_date) return [outbound];
  return [
    outbound,
    {
      origin: params.destination,
      destination: params.origin,
      departure_date: params.return_date,
    },
  ];
}

function expandPassengers(
  passengers: SearchParams["passengers"]
): Array<{ type: string }> {
  return passengers.flatMap(({ type, count }) =>
    Array.from({ length: count }, () => ({ type }))
  );
}
