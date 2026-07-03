export interface NormalizedSegment {
  departing_at: string;
  arriving_at: string;
  duration: string;
  origin: { iata_code: string; name: string };
  destination: { iata_code: string; name: string };
  marketing_carrier: { iata_code: string; name: string };
  operating_carrier: { iata_code: string; name: string };
  flight_number: string;
}

export interface NormalizedSlice {
  duration: string;
  stops: number;
  segments: NormalizedSegment[];
}

export interface NormalizedBaggageAllowance {
  checked: number;
  carryOn: number;
}

export interface NormalizedService {
  id: string;
  type: string;
  amount: string;
  currency: string;
  label: string;
}

export interface NormalizedFee {
  amount: string;
  currency: string;
}

export interface NormalizedOffer {
  id: string;
  expires_at: string;
  total_amount: string;
  total_currency: string;
  base_amount: string;
  tax_amount: string | null;
  owner: { iata_code: string; name: string; logo_symbol_url?: string };
  slices: NormalizedSlice[];
  conditions: {
    refundable: boolean;
    changeable: boolean;
    // Real penalty fee for refunding/changing before departure, when Duffel
    // discloses it. undefined/null when the airline doesn't expose an amount
    // (e.g. conditions unknown) - never fabricate a fee amount.
    refundFee?: NormalizedFee | null;
    changeFee?: NormalizedFee | null;
  };
  passengers: Array<{ id: string; type: string }>;
  // Included (free) baggage allowance - undefined when the source data doesn't carry it
  includedBaggage?: NormalizedBaggageAllowance;
  // Purchasable ancillaries (extra bags, seat selection) - only populated after a
  // getOfferWithServices() fetch; absent on offers straight out of search results
  services?: NormalizedService[];
}

// Raw Duffel API shapes - only what we actually use
export interface RawAirport {
  iata_code: string;
  name: string;
}

export interface RawAirline {
  iata_code: string;
  name: string;
  logo_symbol_url?: string;
}

export interface RawBaggage {
  type: "checked" | "carry_on";
  quantity: number;
}

export interface RawSegmentPassenger {
  passenger_id: string;
  cabin_class: string;
  // Optional: absent on some fare types/response variants (mirrors the
  // caution on RawSegment.passengers above)
  baggages?: RawBaggage[];
}

export interface RawSegment {
  departing_at: string;
  arriving_at: string;
  duration: string;
  origin: RawAirport;
  destination: RawAirport;
  marketing_carrier: RawAirline;
  marketing_carrier_flight_number: string;
  operating_carrier: RawAirline;
  operating_carrier_flight_number: string;
  stops: unknown[];
  // Optional: absent on some fixtures/older responses
  passengers?: RawSegmentPassenger[];
}

export interface RawService {
  id: string;
  type: string; // "baggage" | "seat" | ...
  total_amount: string;
  total_currency: string;
  maximum_quantity: number;
  metadata?: Record<string, unknown>;
}

export interface RawSlice {
  duration: string;
  segments: RawSegment[];
}

// Verified against live Duffel docs (https://duffel.com/docs/api/offers):
// refund_before_departure / change_before_departure carry `allowed` plus
// `penalty_amount` / `penalty_currency` when the airline discloses a fee.
// Both the penalty fields and the whole condition object are treated as
// optional/nullable here - not every fare/airline exposes a fee amount.
export interface RawConditions {
  refund_before_departure: {
    allowed: boolean;
    penalty_amount?: string | null;
    penalty_currency?: string | null;
  } | null;
  change_before_departure: {
    allowed: boolean;
    penalty_amount?: string | null;
    penalty_currency?: string | null;
  } | null;
}

export interface RawOffer {
  id: string;
  expires_at: string;
  total_amount: string;
  total_currency: string;
  base_amount: string;
  tax_amount: string | null;
  owner: RawAirline;
  slices: RawSlice[];
  conditions: RawConditions;
  passengers: Array<{ id: string; type: string }>;
  available_services?: RawService[];
}

export interface RawOfferRequest {
  id: string;
  live_mode: boolean;
  offers: RawOffer[];
}

// Seat maps - verified against live Duffel docs (https://duffel.com/docs/api/seat-maps
// and https://duffel.com/docs/guides/adding-seats):
// GET /air/seat_maps?offer_id={id} returns `data: SeatMap[]` (one seat map per
// segment). When a fare doesn't support seat selection at all, Duffel returns
// an empty array rather than an error - never assume a non-empty response.
export interface RawSeatAvailableService {
  id: string;
  passenger_id: string;
  total_amount: string;
  total_currency: string;
}

// `type` covers selectable seats plus non-seat cabin features the docs list:
// "seat" | "empty" | "bassinet" | "exit_row" | "lavatory" | "galley".
// A "seat" element with no (or empty) available_services is occupied/blocked,
// not purchasable - only present so the grid renders with the right shape.
export interface RawSeatElement {
  type: string;
  designator?: string;
  name?: string;
  disclosures?: string[];
  available_services?: RawSeatAvailableService[];
}

export interface RawSeatSection {
  elements: RawSeatElement[];
}

export interface RawSeatRow {
  sections: RawSeatSection[];
}

export interface RawSeatCabin {
  cabin_class?: string;
  deck: number;
  aisles: number;
  rows: RawSeatRow[];
  wings?: { first_row_index: number; last_row_index: number };
}

export interface RawSeatMap {
  id: string;
  segment_id: string;
  slice_id: string;
  cabins: RawSeatCabin[];
}

export interface NormalizedSeatOption {
  serviceId: string;
  passengerId: string;
  amount: string;
  currency: string;
}

export interface NormalizedSeatElement {
  type: string;
  designator?: string;
  // A "seat" element is only actually selectable when it carries at least
  // one available_service - occupied/blocked seats still appear (as type
  // "seat") so the grid keeps its real shape, but aren't purchasable.
  available: boolean;
  disclosures: string[];
  options: NormalizedSeatOption[];
}

export interface NormalizedSeatSection {
  elements: NormalizedSeatElement[];
}

export interface NormalizedSeatRow {
  sections: NormalizedSeatSection[];
}

export interface NormalizedSeatCabin {
  cabinClass?: string;
  deck: number;
  aisles: number;
  rows: NormalizedSeatRow[];
}

export interface NormalizedSeatMap {
  id: string;
  segmentId: string;
  sliceId: string;
  cabins: NormalizedSeatCabin[];
}
