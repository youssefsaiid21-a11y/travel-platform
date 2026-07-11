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
| Checkout -> payment confirmation | never | - | Highest priority - walk every real run |
| Search -> select flight | never | - | |
| Account / profile | never | - | |
| Tracked searches / price alerts | never | - | |
| Support ticket flow | never | - | |

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
