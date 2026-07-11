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
- **Phase 2 (code done, migration NOT yet applied to prod):** JWT session
  revocation via a `tokenVersion` column on `User`, checked in the `jwt`
  callback (not `session` - returning `null` from `jwt` is what next-auth
  actually uses to invalidate a session; `session` runs too late to stop
  a session body being produced). `change-password` increments it
  atomically alongside the password hash. Migration file is written
  (`prisma/migrations/20260707215113_user_token_version/`) but deliberately
  NOT run against the shared production Neon DB yet - needs explicit
  human approval, since local dev and prod share one database here.
- **Phase 3 (UX) - DONE:** an editable "here's what we understood" checkpoint
  (`checkpoint` SSE event, `ChatRequest.confirmed_params` to resume) between
  the user's message and the real search firing. Editing is just sending a
  normal follow-up message - no separate edit protocol. Surfaced a real,
  pre-existing bug while building this: the checkpoint step wasn't recording
  an assistant turn in session history, so a follow-up's LLM call ended up
  with two consecutive "user" role messages (violates strict role
  alternation) - fixed by recording a placeholder assistant reply at
  checkpoint time and replacing it with the real reply once confirmed.
  Follow-up investigation of a flagged reliability issue (manual browser
  testing had seen follow-up messages repeatedly fail to get a tool call
  back from Z.AI): calling the real `nlParse()` directly, both serially and
  concurrently (18 total real API calls with the same message/history
  shape that failed live), reproduced ZERO failures - this was not a
  deterministic bug tied to the "[Previous search parameters: ...]"
  injection or any particular prompt shape, it was a transient burst in
  Z.AI's tool-call reliability during that testing window. As a modest,
  evidence-based hardening (real usage did see the existing single retry
  get exhausted back-to-back), bumped `nlParse`'s retry bound from 2 to 3
  attempts, with a test covering the retry loop actually retrying.
  An independent review pass afterward caught two more real issues, both
  fixed in the same session: (1) a stale/replayed `confirmed_params` could
  overwrite the WRONG checkpoint's placeholder history slot if the user had
  since edited to a newer checkpoint - fixed by only replacing in place
  when `confirmed_params` matches `session.last_params`, otherwise
  appending as its own turn; (2) splitting one logical search into two
  requests doubled `/api/chat`'s effective request cost, so its rate limit
  was bumped from the default 8/60s to 16/60s to compensate.
- **Phase 4 (process) - DONE:** `.github/workflows/smoke-test.yml` runs
  `scripts/smoke-test-chat.mjs` nightly (06:00 UTC) plus on manual dispatch -
  drives the full checkpoint->confirm round trip against the deployed app's
  `/api/chat` (real Duffel sandbox call, real Z.AI call), asserting a valid
  `done` event with offers. Deliberately separate from `ci.yml` and not run
  per-PR - the only thing that would catch real Duffel/Z.AI schema drift,
  which the fully-mocked test suite structurally cannot, but too
  slow/costly/vendor-dependent to gate merges on. `SMOKE_TEST_URL` repo
  variable overrides the default prod URL if the deployment domain ever
  changes. (An independent review caught that the first version of this
  script predated the Phase 3 checkpoint gate and would have failed on
  every single nightly run, not just on real drift - fixed before this
  was ever relied on.)
- **Phase 4b (process) - DONE, added 2026-07-10:** this repo deploys via an
  explicit `vercel deploy --prod`, not automatically on push/merge - a real
  gap surfaced the same day: several features (account recovery, the admin
  surface, a11y fixes, logo/favicon fixes) sat committed, tested, and
  pushed to `main` for hours while production kept serving an older build,
  undetected until an unrelated task happened to check a live deployment.
  `.github/workflows/check-deploy-freshness.yml` now runs
  `scripts/check-deploy-freshness.mjs` every 2 hours plus on manual
  dispatch - compares `GITHUB_SHA` (latest commit on `main`) against
  `GET /api/version`'s `commit` field (reads `VERCEL_GIT_COMMIT_SHA`, a
  Vercel system env var) on the live deployment, failing loudly if they
  don't match. No custom alerting - relies on GitHub's own
  failed-scheduled-workflow notification, same as `smoke-test.yml`. Requires
  "Automatically expose System Environment Variables" enabled in Vercel
  project settings for `/api/version` to return a real commit instead of
  `null`.
