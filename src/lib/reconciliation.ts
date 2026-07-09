export interface ReconciliationInput {
  totalAmount: string;
  totalCurrency: string;
  serviceFeeAmount: string;
}

export interface ReconciliationSummary {
  count: number;
  total: number;
  cost: number;
  revenue: number;
}

// Groups confirmed bookings by currency (summing mixed currencies would be
// meaningless) and computes: what the customer paid in total, what was
// actually paid to Duffel (cost), and the service-fee margin retained.
// Bookings that predate the service-fee model have serviceFeeAmount
// backfilled to "0.00" - they correctly contribute zero margin, not a bug.
export function summarizeBookings(
  bookings: ReconciliationInput[]
): Map<string, ReconciliationSummary> {
  const byCurrency = new Map<string, ReconciliationSummary>();
  for (const b of bookings) {
    const total = parseFloat(b.totalAmount);
    const fee = parseFloat(b.serviceFeeAmount);
    const cost = total - fee;
    const entry = byCurrency.get(b.totalCurrency) ?? { count: 0, total: 0, cost: 0, revenue: 0 };
    entry.count += 1;
    entry.total += total;
    entry.cost += cost;
    entry.revenue += fee;
    byCurrency.set(b.totalCurrency, entry);
  }
  return byCurrency;
}
