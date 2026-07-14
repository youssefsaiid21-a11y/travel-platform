---
id: BUG-0001
type: bug
status: in-progress
flow: checkout
severity: blocks-booking
owner: fullstack-engineer
created: 2026-07-13
observed_at_commit: 23c8392
---

## Repro steps

1. As a **logged-out** visitor, search any flight on the homepage (e.g.
   "London to Berlin next Tuesday") through to the offers list.
2. Click "Select" on any offer.
3. You're correctly redirected to `/login?callbackUrl=/booking/confirm`
   (this part works).
4. Sign in with a valid account (verified with the seeded
   `product-agent-test@orbi.local` account).
5. You're redirected back to `/booking/confirm`. It briefly shows
   "Loading your booking..." then silently navigates to `/` (homepage).

## Expected behavior

After signing in via the `callbackUrl` round trip, the user should land
on the booking confirmation page for the flight they selected, exactly as
happens when a user who is *already* logged in selects an offer (verified
working correctly in that case - see below).

## Actual behavior

The selected offer is silently discarded. The user is bounced back to the
homepage with zero explanation and must redo their entire search from
scratch. For a chat-based search product where most first-time visitors
are not yet signed in when they find a flight they like, this is likely
the single most damaging point of drop-off in the whole funnel - it
affects the *default* path for a new user, not an edge case.

## Root cause (confirmed by reading the code)

`src/app/page.tsx:847-857`:

```tsx
function handleSelectOffer(offer: NormalizedOffer, searchParams?: SearchParams | null) {
  if (!session?.user) {
    router.push("/login?callbackUrl=/booking/confirm");
    return;                     // <-- returns BEFORE ever writing to localStorage
  }
  localStorage.setItem(
    "pending_booking",
    JSON.stringify({ offer, searchParams: searchParams ?? {} })
  );
  router.push("/booking/confirm");
}
```

When the user is logged out, the function redirects to `/login` and
`return`s immediately - the `localStorage.setItem("pending_booking", ...)`
call only happens in the already-authenticated branch below it, which
never executes on this path. So the offer is never persisted anywhere
before the login redirect.

`src/app/booking/confirm/page.tsx:117-122` then reads `pending_booking`
from `localStorage` on mount:

```tsx
const [pending] = useState<PendingBooking | null>(() => {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem("pending_booking");
  if (!raw) return null;
  try { return JSON.parse(raw) as PendingBooking; } catch { return null; }
});
```

...finds nothing (correctly - nothing was ever written), and the guard at
`confirm/page.tsx:164-168` fires:

```tsx
useEffect(() => {
  if (!pending) {
    router.push("/");
    return;
  }
  ...
```

`localStorage` itself would have survived the full-page `/login` round
trip fine (same-origin, persistent) - the bug is entirely in the write
path never running, not in storage persistence.

## Evidence

- Network log across the repro: `offer_selected` event fires, then
  `/login?callbackUrl=/booking/confirm` loads, `/api/auth/callback/credentials`
  returns 200, `/booking/confirm` loads (fetches `/api/profile/passenger`
  successfully, loads the `StripeCheckout` chunk), then a subsequent
  `/?_rsc=...` request shows the client-side redirect to `/`.
- Isolating check: repeated the same select-offer flow while **already
  logged in** (no login round trip) - `/booking/confirm` rendered
  correctly with full flight details, price breakdown, and passenger
  form. This confirms the bug is specific to the login-redirect path, not
  a general `pending_booking` problem.

## Suggested fix direction

Write to `localStorage` (or otherwise persist the offer, e.g. a query
param / server-side pending-booking record) *before* redirecting to
`/login` in the `!session?.user` branch, not only in the
already-authenticated branch.

---

## Implementation plan (Fullstack Engineer, 2026-07-14)

### Critical context established by reading the actual code

