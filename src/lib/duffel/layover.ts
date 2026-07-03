import type { NormalizedOffer } from "./types";

// Minutes between one segment's arrival and the next segment's departure -
// the ground time a passenger spends at the connecting airport. Callers pass
// ISO datetimes straight off NormalizedSegment (arriving_at / departing_at).
export function layoverMinutes(arrivingAt: string, nextDepartingAt: string): number {
  return Math.round((new Date(nextDepartingAt).getTime() - new Date(arrivingAt).getTime()) / 60000);
}

// "Nh Nm" (or just "Nm" under an hour) - shared by OfferCard's segment detail
// view and OfferList's layover-duration filter, so the two never disagree on
// what counts as a "2h" or "4h" layover.
export function formatLayover(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export interface Layover {
  // IATA code of the connecting airport - the destination of the segment
  // just flown and the origin of the next one.
  airport: string;
  minutes: number;
}

// Every intermediate stop across all slices of an offer, in flight order.
// Nonstop slices contribute nothing. Used by OfferList's layover-duration and
// layover-airport filters.
export function getLayovers(offer: NormalizedOffer): Layover[] {
  const layovers: Layover[] = [];
  for (const slice of offer.slices) {
    for (let i = 0; i < slice.segments.length - 1; i++) {
      const seg = slice.segments[i];
      const next = slice.segments[i + 1];
      layovers.push({
        airport: seg.destination.iata_code,
        minutes: layoverMinutes(seg.arriving_at, next.departing_at),
      });
    }
  }
  return layovers;
}
