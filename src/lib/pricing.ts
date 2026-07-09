// Flat per-booking service fee, added on top of Duffel's own fare price.
// This is the business's only revenue source today - without it, Orbi
// passes through Duffel's exact price with zero margin. Never sent to
// Duffel (the order payment always uses the raw offer price); only
// charged to the customer via Stripe.
export const SERVICE_FEE_CENTS = 500;

export function offerAmountCents(offerTotalAmount: string): number {
  return Math.round(parseFloat(offerTotalAmount) * 100);
}

export function chargeAmountCents(offerTotalAmount: string): number {
  return offerAmountCents(offerTotalAmount) + SERVICE_FEE_CENTS;
}

export function centsToAmountString(cents: number): string {
  return (cents / 100).toFixed(2);
}
