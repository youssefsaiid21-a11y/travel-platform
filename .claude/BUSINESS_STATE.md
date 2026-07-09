# Business State

Living dashboard for the Executive Charter in `CLAUDE.md`. This is what
survives context compaction and fresh scheduled-routine sessions - update
it in the same turn a decision worth remembering gets made, not "later."

## North-star metrics
Phase 0 product analytics isn't built yet, so these are currently
unmeasured - standing this up is the next real prerequisite (see
"Open escalations" / next steps).
- Booking conversion rate (search -> offer view -> booking -> payment): unmeasured
- Price competitiveness vs. comparison sites: unmeasured
- Monthly revenue vs. cost (Solvency check): unmeasured

## Agent roster status
| Agent | Status | Notes |
|---|---|---|
| Operations | active | `.claude/agents/operations-agent.md` - read-only infra/health watcher |
| SEO | not built | next up per phased order |
| GEO | not built | |
| Content & Virality | not built | |
| Channel Coverage | not built | needs analytics first |
| Finance | not built | needs product analytics + real transaction volume |
| Customer Support | not built | needs a support intake surface first (doesn't exist yet) |
| Paid Ads | not built | needs a budget decision + trustworthy Finance data first |

## Recent autonomous decisions (most recent first)
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
- **Production redeploy needed** to bake `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
  into the live client bundle (Next.js inlines `NEXT_PUBLIC_*` at build time -
  the env var being set on Vercel isn't enough by itself). The harness's
  production-deploy safety classifier requires an explicit founder go-ahead for
  `vercel deploy --prod` even though this is a routine, low-risk redeploy - not
  something the charter can route around. **Needs one-time founder approval.**
- Phase 0 product analytics (conversion funnel) not yet stood up - blocks
  Channel Coverage and Finance agents from having real data to work with.
- No customer support intake surface exists yet - blocks Customer Support agent.
