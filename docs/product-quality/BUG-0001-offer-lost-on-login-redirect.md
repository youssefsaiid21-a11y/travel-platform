---
id: BUG-0001
type: bug
status: open
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
