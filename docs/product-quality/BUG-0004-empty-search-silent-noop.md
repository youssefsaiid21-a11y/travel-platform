---
id: BUG-0004
type: bug
status: in-review
flow: search
severity: degrades-experience
owner: ui-agent
created: 2026-07-13
observed_at_commit: 23c8392
---

## Repro steps

1. Land on the homepage with nothing typed into the main search input
   (only placeholder text "London to New York next Friday" is showing,
   the field is genuinely empty).
2. Note the ↵ hint icon that appears next to the input, with tooltip
   "Press Enter to search" - this hint only renders when the input is
   empty (`{!input && !loading && <span ... title="Press Enter to search">`,
   `src/app/page.tsx` hero form).
3. Press Enter (or click the visually-enabled-looking Search button,
   which is actually disabled but doesn't look obviously so at a glance).

## Expected behavior

Either: the hint should not imply an empty submission will do something
(since it doesn't), or pressing Enter/clicking Search on an empty input
should give some feedback - a validation message, a shake, focus
retained with a hint to type something - rather than nothing at all.

## Actual behavior

Nothing happens. Confirmed via network log: zero requests fire (no
`/api/chat` call, no navigation, no visible state change at all). This
was confirmed twice - once via direct click on the (disabled) Search
button, once via pressing Enter while the input had focus and the ↵ hint
was visibly showing its "Press Enter to search" tooltip.

Root cause is a disabled-button guard
(`disabled={loading || !input.trim()}`) plus a defensive early return in
`sendMessage` (`if (!text.trim() || loading) return;`) - both correct as
loop-safety, but neither pairs with any user-visible feedback, and the ↵
hint's copy ("Press Enter to search") is shown in exactly the state
where pressing Enter is guaranteed to do nothing.

This matches a friction point flagged during an earlier design review
(never previously filed) - verified here directly rather than taken on
faith, per normal process.

## Suggested fix direction

Either hide/change the ↵ hint copy when the input is empty (e.g. don't
render it, or show a neutral "type something to search" placeholder-style
cue instead of implying Enter will act), or add a lightweight
feedback affordance (brief shake, subtle color pulse) when Enter/Search
is attempted on empty input. Routed to `owner: ui-agent` since this is
in-product copy/motion craft, not a logic change - the underlying guard
clauses (`disabled=...`, `sendMessage`'s early return) are already
correct and don't need to change.

## Fix (ui-agent, 2026-07-14)

Took the first suggested direction: the `↵` hint's visibility condition
in `src/app/page.tsx`'s hero form was inverted from what it should be -
`{!input && !loading && <span ...>Press Enter to search</span>}` rendered
the hint exactly when the input was empty (Enter guaranteed to no-op) and
hid it exactly when Enter would actually submit. Flipped the condition to
`{input.trim() && !loading && ...}` so the hint only appears when there's
real text to submit, matching what it claims. No changes to
`disabled={loading || !input.trim()}` or `sendMessage`'s early-return
guard - both already correct, per the original report.

Verified in a real browser against this worktree's own dev server
(`localhost:3101`, `.env.local` copied from the main checkout, pointed at
the same Neon `dev` branch - never the shared 3000 session another
background agent had open on `/booking/confirm`, left untouched): empty
input shows no `↵` hint and a visibly dimmed disabled Search button;
typing "Paris to Rome" makes the hint appear and the button light up;
pressing Enter on an empty field produces zero `/api/chat` requests and no
visible state change (network log confirmed empty); pressing Enter with
real text ("London to New York next Friday") fires the request and the
full NL-parse -> checkpoint card flow completes normally
(`LHR -> JFK · 2026-07-17 · 1 passenger`, Confirm/Edit buttons rendered).
Console showed one hydration-mismatch warning on load, entirely from
browser-extension-injected attributes (`bis_skin_checked`, `bis_register`,
`data-gr-ext-installed` = Grammarly) on elements untouched by this diff -
not a regression, confirmed by reading the diff in the warning itself.

`npm run lint`, `npx tsc --noEmit`, and `npm test` (60/60 files, 463/463
passing, 3 skipped) all clean on the branch, already even with `main`'s
tip (`55b4f3f`) at the time this was opened - no rebase needed.

Not money-adjacent: touches only `src/app/page.tsx`'s hero search form,
no `src/app/booking/**`, no `StripeCheckout`, no price/itemization
display, no trust signal changed.

Status: **`in-review`**. PR opened (link in the founder-agent's run
report) - not merged by this agent, per protocol.
