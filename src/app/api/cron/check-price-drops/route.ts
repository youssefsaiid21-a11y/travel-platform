import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkTrackedSearchForPriceDrop } from "@/lib/priceTracking/checkPriceDrop";
import { enforceRateLimit } from "@/lib/rate-limit";
import { requireCronSecret } from "@/lib/cronAuth";

// Batch job: re-checks every still-relevant TrackedSearch against Duffel and
// fires a notification (via sendPriceDropAlert) for any that got cheaper.
//
// There's no cron scheduler built into Next.js - in a real deployment this
// route is invoked on a schedule rather than by a person:
//   - Vercel Cron (see vercel.json `crons` entry hitting this path) - Vercel
//     signs cron requests with a bearer token in the Authorization header
//     matching CRON_SECRET.
//   - or a GitHub Actions workflow on a `schedule:` trigger that curls this
//     URL with the same shared secret header.
//
// No maxDuration was previously set, meaning this ran against whatever
// Vercel's plan-based default ceiling is (as low as 10s on some plans) -
// with real Duffel calls batched at 10-concurrent (see checkPriceDrop.ts),
// total wall-clock time still scales with the tracked-search table size
// even though concurrency is bounded. 60s is a conservative stopgap
// supported on every Vercel plan; raise further (Pro/Enterprise support
// more) if the table grows enough to need it. The correct long-term fix
// once that happens is a real per-item queue, not a bigger number here or
// self-pagination - a naive cursor breaks because checkTrackedSearchForPriceDrop
// rewrites the very field (updatedAt) a cursor would sort on, and this cron
// only runs once/day, so paginating across invocations would silently skip
// rows rather than safely defer them. See CLAUDE.md's Architecture
// Transformation Roadmap, Phase 1b.
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const unauthorized = requireCronSecret(req);
  if (unauthorized) return unauthorized;

  // Defense-in-depth alongside the CRON_SECRET check above - even in dev,
  // this is the most expensive operation in the app (one Duffel search per
  // tracked row, unbounded concurrency), so it shouldn't be exempt from the
  // rate-limiting every other route here has.
  const rateLimited = enforceRateLimit(req, "cron-check-price-drops");
  if (rateLimited) return rateLimited;

  const today = new Date().toISOString().split("T")[0];

  // Skip searches whose departure date has already passed - nothing to
  // alert on, and re-querying Duffel for them would just waste a request.
  const dueSearches = await db.trackedSearch.findMany({
    where: { departureDate: { gte: today } },
    include: {
      user: {
        select: {
          email: true,
          passengerProfile: { select: { phone: true } },
        },
      },
    },
  });

  // Each check is one live Duffel search - firing all of them at once would
  // scale with the size of the table, not with what Duffel or this
  // function's own execution-time budget can actually sustain. Chunking
  // keeps at most BATCH_SIZE in flight at a time; batches still run
  // sequentially, but each one is cheap and bounded regardless of how many
  // tracked searches exist.
  const BATCH_SIZE = 10;
  const results: PromiseSettledResult<Awaited<ReturnType<typeof checkTrackedSearchForPriceDrop>>>[] = [];
  for (let i = 0; i < dueSearches.length; i += BATCH_SIZE) {
    const batch = dueSearches.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.allSettled(
      batch.map((tracked) => checkTrackedSearchForPriceDrop(tracked))
    );
    results.push(...batchResults);
  }

  const checked = results.filter((r) => r.status === "fulfilled").length;
  const dropped = results.filter(
    (r) => r.status === "fulfilled" && r.value.dropped
  ).length;
  const failed = results.filter((r) => r.status === "rejected").length;

  if (failed > 0) {
    console.error(
      "[cron/check-price-drops] failures:",
      results
        .filter((r): r is PromiseRejectedResult => r.status === "rejected")
        .map((r) => r.reason)
    );
  }

  return NextResponse.json({
    total: dueSearches.length,
    checked,
    dropped,
    failed,
  });
}
