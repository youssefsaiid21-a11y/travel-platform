---
id: BUG-0002
type: bug
status: in-review
flow: payment
severity: blocks-booking
owner: fullstack-engineer
created: 2026-07-13
observed_at_commit: 23c8392
---

## Repro steps

1. As a logged-in user (used the seeded `product-agent-test@orbi.local`
   account), search a flight, select an offer, fill in passenger details,
   and reach the Stripe payment step on `/booking/confirm`.
2. Verified layer-2 test-mode safety first: the mounted `StripeCheckout`
   chunk's actual bundled key
   (`static/chunks/src_components_14112tp._.js`) is
   `pk_test_51TrCaP7hFK7WqcygSrJj4pMe9pTZGHn2rAg7x99neBPl2icnFOPXevuAKwYhHzhgXnO4f3oTjirVXjJikCee3mVG00HpdwCK7R`
   - matches `.env.local`'s configured test key exactly, no `pk_live_`
   anywhere.
3. Entered the standard Stripe test card `4242 4242 4242 4242`, any future
   expiry (12/30), any CVC (123), any postal code, clicked "Confirm and
   pay €68.12".
4. Payment processed successfully (real Stripe test-mode PaymentIntent
   `pi_3TshJt7hFK7Wqcyg01x1fgyY`). Page then showed:

   > "Booking could not be completed - your payment was charged. Contact
   > support with reference below."

## Expected behavior

A successful Stripe payment should reliably result in a confirmed Duffel
order (or, if the order genuinely can't be created, the payment should
not have been captured / should be refunded automatically, and the
failure reason should be diagnosable).

## Actual behavior

The card was charged and the Duffel order was never created. Confirmed
directly in the DB (`Booking` row for this attempt):

```json
{
  "id": "cmrj3k39u00031s3uk3p8moge",
  "status": "failed",
  "duffelOrderId": null,
  "stripePaymentIntentId": "pi_3TshJt7hFK7Wqcyg01x1fgyY",
  ...
}
```

This is the single worst failure mode a booking flow can have: money
moves, no flight is booked, and the user is told to "contact support"
with no further diagnostic info than a raw booking ID.

## Root cause (confirmed by reading the code)

`src/app/api/booking/route.ts:250-252` - the Duffel order-creation call
is wrapped in a catch block that swallows the error entirely:

```ts
} catch (err) {
  console.error("Duffel order creation failed:", err);
}
```

`status` is pre-initialized to `"failed"` and only overwritten to
`"confirmed"` on success, so *any* thrown error of *any* kind falls
through silently to `db.booking.update(...)` with `status: "failed"`,
`duffelOrderId: null`. The route then unconditionally returns HTTP 201
regardless of whether the order actually succeeded (confirmed via
network log: `POST /api/booking` -> `201`) - the 201 just means "we
finished processing and wrote a row," not "the booking succeeded."

Two compounding gaps:
1. **No error tracking**: only `console.error`, nothing durable. There is
   no `Sentry.captureException` here (Sentry is wired globally via
   `instrumentation.ts`'s `onRequestError`, but that only fires for
   *uncaught* errors - this one is caught, so Sentry never sees it). The
   real Duffel error (a `DuffelError` with `.response.errors[0]` details,
   per `src/lib/duffel/client.ts:44-52`) exists only in ephemeral
   `console.error` output with no durable, queryable record of *why*
   order creation failed for this specific booking.
2. **No offer-expiry check before charging**: `getOfferWithServices(offerId)`
   (`src/lib/duffel/search.ts:191-198`) re-fetches the offer and
   re-verifies price, but never checks `offer.expires_at` against the
   current time before attempting order creation. The project's own
   Duffel skill doc explicitly flags this:
   `.claude/skills/duffel-api/SKILL.md:103` -
   `"expires_at: ISO 8601 // offers expire - check before booking"`.
   There is no such check anywhere in the booking route, so a
   plausible (though not confirmed for this specific instance) cause is
   simply an expired sandbox offer reaching `POST /air/orders` after
   payment was already captured.

## Evidence

- `POST /api/booking` -> `201` (network log), yet DB row shows
  `status: "failed"`, `duffelOrderId: null`.
- `stripePaymentIntentId: "pi_3TshJt7hFK7Wqcyg01x1fgyY"` present and real
  - the payment genuinely succeeded.
