# Last checked

**State, not a log** - one row per flow, rewritten in full by the Product
Agent at the end of every run, never appended to. This can't grow
unbounded by construction (see CLAUDE.md's "Keeping BUSINESS_STATE.md from
becoming a token sink" - same principle, applied here from day one instead
of needing a later archive pass). If you're tempted to add a history of
past runs here instead of just the latest, don't - that's what `git log`
on this file is for if it's ever actually needed.

| Flow | Last walked | Commit at last walk | Notes |
|---|---|---|---|
| Checkout -> payment confirmation | 2026-07-13 | 23c8392 | Walked most thoroughly, both logged-out-select and logged-in-select paths, through a real Stripe test-mode payment. Found BUG-0001 (offer lost on login redirect) and BUG-0002 (payment succeeds, Duffel order creation fails silently) - both blocks-booking. Mobile viewport NOT verified this run - `resize_window` floored at ~614px CSS width and the screenshot tool didn't reflect the resize; revisit with working mobile emulation next run, don't skip it again. |
| Search -> select flight | 2026-07-13 | 23c8392 | Walked with several NL queries (London/Berlin/Sydney/Tokyo/Paris all parsed correctly). Found BUG-0003 (Madrid/Rome silently fail to parse or get dropped into "explore anywhere") and BUG-0004 (empty-input search silently no-ops despite a hint implying Enter will act). CI's last recorded failure (search-flow.spec.ts timeout against prod) was NOT reproduced locally after 2 clean runs - treated as prior transient flakiness per existing precedent, not a new local bug. |
| Account / profile | 2026-07-13 | 23c8392 | Walked with the seeded test account. Account info, password/2FA section, and saved passenger profile (correctly populated from a completed checkout) all rendered cleanly. No issues found. |
| Tracked searches / price alerts | never | - | No dedicated page found this run (no `/tracked-searches` route; not surfaced on `/profile` either). Did not get to test the "Track this price" action itself - rotate to this first next run. |
| Support ticket flow | 2026-07-13 | 23c8392 | Submitted a real test ticket end-to-end (`/support`) - form validation, submission, and confirmation state all worked cleanly. No issues found. |

## Concurrency note

This file, and the item files in this directory, are all shared-write
surfaces - the Product Agent rewrites this table and files/dedups items,
the Fullstack Engineer mutates `owner: fullstack-engineer` item statuses,
the UI Agent mutates `owner: ui-agent` item statuses. If two runs ever
overlapped, either could silently lose the other's update. **Git provides
no protection:** all three agents run in the same working tree on one
machine, so there is no second clone for git to reconcile against and no
push-conflict safety net. The only reason this is safe today is that
nothing schedules any of them, so runs are effectively serial.

**Tripwire:** before any autonomous scheduling is added to any of these
agents, this needs a real mechanism (a lock file, or a real queue).
Document-only is safe ONLY while every run is manually triggered.
