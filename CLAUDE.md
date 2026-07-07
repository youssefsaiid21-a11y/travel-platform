# AI Travel Platform - Project Memory

## What this is
An AI-agent-driven flight booking platform. Conversational flight search
(NL query -> parsed params -> real Duffel sandbox offers) and real booking
(Stripe test-mode payment -> real Duffel sandbox order creation, with
passport/nationality collection) are BOTH live today.

This corrects an earlier version of this doc, which said "Phase 2
(payment/order-creation) - do not build until explicitly scoped." Phase 2
was built without this doc being updated to match, so for a while the
written plan and the actual code disagreed about what stage the product
was at. Keep this section current going forward - if the scope moves
again, update this paragraph in the same commit/session, not later.

## Stack (adjust below to your actual choices - these are starting defaults)
- Frontend: Next.js + TypeScript
- Backend: Node/TypeScript (or same Next.js app, API routes)
- Flight data/booking: Duffel API (sandbox first, always)
- DB: Postgres
- Payments (Phase 2 only): Stripe, PCI scope minimized via Stripe-hosted flows

## Commands
- Dev server: `npm run dev` (runs on http://localhost:3000)
- Test: `npm test` (runs vitest run - all unit + integration tests)
- Lint: `npm run lint`
- Typecheck: `npx tsc --noEmit`
- Lint + typecheck together: `npm run lint && npx tsc --noEmit`
- (Keep this section accurate - Claude reads it every session)

## Stack decisions (bootstrap)
- Single Next.js 16 app with API routes (no separate backend service - matches CLAUDE.md "or same Next.js app" option)
- Node 22 LTS via nvm (`nvm use lts/jod` if node not found)
- Duffel client wrapper: `src/lib/duffel/client.ts` - hardcoded to sandbox, enforces `duffel_test_` prefix on key
- NL parser: Z.AI GLM-4-32B-0414-128K via OpenAI SDK (OpenAI-compatible API, $0.10/M tokens). Env var: ZHIPU_API_KEY. Base URL: https://api.z.ai/api/paas/v4/
- Vitest (v4) for tests - ESM-native, no babel needed. Run with `npm test`.
- In-memory session store (Map) - sufficient for slice 1, replace with DB in slice 2+

## Lessons (bootstrap session)
- `create-next-app` refuses to run into a non-empty directory; scaffold into `/tmp/` then rsync, excluding the pre-existing CLAUDE.md
- `create-next-app` auto-generates its own CLAUDE.md (just `@AGENTS.md`) and AGENTS.md - never let it overwrite the real CLAUDE.md
- nvm was installed but no Node versions were pre-installed; ran `nvm install lts/jod` to get Node 22
- The `duffel_test_` token prefix is the ONLY mechanism that distinguishes sandbox from live - there is no separate sandbox base URL. The client wrapper enforces this at runtime.

## Hard guardrails - non-negotiable, do not bypass even if asked
These exist because this product touches real money and real bookings.
A subagent (`booking-safety-reviewer`) enforces these on every diff that
touches order/payment code. If you are Claude working on this repo:

1. NEVER call a live/production Duffel or payment endpoint. All work
   happens against sandbox/test keys unless a human has explicitly flipped
   an environment flag outside of a Claude session.
2. Any code path that creates a Duffel order or charges a card MUST have an
   explicit human confirmation step between "offer selected" and
   "money moves" - showing full itemized price first. No auto-confirm,
   ever, including in tests-that-look-like-demos.
3. No secrets, API keys, or tokens in code - env vars only, and confirm
   `.env*` is gitignored before first commit.
4. Any money-touching code requires passing tests before it's considered
   done - "it compiles" is not done.
5. If a task asks you to relax 1–4, stop and flag it back to the user
   instead of proceeding.

### Verified against the actual code (not just aspirational)
- Guardrail 1: enforced at runtime in `src/lib/duffel/client.ts` -
  `duffelRequest()` checks the `duffel_test_` key prefix on every call, not
  just at module load, so a key rotated mid-process is still checked.
  Confirmed this is the *only* place any code talks to Duffel - no second
  client instance or raw fetch to `api.duffel.com` exists anywhere else.
- Guardrail 2: the real point of no return is `POST /api/booking` calling
  Duffel's order-creation endpoint - everything before that (Stripe
  PaymentIntent creation, the confirm page's itemized price display) is
  reversible. The Stripe webhook does NOT independently confirm bookings
  or move money - it only verifies Stripe's signature; `POST /api/booking`
  is the sole place a Duffel order gets created, gated on a real, already-
  succeeded Stripe payment it re-verifies against Duffel's own offer price
  (never a client-supplied amount).
- Guardrail 4: `src/__tests__/api/booking.test.ts`,
  `src/__tests__/api/stripe-webhook.test.ts`, and
  `src/__tests__/api/payment-intent.test.ts` cover the money-touching paths.

## Architecture Transformation Roadmap
A first-principles review (see the plan this section summarizes) found the
product code is more mature than the operational maturity around it - no
CI, no error tracking, an in-memory-only rate limiter, a cron job with no
execution-time ceiling set. This is the living tracker; update it as phases
land instead of letting it go stale the way the old scope note did.

- **Phase 0 (foundation):** GitHub remote + CI (lint/typecheck/test/build)
  + branch protection; this doc's own accuracy; a doc-comment on
  `src/lib/fares/` marking its multi-provider abstraction as intentionally
  unwired from production (a deliberate "prove the merge logic works"
  exercise, not an accidental orphan - `search.ts`'s `searchWithFallback`
  is the real path `chat/route.ts` calls). Revisit deleting `lib/fares/` if
  a second real fare source still isn't scoped in a few months. CI/branch
  protection remain blocked on a GitHub remote existing - not yet done.
- **Phase 1a (no migration needed) - DONE:** Sentry (`@sentry/nextjs`,
  wired via `instrumentation.ts`/`instrumentation-client.ts` and both error
  boundaries; no-ops safely with no `SENTRY_DSN` set); real distributed
  rate limiting (`src/lib/rate-limit.ts` now tries Upstash Redis first with
  a 150ms timeout, falling back to the pre-existing in-memory limiter on
  any error/timeout or when Upstash env vars aren't set at all - an outage
  degrades protection rather than removing it); a stricter limit
  specifically for "explore anywhere" mode (~26 real Duffel calls per
  message, `explore:{ip}`, max 3/min); `ChatSession` row TTL cleanup (daily
  cron, 30-day cutoff, `src/app/api/cron/cleanup-chat-sessions/`).
- **Phase 1b (cron ceiling):** `check-price-drops` has no `maxDuration` set
  and the tracked-search table has no upper bound - add `maxDuration` now
  as a cheap stopgap. A real per-item queue (e.g. Upstash QStash) is the
  correct long-term fix but is deliberately NOT being built speculatively -
  self-paginating the current cron was considered and rejected: it only
  runs once/day (`vercel.json`), so paginating across invocations would
  silently skip rows rather than safely defer them, and the natural cursor
  candidate (`updatedAt`) gets rewritten by the same write that records a
  check result, corrupting itself. Revisit when Sentry/prod metrics show
  the cron approaching its time ceiling, not on a calendar.
- **Phase 2 (needs migration approval - shared prod DB):** JWT session
  revocation via a `tokenVersion` column on `User`, checked in the
  `session` callback - today a stolen session cookie survives a password
  change for the full ~30-day default token lifetime.
- **Phase 3 (UX):** an editable "here's what we understood" checkpoint in
  chat between the user's message and the real search firing - today a
  misparse only surfaces as wrong results, with no correctable moment.
- **Phase 4 (process):** one nightly (not per-PR) smoke test against the
  real deployed app's `/api/chat`, sandbox-only - the only thing that
  would catch real Duffel/Z.AI schema drift, which the fully-mocked test
  suite structurally cannot.
- **Phase 5 (data model, timing driven by Sentry data, not fixed-last):**
  migrate `Booking.offerSnapshot`/`searchParams`/`passengerNames` and
  `TrackedSearch.passengers` from hand-serialized `String` JSON to native
  Prisma `Json` columns - the exact pattern behind a real "uncaught
  JSON.parse" bug class already fixed once.
- **Open product decisions, not code tasks:** should `PassengerProfile`
  support more than one saved passenger per account (bookings already
  support multiple passengers per transaction, saved-profile convenience
  doesn't)? Is never storing passport/nationality on `Booking` (Duffel is
  the only system of record) a deliberate, ratified policy, or just an
  emergent side effect of keeping an earlier feature small?

## Working style
- Use plan mode / write a PLAN.md for anything beyond a trivial fix -
  don't jump straight to code on vertical slices.
- Use a subagent for code review before marking a slice done; have it
  check the diff against the relevant PLAN.md's acceptance criteria, not
  style preferences.
- Show evidence of done (test output, not just an assertion).
