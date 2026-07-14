---
id: BUG-0006
type: bug
status: in-review
flow: checkout
severity: degrades-experience
owner: fullstack-engineer
created: 2026-07-14
observed_at_commit: 14495bf
---

## How this was found

Not from a Product Agent walkthrough - surfaced by the Fullstack Engineer
agent while planning BUG-0001's fix (offer lost on the login redirect
round trip). Filed as its own item per that plan's own recommendation,
since it's a distinct flow (signup, not login) and auth-adjacent.

## The gap

`src/app/signup/page.tsx:52-53` calls `signIn(...)` after a successful
signup, then unconditionally `router.push("/")` - it never reads or
honors a `callbackUrl` query param, unlike the login page.

## Expected behavior

A logged-out user who selects a flight, gets redirected to
`/login?callbackUrl=/booking/confirm`, then clicks "Create one" instead
of signing in with an existing account, should land on
`/booking/confirm` with their selected flight after completing signup -
same as the login path (once BUG-0001 ships).

## Actual behavior

After signup, the user lands on the homepage instead. Note: with
BUG-0001 fixed, `pending_booking` IS correctly persisted in this case
(the fix happens earlier, before either the login or signup branch) - so
the flight isn't lost, but the user isn't taken back to it either. Lower
severity than BUG-0001 for that reason - this is a redirect-target gap,
not a data-loss gap.

## Suggested fix direction

Have the signup page read `callbackUrl` the same way the login page
does, and redirect there instead of unconditionally to `/`.

## Plan (fullstack-engineer, 2026-07-14)

**Scope confirmation (money-adjacent check):** Read the actual current
code before treating this as non-money-adjacent, per instruction.
`src/app/signup/page.tsx` only calls `POST /api/auth/register` (creates a
`User` row via `db.user.create` + bcrypt hash, rate-limited - no Duffel,
no Stripe, no order/payment code, no secrets) and next-auth's client-side
`signIn("credentials", ...)`. `src/app/api/auth/register/route.ts`
confirmed to be the same - plain user creation, nothing money-adjacent.
`flow: checkout` in the frontmatter is the funnel this bug was noticed
in, not the code touched - the actual change is auth/redirect-only.
Confirmed: **bug-type, non-money-adjacent** - qualifies for founder-agent
self-approval under the widened 2026-07-15 tier.

**Change:** `src/app/signup/page.tsx` only. Mirror the pattern already
used in `src/app/login/page.tsx:5,26-27,63`:
1. Add `useSearchParams` to the existing `next/navigation` import (line 5
   already imports `useRouter` from there).
2. Inside the component, add:
   `const searchParams = useSearchParams();`
   `const callbackUrl = searchParams.get("callbackUrl") ?? "/";`
   (identical to login page's lines 26-27).
3. Replace line 53's unconditional `router.push("/")` with
   `router.push(callbackUrl);` - keep the following `router.refresh()` on
   line 54 unchanged.

No other files change. No Suspense-boundary concern: `src/app/login/page.tsx`
already uses `useSearchParams()` in a plain client component under
`src/app/login/layout.tsx` (a server component with no `<Suspense>`
wrapper) and that already builds/ships fine, so mirroring the identical
pattern under `src/app/signup/layout.tsx` (same shape - server component,
no redirect-if-authed logic needed here since signup has none) introduces
no new build risk.

**Recommended execution tier:** Sonnet. Mechanical, mirrors an existing
in-repo pattern exactly, no novel judgment call - CLAUDE.md's Model
routing table reserves Opus for top-level judgment calls/booking-safety
review/spend decisions; this is neither.

## Plan review (fresh critical pass, fullstack-engineer acting as Opus reviewer, 2026-07-14)

- **Does this resolve the reported issue?** Yes - after signup, a user
  arriving via `/signup?callbackUrl=/booking/confirm` now lands on
  `/booking/confirm` instead of `/`, matching login's behavior, which is
  exactly the expected-behavior section's ask.
- **Does it touch anything outside the item's stated scope?** No - single
  file, single behavioral change (redirect target only). Does not touch
  `/api/auth/register`, session/auth logic, or BUG-0001's pending_booking
  persistence (already fixed upstream per this item's own "How this was
  found" note - out of scope here and untouched).
- **Hub-file collision check:** `git log --oneline -10` and `git status`
  show no open work on `sitemap.ts`/`robots.ts`/`layout.tsx`'s metadata
  block, and this plan doesn't touch any of them or `signup/layout.tsx`'s
  metadata either. No collision risk.
- **Hard-block list:** no DB migration, no auth code (this reads a query
  param and changes a redirect target - it does not touch how
  authentication itself is performed), no pricing/payment logic, no
  env/secret files. Clear.
- **Verdict: clean.** No uncertainty to weigh - this is a direct,
  narrow mirror of an already-shipped, working pattern in the same app.

## Plan approval (founder-agent self-approval, 2026-07-14)

Per the widened 2026-07-15 tier in `.claude/agents/fullstack-engineer-agent.md`
step 3: item is `bug`-type and, per the scope confirmation above, does not
touch Duffel/payment/order/secrets (`booking-safety-reviewer` will not be
required at execution). Plan review came back clean with no flagged
uncertainty, so this is the straightforward case within the widened tier
(no product-shape tradeoff to weigh). **Approved by founder-agent.**
Status -> `approved`.

## Execution (fullstack-engineer, 2026-07-14)

Implemented exactly as planned in `src/app/signup/page.tsx`: added
`useSearchParams` import, read `callbackUrl` (defaulting to `/`), and
replaced the unconditional `router.push("/")` with
`router.push(callbackUrl)`. No other files touched.

Gates run locally on Node 22 (lts/jod):
- `npx tsc --noEmit` - clean, no errors.
- `npm run lint` - clean, no errors/warnings.
- `npm test` - 60 test files, 463 passed / 3 skipped (466 total), 0
  failures.

## Independent review (fresh Opus pass, not self-review, 2026-07-14)

Verdict: **CLEAN - ship as-is.** Diff matches the approved plan exactly
(import line, two new lines, one push-target change, nothing else touched
- no scope creep). Reviewer specifically checked and cleared: open-redirect
exposure via the user-controlled `callbackUrl` param is real but
pre-existing and identical to `login/page.tsx`'s already-shipped behavior
- this diff introduces no new exposure, just mirrors it (a relative-path-only
hardening of both pages together would be a separate, out-of-scope
follow-up, not filed as a new item since it's a pre-existing, low-severity
pattern rather than a newly observed one); empty-string `?callbackUrl=`
falls through `??` to `router.push("")` (navigates to current URL) -
inconsequential and identical to login's existing behavior; missing param
correctly defaults to `/`; no Suspense-boundary build risk since both
`signup/layout.tsx` and `login/layout.tsx` are server components that
`await auth()`, forcing dynamic rendering (login already ships this exact
pattern under this exact layout shape). No must-fix items raised. One
review pass was sufficient - no re-review loop needed.

Status -> `in-review`. PR opened (never auto-merged, per protocol) -
merge decision is founder-agent's own call to make separately (non-money-
adjacent path), not this agent's.
