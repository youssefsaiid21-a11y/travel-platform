export interface ExtraSlice {
  origin: string;
  destination: string;
  departure_date: string;
}

export interface SearchParams {
  origin: string;
  destination: string;
  departure_date: string;
  return_date?: string;
  passengers: Array<{ type: "adult" | "child" | "infant"; count: number }>;
  cabin_class?: "economy" | "premium_economy" | "business" | "first";
  max_connections?: number;
  flexible_date_note?: string;
  // Post-search preference filters
  prefer_refundable?: boolean;
  prefer_changeable?: boolean;
  depart_after?: string;  // "HH:MM" 24h - earliest departure time
  depart_before?: string; // "HH:MM" 24h - latest departure time
  // Multi-city legs beyond the primary origin→destination slice above.
  // When present, return_date is ignored - a trip is either a return trip
  // or a multi-city trip, never both.
  additional_slices?: ExtraSlice[];
}

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}
