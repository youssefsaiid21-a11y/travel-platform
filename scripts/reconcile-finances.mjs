#!/usr/bin/env node
// Computes real margin (service-fee revenue vs. what was actually paid to
// Duffel) from confirmed bookings, grouped by currency since summing mixed
// currencies would be meaningless. This is the computation the Finance
// agent (.claude/agents/finance-agent.md, not yet activated - see
// BUSINESS_STATE.md) should eventually run on a schedule; built now as a
// real script so the numbers exist and are correct before that agent's
// first real invocation is approved. The grouping/summing math is
// intentionally duplicated (not imported) from src/lib/reconciliation.ts,
// which is unit tested - this is a plain Node .mjs script with no
// TypeScript loader, so it can't import that file directly. If the math
// ever changes, update both.
//
// Usage: DATABASE_URL=... node scripts/reconcile-finances.mjs

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

function summarizeBookings(bookings) {
  const byCurrency = new Map();
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

async function main() {
  const bookings = await db.booking.findMany({
    where: { status: "confirmed" },
    select: { totalAmount: true, totalCurrency: true, serviceFeeAmount: true },
  });

  if (bookings.length === 0) {
    console.log("No confirmed bookings yet - nothing to reconcile.");
    return;
  }

  const byCurrency = summarizeBookings(bookings);

  console.log("=== Financial Reconciliation ===");
  console.log(`Confirmed bookings: ${bookings.length}\n`);
  for (const [currency, e] of byCurrency) {
    console.log(currency);
    console.log(`  Bookings:                     ${e.count}`);
    console.log(`  Customer paid (total):        ${e.total.toFixed(2)}`);
    console.log(`  Paid to Duffel (cost):        ${e.cost.toFixed(2)}`);
    console.log(`  Service fee revenue (margin): ${e.revenue.toFixed(2)}`);
    console.log("");
  }
}

main()
  .catch((err) => {
    console.error("Reconciliation failed:", err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
