# Business State

Living dashboard for the Executive Charter in `CLAUDE.md`. This is what
survives context compaction and fresh scheduled-routine sessions - update
it in the same turn a decision worth remembering gets made, not "later."

## Go-live checklist progress (2026-07-09) - archived
9 items shipped to production 2026-07-09 (service fee, passport encryption
+ account deletion/export, cookie consent, ticket email alerts, Stripe
live-key gate, npm audit fix, site-health cron, financial reconciliation,
TOTP 2FA), 5 deferred by explicit founder call (refunds, legal pages,
licensing, Duffel/Stripe account-level steps, custom domain), 2 still open
(Resend/Sentry pending founder API keys/DSN, Vercel Pro pending a launch
date). A same-day follow-up audit found and fixed 2 real vulnerabilities
(MFA could be silently disabled without a password check; TOTP had no
replay protection) - full detail, including gaps surfaced then that are
still open (no account-recovery path if 2FA + backup codes are both lost;
accessibility/mobile gaps in booking/confirm and the cookie banner), is in
`.claude/archive/business-state-2026-07-09.md` (the "zero admin surface"
gap noted there is now partially addressed by `/admin/ops` etc., built
2026-07-10/11).

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
| Paid Ads | deleted 2026-07-11 | founder call - not worth carrying a drafted agent for a channel that's not active; re-add if/when paid acquisition becomes a real priority |
| Product | drafted, NOT run | `.claude/agents/product-agent.md` - diagnostic-only, walks real flows via live browser, files findings to `docs/product-quality/`; never touches code. Needs a first real run + review before it's routine. |
| Fullstack Engineer | drafted, NOT run | `.claude/agents/fullstack-engineer-agent.md` - executes the Product Agent's queue; every item needs founder plan-approval before code is written, no exception yet. Needs a first real run + review before it's routine. |