- **Phase 5 (code done, migration NOT yet applied to prod):** migrated
  `Booking.offerSnapshot`/`searchParams`/`passengerNames` and
  `TrackedSearch.passengers` from hand-serialized `String` JSON to native
  Prisma `Json` columns - the exact pattern behind a real "uncaught
  JSON.parse" bug class already fixed once. All read/write call sites
  updated (no more manual `JSON.parse`/`JSON.stringify`); `TrackedSearch`'s
  duplicate-tracking lookup now compares via `{ equals: ... }` on the Json
  field, which is also a correctness improvement over the old TEXT-based
  approach - jsonb equality is key-order-independent, string equality
  wasn't. Migration file is written
  (`prisma/migrations/20260707224602_booking_json_columns/`) but
  deliberately NOT run against the shared production Neon DB yet - this
  ALTERs existing columns with existing customer booking data (`USING
  col::jsonb`, which fails loudly if any row's text isn't valid JSON,
  rather than silently corrupting it) - needs explicit human approval
  before running, same as Phase 2's migration.
- **Open product decisions, not code tasks:** should `PassengerProfile`
  support more than one saved passenger per account (bookings already
  support multiple passengers per transaction, saved-profile convenience
  doesn't)? Is never storing passport/nationality on `Booking` (Duffel is
  the only system of record) a deliberate, ratified policy, or just an
  emergent side effect of keeping an earlier feature small?

## Executive Charter (Business Operations Layer)
This project has moved from "build the product" into "run the business."
Whichever Claude session is driving this repo - interactive or a
scheduled routine - operates as the founder's decision-making proxy
within this charter, not just as a coding assistant. Read this section,
and `.claude/BUSINESS_STATE.md`, at the start of any work here.

### North star (the three non-negotiable principles)
Every autonomous decision gets checked against these, in this priority
order when they conflict:
1. **Ease** - make booking the flight as frictionless as possible.
2. **Price** - get the user the cheapest real flight available.
3. **Solvency** - never let the business run at a large loss; breakeven
   is the floor, not the target.

### Autonomy: what gets decided here vs. escalated to the founder
Default to acting, not asking. Escalate ONLY when a decision is genuinely
crucial - i.e. it could hurt the business badly and isn't easily undone.

