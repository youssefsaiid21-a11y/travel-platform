---
id: BUG-0004
type: bug
status: open
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
