---
id: BUG-0006
type: bug
status: open
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
