import { duffelRequest } from "./client";
import { normalizeSlice } from "./search";
import type {
  NormalizedOffer,
  NormalizedOrder,
  RawOrder,
} from "./types";

// Read-only post-booking status checks. Nothing here creates, changes, or
// cancels an order - CLAUDE.md guardrail #2 only applies to money-moving
// code paths, which this is not.

function normalizeOrder(order: RawOrder): NormalizedOrder {
  return {
    id: order.id,
    bookingReference: order.booking_reference,
    slices: order.slices.map(normalizeSlice),
    airlineInitiatedChanges: (order.airline_initiated_changes ?? []).map((c) => ({
      id: c.id,
      actionTaken: c.action_taken,
      createdAt: c.created_at,
    })),
  };
}

// Verified against live Duffel docs (https://duffel.com/docs/api/orders):
// GET /air/orders/{id} - fetches the order's current state as Duffel knows
// it (synced from the airline), including any schedule changes.
export async function getOrderStatus(orderId: string): Promise<NormalizedOrder> {
  const raw = await duffelRequest<RawOrder>(`/air/orders/${orderId}`);
  return normalizeOrder(raw);
}

export interface SegmentTimeChange {
  sliceIndex: number;
  segmentIndex: number;
  origin: string;
  destination: string;
  flightNumber: string;
  originalDepartingAt: string;
  currentDepartingAt: string;
  originalArrivingAt: string;
  currentArrivingAt: string;
}

export interface ScheduleChangeResult {
  hasChanges: boolean;
  segmentChanges: SegmentTimeChange[];
  // True when Duffel's own airline_initiated_changes list has an entry the
  // traveler hasn't accepted/rejected yet (action_taken === null). This can
  // be true even when segmentChanges is empty, e.g. an aircraft swap the
  // airline notified Duffel about that doesn't move the departure time.
  hasPendingAirlineChange: boolean;
}

// Pure diff: compares the offer snapshot captured at booking time against
// the order's current segment times. Segments are matched positionally
// (same slice index, same segment index) - itinerary structure (number of
// slices/segments) doesn't change for a same-day schedule shift, and if the
// airline substitutes/cancels a segment entirely that shows up as a length
// mismatch we simply skip (surfaced separately via hasPendingAirlineChange).
export function checkForScheduleChanges(
  originalOffer: NormalizedOffer,
  currentOrder: NormalizedOrder
): ScheduleChangeResult {
  const segmentChanges: SegmentTimeChange[] = [];

  originalOffer.slices.forEach((slice, sliceIndex) => {
    const currentSlice = currentOrder.slices[sliceIndex];
    if (!currentSlice) return;

    slice.segments.forEach((seg, segmentIndex) => {
      const currentSeg = currentSlice.segments[segmentIndex];
      if (!currentSeg) return;

      if (
        seg.departing_at !== currentSeg.departing_at ||
        seg.arriving_at !== currentSeg.arriving_at
      ) {
        segmentChanges.push({
          sliceIndex,
          segmentIndex,
          origin: seg.origin.iata_code,
          destination: seg.destination.iata_code,
          flightNumber: `${seg.marketing_carrier.iata_code}${seg.flight_number}`,
          originalDepartingAt: seg.departing_at,
          currentDepartingAt: currentSeg.departing_at,
          originalArrivingAt: seg.arriving_at,
          currentArrivingAt: currentSeg.arriving_at,
        });
      }
    });
  });

  const hasPendingAirlineChange = currentOrder.airlineInitiatedChanges.some(
    (c) => c.actionTaken === null
  );

  return {
    hasChanges: segmentChanges.length > 0,
    segmentChanges,
    hasPendingAirlineChange,
  };
}
