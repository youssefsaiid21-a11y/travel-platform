import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "crypto";

// A plain `!==` on a bearer token leaks timing information an attacker with
// network access could use to guess it byte-by-byte; both sides must be the
// same length before timingSafeEqual will even compare them.
function isValidCronSecret(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Shared by every /api/cron/* route - Vercel Cron (or a GitHub Actions
// `schedule:` trigger, for anything not run via Vercel Cron) signs requests
// with a bearer token in the Authorization header matching CRON_SECRET.
// Returns a 401 response to send as-is when the check fails, or null when
// it's fine to proceed.
export function requireCronSecret(req: NextRequest): NextResponse | null {
  if (process.env.NODE_ENV === "test") return null;

  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  const provided = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!cronSecret || !isValidCronSecret(provided, cronSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
