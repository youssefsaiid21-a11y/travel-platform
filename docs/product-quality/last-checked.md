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