- **`handleSelectOffer` (`src/app/page.tsx:847-857`) is the single choke
  point.** It is the only offer-select path that reaches `/booking/confirm`
  (wired at `page.tsx:694` -> `OfferCard`'s `onSelect`, the only caller).
  So the fix is one function in one file. No component or type changes.
- **`localStorage` genuinely survives the round trip in this app — verified,
  not assumed.** The login flow is entirely client-side SPA navigation:
  logged-out select does `router.push("/login?callbackUrl=/booking/confirm")`
  (client nav, no full document load); `login/page.tsx` calls
  `signIn("credentials", { redirect: false })` then `router.push(callbackUrl)`
  (again client nav, `redirect: false` means NextAuth does **no** server
  redirect). The entire home -> /login -> /booking/confirm sequence happens
  within one document lifetime in the common case, and `localStorage` (per
  origin, persistent) also survives a hard reload of `/login` if the user
  refreshes/bookmarks it. `localStorage` is therefore the correct and robust
  mechanism — strictly more than the round trip requires. A query-param or
  server-side pending-booking record would be more machinery for zero
  benefit here, and the entire read side already assumes `localStorage`.
- **The read side already works and needs no change.** `confirm/page.tsx:117`
  reads `pending_booking` from `localStorage` in a lazy initializer, with a
  `try/catch` around `JSON.parse` (corrupt value -> `null`, not a throw). The
  `!pending -> router.push("/")` guard (`confirm/page.tsx:164`) is exactly
  what fires today because nothing was written; once we write, `pending` is
  populated and the page renders normally. This confirms the bug is purely
  the missing write, matching the report.
- **Expired / stale offers are already handled downstream — this fix must
  not re-implement that.** `confirm/page.tsx` runs `useOfferExpiry(offer.
  expires_at)`: an expired persisted offer renders the "This price has
  expired / Search again" bar and `canProceed` is gated on `!expiry.expired`,
  so the Pay button is disabled. Server-side, BUG-0005 (open) adds a
  pre-charge `expires_at` guard in the payment-intent route and BUG-0002
  (merged) added a pre-order guard. So a stale `pending_booking` cannot lead
  to charging/booking a dead offer. **Consistency with that work means NOT
  adding a separate TTL/staleness wrapper here** — the offer's own
  `expires_at` is already the staleness signal and is already checked in
  three places. Adding a second, redundant expiry concept would be
  scope-creep and could drift out of sync with the real one.
- **Storage-throw is already handled at the call site.** `OfferCard.tsx:628-649`
  wraps the whole `onSelect(offer)` call in `try/catch` specifically for the
  case where the `localStorage` write throws (e.g. old-iOS Safari private
  mode): it logs and resets the button's `selecting` state so it isn't stuck.
  So no new try/catch is needed inside `handleSelectOffer` — a throw is
  already caught one level up. The authenticated branch already relies on
  exactly this.

### The fix

Hoist the existing `localStorage.setItem("pending_booking", ...)` write so
it runs on **both** branches — before the auth check — instead of only in
the already-authenticated branch. This is the minimal change that makes the
logged-out path behave identically to the already-working authenticated path
(the report confirms the authenticated path works correctly).

`src/app/page.tsx`, `handleSelectOffer`, from:

```tsx
function handleSelectOffer(offer, searchParams?) {
  if (!session?.user) {
    router.push("/login?callbackUrl=/booking/confirm");
    return;
  }
  localStorage.setItem("pending_booking",
    JSON.stringify({ offer, searchParams: searchParams ?? {} }));
  router.push("/booking/confirm");
}
```

to:

```tsx
function handleSelectOffer(offer, searchParams?) {
  // Persist the selected offer BEFORE any redirect so it survives the
  // logged-out -> /login -> /booking/confirm round trip (BUG-0001). The
  // callbackUrl brings the user back to /booking/confirm, which reads this.
  localStorage.setItem("pending_booking",
    JSON.stringify({ offer, searchParams: searchParams ?? {} }));
  if (!session?.user) {
    router.push("/login?callbackUrl=/booking/confirm");
    return;
  }
  router.push("/booking/confirm");
}
```

Identical payload, identical storage key — the only change is *when* the
write happens. This is deliberately smaller than the report's broadest
suggestion (query-param / server-side record): those are unnecessary given
the verified client-side-nav architecture above.

### Scope: `src/app/page.tsx` only (one function). No change to
`confirm/page.tsx` (read side already correct), no component/type change, no
migration, no auth code, no pricing/payment code, no shared hub files.

### Edge cases considered (and why each needs no extra code here)

- **User closes the tab and returns later.** `pending_booking` persists.
  When they eventually reach `/booking/confirm`, an expired offer is caught
  by the existing `useOfferExpiry` render guard + the BUG-0002/0005 server
  guards. No new TTL needed (see context above).
- **Login fails / user cancels / abandons.** `pending_booking` lingers
  harmlessly: it is overwritten on the next offer selection, is only read
  when the user actually lands on `/booking/confirm`, and is expiry-guarded
  there. Cleanup already only happens on a *successful* booking
  (`confirm/page.tsx:330-333` `handleSuccess` -> `removeItem`). The
  authenticated branch already writes-then-cleans-only-on-success; this fix
  is consistent with that shipped behavior, so no new cleanup path is
  warranted. (Adding speculative cancel-time cleanup would be its own
  behavior change and is out of scope.)
- **`localStorage.setItem` throws (quota / old-iOS private mode).** Already
  caught by `OfferCard.tsx`'s `try/catch` around `onSelect`, which resets the
  button. Behavior change vs. today on this rare path: a logged-out
  private-mode user previously still got redirected to `/login` (then lost
  the offer anyway — the bug); now they stay on the offers list with the
  button reset. That is not worse (it avoids a doomed round trip) and is
  identical to what the authenticated branch already does. No action needed.
- **`searchParams ?? {}` fallback.** Unchanged from today; on the real path
  `handleSelectOffer` is always called with `msg.searchParams` (`page.tsx:694`).
  Not introduced or altered by this fix.

### Discovered adjacent gap (NOT fixed here — route as its own item)

`src/app/signup/page.tsx:52-53` calls `signIn(...)` then `router.push("/")`,
ignoring any `callbackUrl`. So a logged-out user who clicks "Create one" on
the login page (instead of signing in) and completes signup lands on the
homepage, not `/booking/confirm` — the persisted offer is correct but the
redirect target is lost. This is a *distinct* flow from BUG-0001 (which is
specifically the login round trip) and fixing it means touching signup's
redirect (auth-adjacent). Flagging for the founder-agent to file as a new
item rather than scope-creeping it in.

### Order of execution
1. Hoist the `setItem` above the auth check in `handleSelectOffer`.
2. `npx tsc --noEmit && npm run lint && npm test`.
3. Browser-verify the actual repro (charter requires real-browser verification
   for user-facing/runtime changes): logged-out -> search -> Select -> land on
   `/login?callbackUrl=/booking/confirm` -> sign in with
   `product-agent-test@orbi.local` -> confirm you land on `/booking/confirm`
   with the selected flight rendered (not bounced to `/`). Also re-verify the
   already-logged-in path still works (regression guard).

### Recommended execution tier: **Sonnet**
Per CLAUDE.md "Model routing": Opus is reserved for top-level judgment calls,
`booking-safety-reviewer`, and Finance money decisions — not for a
fully-specified one-statement client-side diff. The judgment is all resolved
here (exact change, placement, edge-case reasoning). This is *lower* risk than
BUG-0002 (which was also Sonnet): no money/order/secret code, no
`booking-safety-reviewer` gate. Haiku could mechanically perform the hoist,
but the required real-browser verification of both the fix path and the
authenticated regression path, plus not breaking the OfferCard throw-handling
contract, justifies Sonnet over Haiku. The charter's independent Opus
re-review loop (step 5) still applies as the safety net.

### Hard-constraint / collision check
- DB migrations: **not touched.**
- Auth code: **not touched** — redirects to `/login` with the existing
  `callbackUrl` (unchanged); does not modify NextAuth config, `signIn`, or any
  auth logic. (The redirect *string* already exists in the current code.)
- Pricing / payment / Duffel-order / secrets: **not touched** — this is
  client-side offer-selection state + a client redirect. `handleSelectOffer`
  contains no Duffel/Stripe/env access; it only writes a `localStorage` key
  and calls `router.push`.
- Shared hub files (`sitemap.ts` / `robots.ts` / `layout.tsx` metadata):
  **not touched.**
- Collision: BUG-0002 (PR #6, merged to `main`) touched only
  `api/booking/route.ts` + its test — zero overlap with `page.tsx` /
  `confirm/page.tsx`. Stale branches `track-a..d` carry no open PR; `ui-rehaul`
  was diffed against `main` and does **not** touch `handleSelectOffer` /
  `pending_booking` / `callbackUrl` in `page.tsx`. Low collision risk.
  Rebase-onto-`main` + full suite before any eventual merge still required
  (Parallel Agent Protocol).

### booking-safety-reviewer requirement: **NOT required.**
Verified against the actual `handleSelectOffer` body, not just the report's
framing: the diff touches no Duffel order-creation code, no Stripe/payment
code, no order/booking API route, and no secrets/env. It is client-side
persistence of an already-fetched offer object plus a client redirect — the
"money moves" boundary (`POST /api/booking` / `POST /api/stripe/payment-intent`)
is nowhere near this change. The standard independent Opus re-review (step 5)
still applies; the money-code reviewer does not.

### Founder decision required before approval: **none of substance.**
Unlike BUG-0002 (which carried a genuine refund-policy product decision), this
is a pure correctness bug with one obvious, minimal fix and no open
product-shape question. The only founder input needed is the charter's routine
step-3 plan sign-off, which every item requires. (The one judgment call —
"add a staleness TTL to `pending_booking`?" — is resolved as *no* on
engineering grounds above, because the offer's own `expires_at` is already the
staleness signal and is already checked; that is not a product-shape decision.)

---

## Plan review (fresh critical Opus pass, 2026-07-14)

Verdict: **APPROVE — no open founder product decision; ready for the routine
step-3 sign-off.** A genuinely separate critical re-read against the four
questions the charter requires:

**Does it actually resolve the reported issue?** Yes, completely. The report's
root cause is exact and confirmed by re-reading the code: the `setItem` only
runs in the authenticated branch, so the logged-out path persists nothing and
`confirm/page.tsx`'s `!pending` guard bounces to `/`. Hoisting the identical
write above the auth check makes the logged-out path write the same payload
the authenticated (working) path already writes — the read side, expiry
handling, and cleanup are all unchanged and already correct. The claim that
`localStorage` survives the round trip is not taken on faith: the plan traces
the actual client-side-nav flow (`redirect: false` + `router.push`) and notes
it survives even a hard reload. This directly fixes the single highest-drop-off
path with the smallest possible diff.

**Does it stay in scope?** Yes — one statement moved in one function in one
file. It explicitly *declines* the report's heavier suggestions (query-param /
server-side record) with a verified reason, declines a redundant TTL with a
reason, and routes the genuinely separate signup-`callbackUrl` gap to a new
item instead of absorbing it. That is correct scope discipline, not evasion.

**Does it touch the hard-block list?** No. Verified against the function body,
not the report's framing (as step 6 demands): no migration, no auth logic (the
`callbackUrl` redirect string is pre-existing and unchanged), no
pricing/payment/Duffel-order code, no secrets, no shared hub files. Correctly
concludes `booking-safety-reviewer` is not required — the money boundary is
`POST /api/booking` / payment-intent, which this change never approaches.