## Harness calibration log
Every time the auto-mode classifier blocks something, record it here once
resolved - which bucket it landed in (see CLAUDE.md's "Harness learning
loop") tells a fresh session whether to re-attempt a rule or just expect
to confirm again.

| Date | Blocked action | Resolution | Bucket |
|---|---|---|---|
| 2026-07-09 | `vercel env add DATABASE_URL <env> --force -y` (pooled endpoint swap) | Founder gave one specific yes via AskUserQuestion showing the exact command+value; applied across prod/preview/dev | **Always-confirm.** An existing `autoMode.allow` rule already named `DATABASE_URL` generically and still wasn't sufficient - the classifier explicitly reasoned that a live prod DB credential force-write needs the exact action named each time, not a category match. Don't spend effort re-drafting a broader rule for this - it's rare enough (a handful of times per project lifetime) that asking each time is the right cost. |
| 2026-07-09 | Raw 100-connection concurrency script directly against the live production Neon DB | Declined - used a verified-connectivity check + Neon's own documented pooling rationale as evidence instead, deferred the real stress test until after the endpoint switch landed | **Always-confirm, and often just don't.** Risk here scales with parameters chosen per-invocation (target, connection count) - this is exactly the kind of block that's correct to hit every time, since "safe" depends on what's being tested, not on having asked before. |
| 2026-07-09 | `vercel env pull --environment=production` (early session, Stripe outage investigation) | Declined - found the needed non-secret value via code-level fallback instead | **Always-confirm** (dumps ALL prod secrets to a local file for a narrow need - never worth pre-authorizing). |

## Recent autonomous decisions (most recent first)
- 2026-07-11: Designed and drafted two new agents after a founder design
  session (not built unilaterally - went through several rounds of
  founder correction first): Product Agent (diagnostic-only, walks real
  flows via live browser like a human user, asking "is this easy/simple,"
  finds bugs and friction, never touches code) and Fullstack Engineer
  agent (executes the Product Agent's queue - plan, Opus plan-review,
  founder approval, execute, independent Opus re-review, then PR - never
  auto-merges). Before finalizing, ran a design review via the `fable`
  model specifically probing "what would it take to remove the founder
  from the loop entirely" (the founder's own request) - the review argued
  directly against full removal (approving a plan costs minutes; a
  silently broken checkout costs real revenue and trust, and this
  project's own Parallel Agent Protocol incident already proves silent
  regressions get past narrower, more isolated per-branch review than
  this agent will have) and recommended earning autonomy with evidence
  instead of declaring it - incorporated as: `bug`-type items are the
  category eligible to eventually skip the approval gate via the existing
  Harness learning loop mechanism below; `improvement`-type items (product
  redesign judgment calls) stay founder-gated permanently, matching the
  Charter's existing escalation rule. Also incorporated: the report queue
  is one-file-per-item in `docs/product-quality/`, not a single shared
  log (avoids repeating the sitemap.ts/layout.tsx collision), and the
  Product Agent's browser walkthrough is hard-constrained to
  local/preview test-mode credentials, never production - the design as
  first described didn't specify this and would have meant placing real
  orders against live payment credentials while "just testing."
- 2026-07-11: Deleted the Paid Ads agent (`.claude/agents/paid-ads-agent.md`)
  per explicit founder direction ("useless for now") - it had never been
  activated (no live ad-platform write access, no budget decision made).
  Updated the roster table, the open-escalations entry, and CLAUDE.md's
  phased build order to drop it. Not a loss of any real capability - it was
  drafted-only from the day it was written; re-add it if/when paid
  acquisition becomes an actual priority.
- **2026-07-09 (7 entries, archived)**: Executive Charter + this file
  created, Operations agent stood up; Stripe env vars fixed (root cause of
  a real production payment outage) and verified live end-to-end;
  `.claude/settings.json` autoMode rules consolidated after founder
  feedback that prompts were too frequent; full business-ops build-out
  (Vercel Analytics, Customer Support intake, all 8 original agent
  definitions written, Parallel Agent Protocol root-caused and documented
  after 2 branches independently rewrote the same hub files); the 4
  marketing-agent branches reconciled and merged properly under that new
  protocol (found 2 real display bugs no automated test caught);
  `SupportTicket` migration applied to prod and verified live; a
  launch-readiness pass (logo bug fix, timeouts added to Duffel/Z.AI
  clients, Neon pooled-endpoint verified, waitlist capture built,
  Product Hunt date set to 2026-08-07). Full detail:
  `.claude/archive/business-state-2026-07-09.md`.

## Open escalations (nothing autonomous can resolve without founder input)
- **Go-live readiness audit completed 2026-07-09** - see
  `docs/go-live-checklist.md` (local file, deliberately gitignored - it
  itemizes real security/compliance/financial gaps and this repo is
  public, so the details don't belong in version history). Founder should
  read it before any real launch date is set; every item in it needs a
  founder/legal/business decision, not autonomous action.
- **Optional: a real concurrency test before launch day.** The harness
  correctly blocked running a 100-connection stress test directly against
  the live production DB (real outage risk). Once the pooled-endpoint
  switch above is approved, a safer version of this (e.g. a smaller
  concurrency figure, or run against a preview deployment with a Vercel
  automation-bypass secret) is worth doing to get real numbers instead of
  code-audit inference - founder call on whether/how to run it.
- **Finance agent is drafted but not activated** - the prompt is written
  with hard escalation gates built in, but per `.claude/settings.json`, a
  general "keep going" instruction does not cover its first real
  invocation. Needs the founder to review the prompt
  (`.claude/agents/finance-agent.md`) before it's ever actually run.
  (Paid Ads agent was deleted 2026-07-11 - no longer applicable.)
- `flightGuides.ts`'s FAQ content (now live via the merged SEO PR) makes
  visa/entry-requirement claims (e.g. UK->US ESTA) - already hedged
  ("requirements change, always check current rules") but still worth a
  founder read given the Charter's legal/policy-claim escalation category.
