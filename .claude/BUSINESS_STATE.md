# Business State

Living dashboard for the Executive Charter in `CLAUDE.md`. This is what
survives context compaction and fresh scheduled-routine sessions - update
it in the same turn a decision worth remembering gets made, not "later."

## North-star metrics
Vercel Analytics stood up 2026-07-09 (`search_completed`, `offer_selected`,
`booking_completed` events) - no real traffic has accumulated yet, so these
are still effectively unmeasured in practice, but the instrumentation now
exists and will populate from here on.
- Booking conversion rate (search -> offer view -> booking -> payment): instrumented, no data yet
- Price competitiveness vs. comparison sites: unmeasured
- Monthly revenue vs. cost (Solvency check): unmeasured

## Agent roster status
| Agent | Status | Notes |
|---|---|---|
| Operations | active | `.claude/agents/operations-agent.md` - read-only infra/health watcher |
| SEO | merged to `main`, live | `.claude/agents/seo-agent.md` - PR #2 merged |
| GEO | merged to `main`, live | `.claude/agents/geo-agent.md` - PR #1 merged |
| Content & Virality | merged to `main`, live | `.claude/agents/content-virality-agent.md` - PR #3 merged |
| Channel Coverage | merged to `main`, live | `.claude/agents/channel-coverage-agent.md` - PR #4 merged |
| Finance | drafted, NOT activated | `.claude/agents/finance-agent.md` - read-only by design; prompt reviewed 2026-07-09, still needs an explicit go-ahead for first real run |
| Customer Support | agent defined, feature LIVE | `.claude/agents/customer-support-agent.md` written (draft-only, never auto-sends); `/support` page + API route live in production, SupportTicket migration applied and verified end-to-end |
| Paid Ads | drafted, NOT activated | `.claude/agents/paid-ads-agent.md` - no live write access designed in; still needs a founder budget decision + prompt sign-off before first real run |

