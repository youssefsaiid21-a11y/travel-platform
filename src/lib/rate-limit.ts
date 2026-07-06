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

// A reverse proxy (Vercel's edge included) APPENDS the IP it actually
// observed connecting to it onto x-forwarded-for - it does not overwrite
// index 0. A client can freely set its own x-forwarded-for on the original
// request, so trusting the FIRST entry (as this used to) makes the rate
// limit's key attacker-chosen: rotate a fake value every request and every
// request lands in a fresh bucket, bypassing the limit entirely. The last
// entry is the one Vercel's own edge appended and can't be spoofed by the
// client - that's the one to trust.
export function getClientIp(req: NextRequest): string {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const parts = forwardedFor.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  return req.headers.get("x-real-ip") ?? "unknown";
}

// Shared by API routes that rate-limit per client IP. Returns a 429 response
// to send as-is when the caller is over budget, or null when it's fine to proceed.
// `routeKey` namespaces the budget so unrelated routes (e.g. chat search vs.
// bag/seat lookups) don't starve each other's quota.
export function enforceRateLimit(req: NextRequest, routeKey: string): NextResponse | null {
  if (process.env.NODE_ENV === "test") return null;

  const rl = checkRateLimit(`${routeKey}:${getClientIp(req)}`);
  if (rl.ok) return null;

  return NextResponse.json(
    { error: "Too many requests. Please wait a moment." },
    { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } }
  );
}
