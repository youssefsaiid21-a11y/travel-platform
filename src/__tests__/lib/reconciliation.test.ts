import { describe, it, expect } from "vitest";
import { summarizeBookings } from "@/lib/reconciliation";

describe("summarizeBookings", () => {
  it("returns an empty map for no bookings", () => {
    expect(summarizeBookings([])).toEqual(new Map());
  });

  it("sums total, cost, and revenue for bookings in one currency", () => {
    const result = summarizeBookings([
      { totalAmount: "105.00", totalCurrency: "GBP", serviceFeeAmount: "5.00" },
      { totalAmount: "205.00", totalCurrency: "GBP", serviceFeeAmount: "5.00" },
    ]);
    expect(result.get("GBP")).toEqual({
      count: 2,
      total: 310,
      cost: 300,
      revenue: 10,
    });
  });

  it("groups separately by currency rather than summing them together", () => {
    const result = summarizeBookings([
      { totalAmount: "105.00", totalCurrency: "GBP", serviceFeeAmount: "5.00" },
      { totalAmount: "50.00", totalCurrency: "USD", serviceFeeAmount: "5.00" },
    ]);
    expect(result.get("GBP")).toEqual({ count: 1, total: 105, cost: 100, revenue: 5 });
    expect(result.get("USD")).toEqual({ count: 1, total: 50, cost: 45, revenue: 5 });
  });

  it("computes zero margin for bookings that predate the fee model (backfilled serviceFeeAmount)", () => {
    const result = summarizeBookings([
      { totalAmount: "342.50", totalCurrency: "GBP", serviceFeeAmount: "0.00" },
    ]);
    expect(result.get("GBP")).toEqual({ count: 1, total: 342.5, cost: 342.5, revenue: 0 });
  });
});
