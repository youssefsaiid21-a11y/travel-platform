# AI Travel Platform - Project Memory

## What this is
An AI-agent-driven flight booking platform. V1 scope: conversational flight
search and comparison. Booking/ticketing is a later phase - do not build
payment or order-creation flows until Phase 2 is explicitly scoped.

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

## Working style
- Use plan mode / write a PLAN.md for anything beyond a trivial fix -
  don't jump straight to code on vertical slices.
- Use a subagent for code review before marking a slice done; have it
  check the diff against the relevant PLAN.md's acceptance criteria, not
  style preferences.
- Show evidence of done (test output, not just an assertion).