**Collisions?** Confirmed low. BUG-0002's merged diff is `route.ts` + test
only; `ui-rehaul` was actually diffed and does not touch this handler; no open
PR contends for `page.tsx`. Rebase-before-merge still mandated.

**Points flagged for the implementer (execution notes, not blockers):**
- Preserve `OfferCard.tsx`'s `try/catch`-around-`onSelect` contract — do not
  add a swallowing `try/catch` inside `handleSelectOffer` that would hide a
  storage throw from the button-reset handler. The plan already says this.
- The real-browser verification (step 3 of execution) is mandatory here per
  CLAUDE.md's user-facing-change rule — automated tests alone are insufficient
  evidence for this fix. Verify *both* the logged-out fix path and the
  already-logged-in regression path.

The plan's shape is unchanged by these notes. Approved to proceed to founder
sign-off (step 3), which is out of this session's scope. Execution tier
(**Sonnet**) and the no-`booking-safety-reviewer` determination are both
endorsed.

---

## Plan approval (founder-agent tier, 2026-07-14)

Approved directly under the new two-tier rule in `fullstack-engineer-agent.md`
step 3: this item qualifies on all three conditions - `bug`-type, plan review
came back clean (APPROVE, no flagged uncertainty), and confirmed (not
assumed) to touch no Duffel/payment/order/secret code, so
`booking-safety-reviewer` will not be required at execution. First item
approved under this tier, immediately following BUG-0002's clean run through
the full human-gated loop. Status moved to `approved`.
