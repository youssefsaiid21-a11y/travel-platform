// Single source of truth for "is this passenger's data complete enough to
// book a flight" - shared between the client (booking/confirm page, and the
// saved-profile completeness check that decides whether quick-book is safe
// to offer) and the server (POST /api/booking). Before this existed, the
// same rule was reimplemented three times and drifted: the quick-book
// gating check only verified the fields were present, not that the saved
// passport hadn't expired, so a returning user with an expired-but-saved
// passport could reach Stripe payment before the server rejected the order.
export interface PassengerDocFields {
  given_name: string;
  family_name: string;
  born_on: string;
  phone_number: string;
  nationality: string;
  passport_number: string;
  passport_expiry: string;
}

const ISO_COUNTRY_RE = /^[A-Z]{2}$/;

// todayStr must be a "YYYY-MM-DD" snapshot supplied by the caller, so this
// function itself never calls Date.now()/new Date() - the client calls it
// during render (primaryIsValid/extrasAreValid), where an impure Date call
// would violate React's render-purity rule; the server is free to compute
// it fresh since API route handlers aren't render functions.
export function passengerValidationError(
  p: Partial<PassengerDocFields>,
  todayStr: string
): string | null {
  if (!p.given_name?.trim() || !p.family_name?.trim() || !p.born_on || !p.phone_number?.trim()) {
    return "Passenger name, date of birth, and phone number are required.";
  }
  if (!p.nationality || !ISO_COUNTRY_RE.test(p.nationality)) {
    return "A valid nationality is required to book this flight.";
  }
  if (!p.passport_number?.trim()) {
    return "A passport number is required to book this flight.";
  }
  if (!p.passport_expiry || Number.isNaN(Date.parse(p.passport_expiry))) {
    return "A valid passport expiry date is required to book this flight.";
  }
  // Plain string comparison of two "YYYY-MM-DD" values, not a Date.now()
  // timestamp comparison - keeps this function pure and avoids the client
  // and server disagreeing right at a timezone boundary.
  if (p.passport_expiry <= todayStr) {
    return "The passport must not be expired.";
  }
  return null;
}
