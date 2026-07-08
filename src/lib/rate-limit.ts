import { NextResponse, type NextRequest } from "next/server";
import { Redis } from "@upstash/redis";

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

// In-process fallback - used directly when Upstash isn't configured (local
// dev, CI, tests), and as the fail-open target when Redis errors or times
// out. Per-instance, so it under-counts across multiple serverless
// instances - the real distributed limit is Redis; this is the degraded
// safety net, not a replacement for it.
function checkRateLimitInMemory(
  key: string,
  max: number,
  windowMs: number
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

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : null;

// Only set EXPIRE on the call that creates the key (count === 1) - setting
// it on every INCR would push the window back on every request and a
// steady stream of traffic would never actually hit a reset.
async function checkRateLimitRedis(
  key: string,
  max: number,
  windowMs: number
): Promise<{ ok: boolean; retryAfter?: number }> {
  const windowSeconds = Math.ceil(windowMs / 1000);
  const count = await redis!.incr(key);
  if (count === 1) {
    await redis!.expire(key, windowSeconds);
  }
  if (count > max) {
    const ttl = await redis!.ttl(key);
    return { ok: false, retryAfter: ttl > 0 ? ttl : windowSeconds };
  }
  return { ok: true };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("rate limit check timed out")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

// Redis outage/latency shouldn't hold up the request it's meant to protect -
// a short timeout plus fail-open to the in-memory limiter means an outage
// degrades protection instead of removing it (or, worse, breaking the
// deliberately-anonymous /api/chat path entirely).
const REDIS_TIMEOUT_MS = 150;

export async function checkRateLimit(
  key: string,
  { max = 8, windowMs = 60_000 } = {}
): Promise<{ ok: boolean; retryAfter?: number }> {
  if (redis) {
    try {
      return await withTimeout(checkRateLimitRedis(key, max, windowMs), REDIS_TIMEOUT_MS);
    } catch {
      // Fall through to the in-memory path below.
    }
  }
  return checkRateLimitInMemory(key, max, windowMs);
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
export async function enforceRateLimit(
  req: NextRequest,
  routeKey: string,
  options?: { max?: number; windowMs?: number }
): Promise<NextResponse | null> {
  if (process.env.NODE_ENV === "test") return null;

  const rl = await checkRateLimit(`${routeKey}:${getClientIp(req)}`, options);
  if (rl.ok) return null;

  return NextResponse.json(
    { error: "Too many requests. Please wait a moment." },
    { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } }
  );
}
