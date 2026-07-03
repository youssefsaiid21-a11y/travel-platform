import { NextResponse, type NextRequest } from "next/server";

interface RateEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateEntry>();

// 2% chance per call: sweep expired entries so the Map never grows unbounded
function maybePrune(now: number) {
  if (Math.random() > 0.02) return;
  for (const [k, v] of store) {
    if (now >= v.resetAt) store.delete(k);
  }
}

export function checkRateLimit(
  key: string,
  { max = 8, windowMs = 60_000 } = {}
): { ok: boolean; retryAfter?: number } {
  const now = Date.now();
  maybePrune(now);

  const entry = store.get(key);

  if (!entry || now >= entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }

  if (entry.count >= max) {
    return { ok: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
  }

  entry.count++;
  return { ok: true };
}

// Shared by API routes that rate-limit per client IP. Returns a 429 response
// to send as-is when the caller is over budget, or null when it's fine to proceed.
// `routeKey` namespaces the budget so unrelated routes (e.g. chat search vs.
// bag/seat lookups) don't starve each other's quota.
export function enforceRateLimit(req: NextRequest, routeKey: string): NextResponse | null {
  if (process.env.NODE_ENV === "test") return null;

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";
  const rl = checkRateLimit(`${routeKey}:${ip}`);
  if (rl.ok) return null;

  return NextResponse.json(
    { error: "Too many requests. Please wait a moment." },
    { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } }
  );
}
