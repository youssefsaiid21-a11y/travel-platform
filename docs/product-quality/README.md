# Product quality queue

The Product Agent's diagnostic output and the Fullstack Engineer agent's
work queue, both. One markdown file per item, not a single shared log -
a single shared file written by one agent and edited by another is exactly
the collision pattern that caused the real sitemap.ts/layout.tsx incident
documented in CLAUDE.md's Parallel Agent Protocol (two branches silently
reverting each other's changes to the same file). One file per item means
two items in flight never touch the same file.

Filename: `BUG-0001-short-slug.md` or `IMP-0001-short-slug.md`. IDs are
sequential per type, never reused even if an item is closed as wontfix/stale.

## Frontmatter schema

```yaml
---
id: BUG-0001
type: bug            # bug | improvement
status: open          # see state machine below
flow: checkout        # search | select-flight | checkout | payment | account | tracked-searches | support
severity: blocks-booking   # bugs only: blocks-booking | degrades-experience | cosmetic
created: 2026-07-11
observed_at_commit: <git sha the Product Agent was looking at when it found this>
---
```

## Body

**For a `bug`**: repro steps, expected behavior, actual behavior, and
what you clicked/saw (a screenshot path or claude-in-chrome trace if one
was captured). "I hesitated here" is not a repro - if you can't write
concrete steps to reproduce it, it's an `improvement`, not a `bug`.

**For an `improvement`**: what's confusing or effortful about the current
flow, why it hurts Ease specifically (not just "would be nicer"), and
proposed acceptance criteria - what would have to be true for this to
count as resolved.

## State machine

```
open -> planned -> approved -> in-progress -> in-review -> merged -> verified
                                                                 \-> wontfix
                                                                 \-> stale
```

- **open** - filed by the Product Agent, not yet picked up.
- **planned** - the Fullstack Engineer agent has drafted an implementation
  plan for this item (plan lives in the item file, appended below the
  body, not a separate file).
- **approved** - the plan passed Opus review AND got explicit founder
  sign-off. Nothing gets implemented before this state, no exception -
  see `.claude/agents/fullstack-engineer-agent.md`.
- **in-progress** - being implemented.
- **in-review** - PR open, independent review pass done, awaiting merge.
- **merged** - PR merged. Not the same as fixed - see `verified`.
- **verified** - the Product Agent re-walked this specific flow after
  deploy and confirmed the problem is actually gone. This is the only
  real terminal-success state; `merged` alone doesn't close the loop.
- **wontfix** - founder or plan review rejected it. Give a one-line reason
  in the item file. Never delete a wontfix item or reuse its ID - the
  Product Agent checks open+wontfix items before filing a new one to
  avoid re-reporting the same rejected idea forever.
- **stale** - the flow this item describes has changed materially since
  `observed_at_commit`, so the item may no longer be accurate. The Product
  Agent should mark items stale (not delete them) when it notices this
  during a later walkthrough, and re-file fresh if the issue still exists.

## Autonomy note

Every item currently requires founder approval before `planned` ->
`approved`, regardless of type - see the Fullstack Engineer agent's charter
for why. `bug`-type items are the category eligible to eventually skip
that gate as trust is established (via the same Harness learning loop
CLAUDE.md already uses for the auto-mode classifier); `improvement`-type
items stay founder-gated indefinitely, since a redesign is a product-shape
decision, not a bug fix - matches the Executive Charter's existing
escalation rule for "anything that would change the product's fundamental
shape."