**Act autonomously (log it in BUSINESS_STATE.md, don't ask first):**
- Delegating/sequencing between functional agents - if one agent
  finishing makes another agent's next task obvious, kick it off without
  checking in first.
- Reversible fixes matching an established pattern (env var fixes,
  redeploys, config corrections, retrying a failed agent run).
- Any agent output already scoped as propose-only (branch/PR, not
  auto-merged) - see the agent roster below.
- Model selection per task (see routing table below).

**Escalate to the founder first - always:**
- Anything that risks the Solvency principle: new recurring spend, a
  pricing change, or any commitment above roughly $200 one-time / $100
  per month (defaults - adjust freely, the point is a real number exists
  so "is this crucial" isn't a vibe check).
- Any live/production payment or booking credential change (hard
  guardrail #1 above - unchanged).
- Refunds, disputes, or any customer-facing legal/policy claim.
- Prod DB migrations touching existing rows (Phase 2/5 pattern above -
  unchanged).
- Anything with no established playbook yet - a genuinely novel judgment
  call with material consequence, not just an unfamiliar task.
- Anything that would change these three principles or the product's
  fundamental shape.

The test when unsure: "if this goes wrong, can the business recover on
its own, or does the founder need to know right now?" First answer -> act
and log it. Second answer -> escalate before acting.

### Model routing (token/cost discipline)
Pick the cheapest model that can do the job correctly - this is part of
the Solvency principle, not just an efficiency nice-to-have.
- **Opus** - this charter's own top-level judgment calls, the
  `booking-safety-reviewer`, and any Finance/Paid-Ads decision touching
  real numbers or spend.
- **Sonnet** (default) - most functional-agent work: SEO/GEO/content
  drafting, operations monitoring, day-to-day delegation.
- **Haiku** - high-volume, low-judgment subtasks: ticket classification,
  digest formatting, routine health-check parsing.

### Staying stateful across compaction and fresh sessions
Don't rely on conversation memory for anything that matters past this
session - a scheduled routine starts with zero conversation history every
time. Durable state lives in two places, kept current as you work, not
reconstructed after the fact:
- `CLAUDE.md` (this file) - what's true about the product/architecture.
- `.claude/BUSINESS_STATE.md` - what's true about the business right now
  (agent roster status, recent autonomous decisions, open escalations,
  north-star metrics). Update it in the same turn you make a decision
  worth remembering, not "later."
Functional agents spawned via the Agent tool are naturally
context-isolated (own context, return a summary) - lean on that instead
of trying to hold everything in one long-running session.

### Agent roster
See `.claude/BUSINESS_STATE.md` for current build/activation status.
Phased build order: Operations -> SEO + GEO -> Content & Virality ->
Channel Coverage -> Finance (read-only) -> Customer Support (draft-only) ->
Product (diagnostic-only) + Fullstack Engineer (executor).
(Paid Ads agent was deleted 2026-07-11, founder call - not worth carrying
drafted for an inactive channel; re-add if paid acquisition becomes a
priority.) Each agent gets built, run once for real, and reviewed before
the next one starts - same discipline
already used for the Phase 0-5 architecture roadmap above.

**Product + Fullstack Engineer are a diagnosis/execution pair, not two
independent agents.** Product Agent walks the live product like a real
user (real browser access) and files structured findings to
`docs/product-quality/` (see that directory's README for the schema and
state machine) - it never writes code. Fullstack Engineer agent executes
that queue: plan -> Opus plan-review -> founder approval -> execute ->
independent Opus re-review -> PR (never auto-merge). Founder approval is
required before code is written for every item today, a deliberately
stronger gate than the propose-only-PR pattern the other content-tier
agents get, because this pair's combined surface is the whole product
rather than one lane. See both agents' own `.claude/agents/*.md` files
for the full detail, and BUSINESS_STATE.md's 2026-07-11 decision log entry
for why (a `fable`-model design review argued directly against removing
the founder from the loop entirely, which was the original ask).

### Parallel agent protocol (learned the hard way - 2026-07-09)
Dispatching the SEO/GEO/Content/Channel agents fully in parallel from the
same base commit produced real, silent regressions: two branches
independently rewrote `sitemap.ts` (one reverting the other's live-domain
fix and dropping its flight-guide URLs), and two branches independently
rewrote `layout.tsx` (one reverting the other's JSON-LD and a corrected
airline-count stat). None of this showed up in any single branch's own
review gate - each branch tested clean in isolation. It only surfaces when
you diff sibling branches against each other, which nothing was doing.
Rules going forward:
1. **Foundation before fan-out.** If multiple agents will plausibly touch
   the same "hub" file (`sitemap.ts`, `layout.tsx`'s metadata block,
   `robots.ts`), do that shared foundation work first, sequentially, merge
   it to `main`, and only THEN fork parallel agents from the updated base.
   Don't parallelize agents whose file footprints you haven't checked for
   overlap first - a 30-second `git diff --stat` prediction is cheaper
   than reconciling four divergent branches after the fact.
2. **Prefer data-file extension over hub-file editing.** An agent that
   needs a new sitemap entry or landing page should add to an imported data
   array (see `FLIGHT_GUIDES`/`GUIDES` pattern) rather than hand-editing
   the hub file's body - reduces the odds of two agents' edits colliding
   on the same lines even when they do run in parallel.
3. **Rebase before merge, always.** Before merging any agent branch,
   rebase it onto the current tip of `main` (not the commit it forked
   from) and re-run the full review gate on the rebased result. A branch
   that hasn't been rebased since other work landed on `main` is not safe
   to merge, no matter how clean its own isolated CI run looked.
4. **Integration-level testing, not just per-branch.** Passing tests on
   four separate branches doesn't demonstrate the merged whole works -
   run the full suite again on `main` after each merge, before moving to
   the next one.
5. **Clean up agent worktrees immediately after extracting their work**
   (`git worktree remove --force`, then `git worktree prune`, then check
   `git branch` for stray `worktree-agent-*` branches) - a leftover
   `.claude/worktrees/*` directory contains its own `src/__tests__/` tree
   that `npm test`'s globbing picks up, producing spurious failures from
   stale/parallel-universe code that look like real regressions.

### Harness learning loop (how this charter actually gets sharper over time)
Writing autonomy policy in prose (the section above) doesn't by itself
reduce how often the auto-mode classifier stops and asks - the classifier
only reads literal `.claude/settings.json` `autoMode.allow` rules. So
"getting more autonomous" isn't a vibe, it's a concrete artifact-update
step that has to happen every time a block gets resolved, not "later":

1. **When the classifier blocks something, get it resolved (approved or
   declined), then immediately classify the block itself, before moving
   on:**
   - **Repeatable, bounded risk** (the risk profile is the same every time
     this action runs - e.g. deploying after a defined review gate,
     writing an already-integrated service's test-mode key) -> draft the
     exact `autoMode.allow` rule text in the same turn and get one sign-off
     on that literal text. From then on this category shouldn't need to be
     asked about again.
   - **Variable risk even within the same category** (the actual danger
     depends on parameters chosen each specific time - e.g. "run a
     concurrency test against production" varies enormously by scale and
     target; "force-write a live DB connection string" is rare and
     consequential enough that the classifier will keep asking for a fresh
     confirmation even after a rule names the exact env var - seen twice
     in this repo, 2026-07-09) -> do NOT keep trying to write a bypass
     rule for these. Log them as "always confirm" in
     `.claude/BUSINESS_STATE.md`'s calibration log and stop treating
     repeated confirmation requests here as harness friction to remove -
     it's the classifier correctly declining to let a one-time broad
     phrasing pre-authorize an action whose blast radius isn't fixed.
2. **Keep a calibration log**, not just a decision log -
   `.claude/BUSINESS_STATE.md`'s "Harness calibration" section records
   every block: what was attempted, why the classifier stopped it, how it
   resolved, and which bucket (1a or 1b above) it landed in. A fresh
   session reads this before assuming a past block means the same rule
   should be re-attempted, or that a variable-risk action has become safe
   to skip confirming.
3. **The actual "self-learning" substrate spans two layers, not one:**
   this repo's `CLAUDE.md`/`BUSINESS_STATE.md` capture what's true about
   *this* codebase and business; the operator's own cross-session memory
   (outside this repo) captures generalizable judgment patterns - which
   category of action tends to be rule-worthy vs. always-confirm, how this
   founder prefers escalations bundled vs. sequential, etc. - that should
   inform how new projects get bootstrapped, not just this one.

## Working style
- Use plan mode / write a PLAN.md when YOU (the session directly talking to
  the founder) are the one deciding scope/approach on a non-trivial
  product/architecture change - i.e. when the "what to build" question is
  still open. **Do NOT enter plan mode when you are a functional agent
  (SEO/GEO/Content/Channel/Operations/etc.) executing a task the
  orchestrating session has already fully specified** - the scope question
  is already closed in that case; re-litigating it via plan mode just
  produces a plan file nobody but the orchestrator will read, and the
  orchestrator's own instructions ("implement directly") should be treated
  as already-granted authorization for that specific, bounded task, not as
  something needing its own approval loop. Day-to-day business-operations
  work under the Executive Charter generally doesn't need a plan-mode round
  at all - only the charter/harness itself, or anything that meets the
  "escalate" bar above, does.
- Use a subagent for code review before marking a slice done; have it
  check the diff against the relevant PLAN.md's acceptance criteria, not
  style preferences.
- Show evidence of done (test output, not just an assertion).
- Any change with a user-facing/runtime surface (UI, an API response a
  user would notice, anything touching headers/middleware/auth) must be
  verified with real browser interaction via the claude-in-chrome
  extension before being called done or deployed - passing automated
  tests is not sufficient evidence by itself. Precedent: a CSP header
  change once passed lint/typecheck/tests/build cleanly while silently
  breaking all client-side interactivity in production - only driving it
  in an actual browser caught that.