- Could not retrieve the underlying Duffel error text itself: the dev
  server process was already running before this session started (not
  launched by this agent), and there is no durable log file or
  Sentry record for this failure - only a `console.error` that would have
  gone to that process's own stdout, which isn't accessible after the
  fact. This is itself part of the finding (see gap #1 above).

## Suggested fix direction

1. Check `offer.expires_at` before charging the card (or immediately
   before order creation, aborting/refunding if expired).
2. Persist the actual Duffel error (`err.response`/`err.status`) onto the
   failed `Booking` row so a real reason is queryable later, not just
   discarded.
3. Add `Sentry.captureException(err)` in the catch block so this failure
   mode is actually alertable instead of living only in ephemeral stdout.

---

## Implementation plan (Fullstack Engineer, 2026-07-13)

### Critical context established by reading the actual code

- **The card is already charged before `POST /api/booking` ever runs.**
  The confirm page (`src/app/booking/confirm/page.tsx`) creates the
  PaymentIntent via `/api/stripe/payment-intent`, then the mounted
  `StripeCheckout` component confirms it client-side (the actual charge).
  Only *after* the charge succeeds does the client call `POST /api/booking`
  with the already-succeeded `paymentIntentId`, which the route re-verifies
  as `status === "succeeded"` (route.ts:76). **There is therefore no
  "before charging" point inside `route.ts`.** The only feasible expiry
  check in this route is post-charge, immediately before the Duffel order
  call — which is exactly the fallback the item's fix-direction #1 allows
  ("...or immediately before order creation, aborting/refunding if
  expired"). This plan takes that path.
- `NormalizedOffer.expires_at` is already a populated, required `string`
  (`src/lib/duffel/types.ts:38`, set in `normalizeOffer` at
  `search.ts:114`), so the object returned by `getOfferWithServices`
  already carries `expires_at`. **No type change, no normalizer change, no
  change to `search.ts` is needed** — the expiry check is a pure addition
  inside `route.ts`.
- `Booking.offerSnapshot` is already a Prisma `Json` column
  (`schema.prisma`), and the route already stashes a diagnostic `reason`
  into it on the offer-verification-failure path (route.ts:163-166). So the
  Duffel error can be persisted **without any new column and without any
  migration** — reusing the same established pattern. (This deliberately
  avoids the migrations hard-block, and avoids entangling with the Phase 5
  `offerSnapshot` String→Json migration that is written but not yet applied
  to prod.)
- Sentry is imported in the codebase as `import * as Sentry from
  "@sentry/nextjs"` and called as `Sentry.captureException(...)` in
  `src/app/error.tsx` and `src/app/global-error.tsx`. No API route calls it
  directly today; the global `onRequestError` hook only fires for
  *uncaught* errors, so a caught error here needs an explicit call. This
  plan matches the existing import/call pattern.

### Scope: `src/app/api/booking/route.ts` only. No other file changes
(besides the test file). No migration, no auth, no pricing logic, no shared
hub files.

### Change 1 — Sentry import
Add at the top of `route.ts`:
`import * as Sentry from "@sentry/nextjs";` (matches error-boundary
pattern).

### Change 2 — Offer-expiry guard (post-charge, pre-order)
Insert a new block **after** the amount-mismatch check (currently
route.ts:181-199) and **before** `let duffelOrderId` (route.ts:201).
Logic:

```
if (new Date(offer.expires_at).getTime() <= Date.now()) {
  const failedBooking = await db.booking.update({
    where: { id: booking.id },
    data: {
      status: "failed",
      totalAmount: centsToAmountString(expectedCents),
      totalCurrency: offer.total_currency,
      offerSnapshot: {
        ...(offer as unknown as Record<string, unknown>),
        failureReason: { reason: "offer_expired", expires_at: offer.expires_at },
      } as unknown as Prisma.InputJsonValue,
    },
  });
  Sentry.captureException(
    new Error("Offer expired before Duffel order creation"),
    { tags: { route: "api/booking", failureMode: "offer_expired" },
      extra: { bookingId: booking.id, offerId, stripePaymentIntentId, expires_at: offer.expires_at } }
  );
  return NextResponse.json(
    { error: "This price expired before we could confirm your booking. You have NOT been booked; the charge will be refunded. Reference: " + booking.id,
      booking: failedBooking },
    { status: 410 }
  );
}
```

Rationale: this mirrors the existing amount-mismatch early-return block
exactly (its own `db.booking.update` → non-201 return), so it's a
consistent, minimal, revertable addition. It short-circuits a *doomed*
Duffel order attempt (an expired offer would be rejected by
`POST /air/orders` anyway) into a **labeled, diagnosable** failure with a
distinct `410 Gone` status, instead of a generic swallowed error. It does
**not** move money (see the flagged refund decision below).

### Change 3 — Persist the Duffel error + Sentry in the existing catch
Replace the swallowing catch (route.ts:250-252) so the real error is
captured into a variable, sent to Sentry, and threaded into the final
`db.booking.update`. Introduce `let failureReason: Prisma.InputJsonValue |
null = null;` alongside the existing `duffelOrderId`/`status` vars, then:

```
} catch (err) {
  console.error("Duffel order creation failed:", err);
  const detail =
    err instanceof DuffelError
      ? { reason: "duffel_order_failed", status: err.status, errors: err.response.errors }
      : { reason: "duffel_order_failed", message: err instanceof Error ? err.message : String(err) };
  failureReason = detail as Prisma.InputJsonValue;
  Sentry.captureException(err, {
    tags: { route: "api/booking", failureMode: "duffel_order_creation" },
    extra: { bookingId: booking.id, offerId, stripePaymentIntentId,
             duffelStatus: err instanceof DuffelError ? err.status : undefined },
  });
}
```

Then in the existing final `db.booking.update` (route.ts:254-269), change
the `offerSnapshot` value to merge in the failure reason when present:

```
offerSnapshot: (failureReason
  ? { ...(offer as unknown as Record<string, unknown>), failureReason }
  : (offer as unknown as Record<string, unknown>)) as unknown as Prisma.InputJsonValue,
```

On success `failureReason` is null, so the snapshot is unchanged from
today's behavior. On failure the actual Duffel error text/status is now
durably queryable on the row. The route still returns 201 on the failure
path (unchanged) — the client already renders the "contact support" state
off `booking.status === "failed"`; changing the HTTP status of that path is
out of scope for this item and would be a separate behavior change.

### Change 4 — Tests (`src/__tests__/api/booking.test.ts`) — REQUIRED
Guardrail #4 (money-touching code needs passing tests). Add:
1. **Expired offer** → mock `getOfferWithServices` to return an offer with
   `expires_at` in the past; assert response is `410`, booking row is
   `status: "failed"` with `offerSnapshot.failureReason.reason ===
   "offer_expired"`, and **`POST /air/orders` was never called** (assert
   against `requestLog` / the duffel mock).
2. **Duffel order throws `DuffelError`** → assert booking row is
   `status: "failed"`, `offerSnapshot.failureReason` carries the Duffel
   `status` and `errors`, and `@sentry/nextjs`'s `captureException` (mocked)
   was called once. Assert the existing success path still writes a clean
   `offerSnapshot` with no `failureReason` key (regression guard).
Run `npm test` + `npx tsc --noEmit` + `npm run lint` before done.

### Order of execution
1. Add Sentry import. 2. Add expiry guard block. 3. Rework catch +
threaded `failureReason` into final update. 4. Add/adjust tests. 5. Full
gate (`npm test && npx tsc --noEmit && npm run lint`).

### Recommended execution tier: **Sonnet** (with mandatory Opus safety review)
Per CLAUDE.md "Model routing": Opus is reserved for top-level judgment
calls, `booking-safety-reviewer`, and Finance/Paid-Ads money decisions —
not for typing out a fully-specified small diff. This plan removes the
judgment from execution: the logic, placement, exact fields, and tests are
all pinned down here. The safety is provided by the **mandatory
`booking-safety-reviewer` (Opus) pass on the resulting diff** plus the
charter's independent Opus re-review loop — not by paying Opus rates to
implement. That is the Solvency-aligned choice. (Opus-for-execution is a
defensible close call given this is the single most safety-critical route;
if the founder prefers maximum caution, bump to Opus — but the mandatory
Opus safety gate already covers the risk either way.)

### Hard-constraint / collision check
- Migrations: **not touched** — reuses existing `Json` `offerSnapshot`
  column, no schema change.
- Auth code / pricing-payment logic: **not touched** — no refund, no
  charge, no PaymentIntent mutation in this diff (see flagged decision).
- Shared hub files (`sitemap.ts`/`robots.ts`/`layout.tsx`): not touched.
- Collision risk: `git status` clean on `main`; stale branches
  `track-a..d`/`ui-rehaul` exist but none has an open PR touching
  `route.ts`. Low collision risk. Rebase-onto-main + full suite still
  required before any eventual merge (Parallel Agent Protocol).

### MONEY-CODE REVIEW REQUIREMENT (do not skip later)
This diff touches Duffel order-creation + Stripe-adjacent booking logic.
Per the charter and CLAUDE.md guardrails, the resulting diff **MUST** go
through `booking-safety-reviewer` (Opus) *in addition to* the Fullstack
Engineer's own independent Opus re-review loop, before it can merge — no
exception, regardless of which model implemented it. Flagging here so this
isn't missed just because running it wasn't part of the plan-drafting step.

### Founder decision required before approval (NOT decided here)
1. **What happens to the money on a caught failure (expired offer OR Duffel
   error), and what does the user see?** This plan makes the failure
   *labeled and diagnosable* but does **not** auto-refund — automatic
   refunds are money-moving code on the hard-constraint block-list and need
   founder sign-off + `booking-safety-reviewer`. Options: (A) mark failed +
   manual/support refund (this plan's default; user sees "not booked, will
   be refunded, reference X"); (B) build automatic Stripe refund into the
   failure path (separate, money-moving, out of this item's scope). Which
   policy, and the exact user-facing copy, is a product call.
2. **Pre-charge expiry guard (stronger fix, deliberately out of scope
   here).** The *only* place a server-side check can stop the charge itself
   is `/api/stripe/payment-intent`, which already re-fetches the offer via
   `getOfferWithServices` right before creating the PaymentIntent — a
   `expires_at <= now` gate there (read-only, no money moves; it just
   refuses to set up payment for a dead offer) would prevent charging for
   an already-expired offer entirely. It's a *second file in a
   money-adjacent flow*, so this plan recommends filing it as its own small
   item rather than folding it in (keeps this diff to one flow, keeps
   review clean). Founder to decide: separate item, or bundle.

---

## Plan review (fresh critical Opus pass, 2026-07-13)

Verdict: **APPROVE, pending the two flagged founder decisions.** A genuinely
critical re-read of the plan above, checked against the four questions the
charter requires:

**Does it actually resolve the reported issue?** Yes, for the core of the
bug. The report's headline is "money moves, no flight booked, failure is
silent and undiagnosable." Changes 2+3 make every failure path durably
labeled (`offerSnapshot.failureReason`) and alertable (`Sentry.capture-
Exception`), directly closing gaps #1 (no error tracking) and the
expires_at half of #2. The expiry guard (Change 2) converts the specific
suspected root cause (expired offer reaching `POST /air/orders`) into a
clean 410 instead of a swallowed error. **Caveat surfaced correctly by the
plan:** it does not make the money whole — the card stays charged on
failure. The plan is right not to silently build an auto-refund (that's
money-moving, hard-blocked) and right to escalate it as a founder decision
rather than either ignoring it or quietly implementing it. So it resolves
the *diagnosability* and *silent-failure* problem fully, and correctly
defers the *refund* problem as a gated decision — that is the correct
scoping, not an evasion.

**Does it stay in scope?** Yes. One production file (`route.ts`) plus its
test file. The expiry check is placed in-route (post-charge), which the
item's fix-direction #1 explicitly permits. The stronger pre-charge guard
is correctly identified but pushed to a separate item rather than
scope-crept in — consistent with the charter's "one flow's worth" rule.

**Does it touch the hard-block list?** No. Verified: no migration (reuses
existing `Json` column — confirmed `offerSnapshot` is already `Json` in
`schema.prisma` and already written as `Prisma.InputJsonValue` elsewhere in
this same route, so this introduces no new schema dependency and no
coupling to the unapplied Phase 5 migration); no auth; no pricing/payment
mutation (no refund/charge/PI write); no shared hub files. The one money-
adjacent touch it *recommends against* (the payment-intent route) is
explicitly deferred.

**Collisions?** `git status` clean on `main`. Stale `track-a..d`/`ui-rehaul`
branches carry no open PR against `route.ts`. Low risk; rebase-before-merge
still mandated.

**Issues the review flags for the implementer (not blockers, but must be
handled during execution):**
- **`Date` parsing safety.** `new Date(offer.expires_at).getTime()` returns
  `NaN` if `expires_at` were ever malformed; `NaN <= Date.now()` is
  `false`, so a bad timestamp would *fail open* (skip the guard, attempt
  the order) rather than fail closed. Given `expires_at` is a required
  normalized field this is low-risk, but the implementer should confirm the
  normalizer guarantees a valid ISO string, or treat an unparseable value
  as expired. Minor.
- **Test for `requestLog` isolation.** The "never called `POST /air/orders`"
  assertion must account for `getOfferWithServices` *also* going through
  `duffelRequest` (it hits `/air/offers/:id`). The test should assert no
  `/air/orders` POST specifically, not "no duffel calls." The plan's wording
  already says this; calling it out so it isn't lost.
- **Sentry no-op in test/CI.** `Sentry.init` no-ops without a DSN, but
  `captureException` is still a real function call; the test must mock
  `@sentry/nextjs` to assert the call rather than relying on runtime
  behavior. The plan says to mock it — good.

None of these change the plan's shape; they're execution notes. The plan is
approved to proceed to founder sign-off (step 3), which is out of this
session's scope.

---

## Founder sign-off (2026-07-14)

Both flagged decisions resolved:
1. **Refund policy: Option A** - no auto-refund built now. Ship the plan
   exactly as drafted (labeled failure, manual/support-handled refund,
   "you have NOT been booked, the charge will be refunded, reference X"
   copy). Revisit auto-refund as its own future item if it becomes a real
   need.
2. **Pre-charge expiry guard: filed separately**, not bundled - see
   `BUG-0005-no-preauth-offer-expiry-check.md`.

Plan approved for execution as written. Proceed to step 4.