## Recent autonomous decisions (most recent first)
- 2026-07-09: Reconciled the 4 marketing-agent branches properly after
  founder feedback that parallel-agent quality was subpar. Root cause
  confirmed with hard evidence: SEO and Content & Virality had both
  independently rewritten `sitemap.ts` (one would have silently reverted
  the other's live-domain fix and dropped its URLs); GEO and Channel
  Coverage had both independently rewritten `layout.tsx` (one would have
  reverted the other's JSON-LD/corrected airline-count stat). Documented
  the fix as a permanent "Parallel Agent Protocol" in `CLAUDE.md`
  (foundation-before-fan-out, data-file extension over hub-file editing,
  rebase-before-merge, integration-level testing, worktree cleanup
  discipline). Then executed the merge properly: SEO -> GEO -> Content &
  Virality -> Channel Coverage, each rebased onto the previous merge (not
  the stale fork point) before merging, with the `sitemap.ts` conflict
  resolved by hand (kept both flight-guide and content-guide entries plus
  the domain fix) and the full test suite re-run after every merge. Found
  and fixed 2 real display bugs during the post-merge browser verification
  pass that no automated test caught: a duplicated airport code
  ("Heathrow (LHR) (LHR)") and an ambiguous-looking missing space in a CTA
  button. All 4 PRs merged and closed; their branches deleted (local +
  remote) once merged.
  Then, with explicit founder approval, applied the `SupportTicket`
  migration to the production Neon DB and verified the full flow live
  (filled and submitted the real `/support` form against production,
  got the real success state - not just a code-level check) before
  promoting the final build to production.
  Judgment call surfaced and correctly deferred by a subagent mid-session:
  "1,2,3 approved" was ambiguous between "merge PRs #1-4" (item 1, bundled)
  and literally "PRs #1/#2/#3 only" - asked rather than guessed, since a
  wrong guess either way meant either an unauthorized merge or leaving a
  clean, tested PR needlessly stuck.
- 2026-07-09: Full business-ops build-out session, capped with a production
  deploy of everything merged to `main`. Summary of what shipped:
  (1) Vercel Analytics + funnel tracking; (2) Customer Support intake code
  (migration pending approval); (3) all 8 agent definitions written
  (Operations active; SEO/GEO/Content/Channel ran real first passes, output
  on PRs #1-4 for review since they're propose-only per the Charter;
  Finance/Customer-Support/Paid-Ads drafted, gated on founder review/budget
  before first real activation); (4) root-caused and fixed why every
  spawned functional agent kept entering its own plan mode (CLAUDE.md's
  Working Style told every session to plan for "anything beyond a trivial
  fix" - didn't distinguish "you're deciding scope" from "you're executing
  an already-specified task"); (5) sharpened MECE boundaries across the 4
  content/marketing agents after a real overlap (SEO nearly duplicated
  GEO's JSON-LD work); (6) broadened `.claude/settings.json` permissions
  twice more after repeated founder feedback that prompts were still too
  frequent - each widening needed the founder's exact-text sign-off per the
  harness's self-modification rule, which cannot be pre-authorized by a
  general instruction no matter how it's phrased.
  Operational lesson: background agents running in isolated worktrees can
  leave `.claude/worktrees/*` directories behind that get picked up by
  `npm test`'s file globbing and produce spurious failures from stale/
  parallel-universe code - run `git worktree list` and prune before trusting
  a "tests are failing" signal if agent worktrees were used this session.
  One stray agent also resurfaced mid-session after its worktree had
  already been cleaned up once (harness apparently persists/resumes agent
  state independent of the worktree directory) - had to be explicitly told
  to stop and discard its redundant work.
  Flagged for founder review before merging PR #2 (SEO): `flightGuides.ts`'s
  FAQ content makes visa/entry-requirement claims (e.g. UK->US ESTA) -
  already hedged ("requirements change, always check current rules") but
  still a customer-facing legal/policy-adjacent claim worth a second look
  per the Charter's escalation category, not something to wave through
  unreviewed just because it's hedged.
- 2026-07-09: Deployed to production (review gate passed: tests/lint/typecheck
  clean, no Duffel/payment/UI diff since last deploy) and verified live via
  claude-in-chrome: real search -> real Duffel sandbox offers -> booking form ->
  Stripe card element mounted and validated a test card (Visa) in real time with
  zero console errors, proving `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is now live in
  the production bundle - the original booking/payment outage is confirmed fixed.
  Did not complete the test charge (Stripe's expiry/CVC sub-fields sit inside one
  opaque cross-origin iframe that synthetic browser-automation clicks couldn't
  reliably target - a tooling limitation, not a product issue). Created one
  incidental test account (`stripe-verify-20260709@example.com`, no completed
  booking) in the production DB during verification - harmless, low priority
  cleanup if noticed later.
- 2026-07-09: Consolidated `.claude/settings.json` autoMode permission rules after
  founder feedback that the system required intervention too often. Root causes
  diagnosed: (1) the Executive Charter in CLAUDE.md and the harness's separate
  auto-mode classifier don't share context - charter policy has to be re-encoded
  as explicit classifier rules to actually reduce prompts; (2) writing/committing
  permission-widening rules is itself gated ("self-modification"), requiring the
  *exact* rule text confirmed, not general "go ahead" enthusiasm; (3) settings
  changes need a `/hooks` reload or restart to take effect mid-session - a
  mechanical gap, not a trust question. Founder gave one explicit, exact-text
  sign-off covering: routine dev-loop commands, safe env-var writes,
  review-gated `vercel deploy --prod`, standing `git push origin main` (matches
  this repo's pre-existing no-PR-workflow convention), and creating/editing
  `.claude/agents/*.md` for the non-money-tier roster only (Finance/Paid Ads
  agent definitions still need per-instance review). Also added: any UI/runtime-
  facing diff needs real claude-in-chrome browser verification before being
  called done or before an autonomous deploy - automated tests alone aren't
  sufficient evidence (precedent: the CSP header incident that broke all client
  interactivity while passing every automated check).
- 2026-07-09: Fixed missing Stripe env vars across Production/Preview/Development
  (`STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`)
  - was the confirmed cause of broken production booking/payment. Test-mode keys
  provided by the founder; a Stripe webhook endpoint was created via the Stripe
  API pointed at the production URL to obtain the webhook signing secret.
  `.env.local` updated to match. Reversible, restorative, matched an established
  pattern (missing config) - no escalation needed per the charter.
- 2026-07-09: Executive Charter added to CLAUDE.md; this file created; Operations
  agent stood up as the first functional agent in the roster.

## Open escalations (nothing autonomous can resolve without founder input)
- **Finance and Paid Ads agents are drafted but not activated** - both
  prompts are written with hard escalation gates built in, but per
  `.claude/settings.json`, a general "keep going" instruction does not cover
  their first real invocation. Needs the founder to review each prompt
  (`.claude/agents/finance-agent.md`, `.claude/agents/paid-ads-agent.md`)
  before either is ever actually run. Paid Ads additionally needs an
  explicit budget decision first.
- `flightGuides.ts`'s FAQ content (now live via the merged SEO PR) makes
  visa/entry-requirement claims (e.g. UK->US ESTA) - already hedged
  ("requirements change, always check current rules") but still worth a
  founder read given the Charter's legal/policy-claim escalation category.
