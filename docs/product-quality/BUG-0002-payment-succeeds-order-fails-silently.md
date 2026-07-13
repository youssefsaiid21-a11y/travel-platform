---
id: BUG-0002
type: bug
status: open
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
