import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkTrackedSearchForPriceDrop } from "@/lib/priceTracking/checkPriceDrop";
import { enforceRateLimit } from "@/lib/rate-limit";

// Batch job: re-checks every still-relevant TrackedSearch against Duffel and
// fires a notification (via sendPriceDropAlert) for any that got cheaper.
//
// There's no cron scheduler built into Next.js - in a real deployment this
// route would be invoked on a schedule rather than by a person:
//   - Vercel Cron (vercel.json `crons` entry hitting this path on a schedule)
//     - Vercel signs cron requests with a bearer token in the Authorization
//       header (CRON_SECRET) that this route should verify.
//   - or a GitHub Actions workflow on a `schedule:` trigger that curls this
//     URL with a shared secret header.
// For now this is intentionally unauthenticated so it can be triggered
// manually during development - do NOT deploy it this way. Before going
// live, add a check like:
//   if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`)
//     return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
export async function POST(req: NextRequest) {
  // Defense-in-depth alongside the CRON_SECRET check this route needs before
  // deployment (see above) - even in dev, this is the most expensive
  // operation in the app (one Duffel search per tracked row, unbounded
  // concurrency), so it shouldn't be exempt from the rate-limiting every
  // other route here has.
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

  const results = await Promise.allSettled(
    dueSearches.map((tracked) => checkTrackedSearchForPriceDrop(tracked))
  );

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
