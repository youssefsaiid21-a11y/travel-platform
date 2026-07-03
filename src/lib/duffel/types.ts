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

export interface NormalizedOffer {
  id: string;
  expires_at: string;
  total_amount: string;
  total_currency: string;
  base_amount: string;
  tax_amount: string | null;
  owner: { iata_code: string; name: string; logo_symbol_url?: string };
  slices: NormalizedSlice[];
  conditions: { refundable: boolean; changeable: boolean };
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

export interface RawConditions {
  refund_before_departure: { allowed: boolean } | null;
  change_before_departure: { allowed: boolean } | null;
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
