# Product quality queue

The Product Agent's diagnostic output, and the work queue for the two
agents that execute it: the Fullstack Engineer (functional/logic items)
and the UI Agent (visual/craft items, see `owner` in the schema below).
One markdown file per item, not a single shared log - a single shared
file written by one agent and edited by another is exactly the collision
pattern that caused the real sitemap.ts/layout.tsx incident documented in
CLAUDE.md's Parallel Agent Protocol (two branches silently reverting each
other's changes to the same file). One file per item means two items in
flight never touch the same file.

Filename: `BUG-0001-short-slug.md` or `IMP-0001-short-slug.md`. IDs are
sequential per type, never reused even if an item is closed as wontfix/stale.

Also in this directory: `last-checked.md` - a small state table (one row
per flow, rewritten in full each run, never appended to), tracking when
the Product Agent last walked each flow. Not part of the item schema below
- see that file's own note for why it's deliberately not a growing log.

## Frontmatter schema

```yaml
---
id: BUG-0001
type: bug            # bug | improvement
status: open          # see state machine below
flow: checkout        # search | select-flight | checkout | payment | account | tracked-searches | support
severity: blocks-booking   # bugs only: blocks-booking | degrades-experience | cosmetic
owner: fullstack-engineer   # fullstack-engineer | ui-agent - who executes this, see below
created: 2026-07-11
observed_at_commit: <git sha the Product Agent was looking at when it found this>
regression_of: BUG-0007   # optional - present only on a regression, see below
---
```

`owner` is set by the Product Agent when filing: `fullstack-engineer` for
functional correctness and cross-flow journey friction (the default -
if unsure, the Product Agent defaults here, since it's the heavier-gated
path and a miscategorized item costs review time, not safety), `ui-agent`
for visual/craft findings (layout, spacing, component structure, design-
system consistency, in-product copy) that the UI Agent owns end-to-end.
Money-adjacent items (anything on `ui-agent.md`'s money-adjacent file
list) get `owner: ui-agent` but are still always founder-gated per that
agent's own hard constraint, regardless of the lighter path described
below for its other items.

`regression_of` is optional and appears only when this item is a
regression of an earlier item that had already reached a terminal success
state (`merged` or `verified`). It holds that original item's id. A
newly-observed issue matching a `merged`/`verified` item's flow and
symptom is filed as a new item with `regression_of` linking back - never
silently deduped against the original, and never a status change on the
original. See the Product Agent's "After a fix ships" section for the
deploy-lag caveat: confirm the fix commit is actually present in what was
tested before calling something a regression rather than deploy lag.

## Body

**For a `bug`**: repro steps, expected behavior, actual behavior, and
real evidence - the actual JS console error or failed network request if
there was one (the Product Agent has tools to capture both; a bug filed
without evidence when evidence was available is a lower-quality report).
"I hesitated here" is not a repro - if you can't write concrete steps to
reproduce it, it's an `improvement`, not a `bug`.

**For an `improvement`**: what's confusing or effortful about the current
flow, why it hurts Ease specifically (not just "would be nicer"), proposed
acceptance criteria - what would have to be true for this to count as
resolved - and, if available, corroborating signal (a recurring support
ticket theme, a real booking drop-off at this step). Not required, but an
improvement backed by real signal is a stronger case than judgment alone.

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

**`owner: ui-agent` items take a shorter path through this same state
machine** (see `.claude/agents/ui-agent.md`'s Autonomy section for the
full rule): `open -> in-review -> merged -> verified` directly - no
`planned`/`approved` founder pre-gate, since the UI Agent doesn't need
pre-approval to start low-risk visual/craft work. The UI Agent is
responsible for transitioning its own items' statuses (it has `Write`/
`Edit` access, unlike the Product Agent) as it works. **This shortcut
does NOT apply to a money-adjacent `owner: ui-agent` item** - those stay
founder-gated through the full `planned -> approved` path like any
`owner: fullstack-engineer` item, per `ui-agent.md`'s hard constraint.
- **verified** - the Product Agent re-walked this specific flow after
  deploy and confirmed the problem is actually gone. This is the only
  real terminal-success state; `merged` alone doesn't close the loop.
- **wontfix** - founder or plan review rejected it. Give a one-line reason
  in the item file. Never delete a wontfix item or reuse its ID - before
  filing, the Product Agent checks `wontfix` items for a *real* match
  (same flow and symptom, not just an exact title match) and, if this was
  already declined and nothing material changed, does not re-file it -
  noting why in the run summary only, never rewriting the wontfix file
  itself.

### Dedup, regression, and wontfix rules before filing

Before filing any new item, the Product Agent checks existing items:
- **Dedup against any non-terminal item, not just `open`.** An existing
  item in any of `open` / `planned` / `approved` / `in-progress` /
  `in-review` on the same flow and symptom means it's already queued or in
  flight - don't re-file.
- **Regression, not dedup, against terminal-success items.** A new issue
  matching a `merged` or `verified` item's flow and symptom is filed as a
  NEW item with `regression_of: <original id>` (see the schema above),
  after confirming it's a real regression and not deploy lag.
- **Wontfix memory.** As in the `wontfix` bullet above - a real match to a
  declined item, with nothing material changed, is skipped and noted in
  the run summary only.
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

## Concurrency note

The shared-write surface here is not just `last-checked.md`. The item
files themselves are shared-write too, and there are now three writers:
the Product Agent files and dedups them, the Fullstack Engineer mutates
`owner: fullstack-engineer` items' status, the UI Agent mutates
`owner: ui-agent` items' status. Any two of these overlapping carry the
same lost-update risk on any of these files that a single shared log
would - which is why "one file per item" reduces, but does not eliminate,
the collision surface. **Git provides no protection here:** all three
agents run in the same working tree on one machine, so there is no second
clone for git to reconcile against and no push-conflict safety net. Runs
are safe today only because nothing schedules them - they're effectively
serial. Before any autonomous scheduling is added to any of these agents,
this needs a real mechanism (a lock file or a queue); document-only is
safe only while every run is manually triggered.
