# Channel Plan

Owned by the Channel Coverage agent (`.claude/agents/channel-coverage-agent.md`).
Last revised: 2026-07-09. Update the date whenever this changes - don't let
it go stale silently.

No ad budget exists yet - paid channels are explicitly out of scope here
(that's the Paid Ads agent's job, gated on a founder budget decision).
Vercel Analytics (`search_completed`, `offer_selected`, `booking_completed`,
now with `channel` attribution via a first-touch `orbi_channel` cookie) was
just added this session - there is no real traffic data yet, so channel
prioritization below is based on cost/effort/fit, not measured performance.

| Channel | Status | Next concrete action | Owner |
|---|---|---|---|
| Organic search (SEO) | Active | 3 `/flights/[slug]` landing pages shipped (PR #2) - expand to more popular routes once these show any traffic | SEO agent |
| AI answer engines (GEO) | Active | `llms.txt` + JSON-LD + a corrected airline-count claim shipped (PR #1) - re-check quarterly for stale claims | GEO agent |
| Content (guides/blog) | Active | 2 posts shipped (PR #3) - expand once there's a signal for which topics get traffic | Content & Virality agent |
| Referral/sharing | Active | ShareButtons improved (site link, email, native share) - a referral incentive is a pricing decision, escalated to founder, not built | Content & Virality agent |
| Product Hunt | Not started | ~30-day prep window recommended before launch; a Fri/Sat/Sun launch day gives better #1-badge odds than Tuesday for a pre-audience solo founder (max traffic day, but also max competition) - needs `og:image` (shipped this pass) and a compelling first-comment draft | Founder (launch requires a real account/submission - not something an agent should do autonomously) |
| Reddit (r/flights, r/travel, r/digitalnomad, r/solotravel) | Not started | These are genuinely active, on-topic communities - contribute as a real community member answering questions, not a promotional post, or it gets removed and burns the account's standing | Founder (community reputation is personal, not something to automate) |
| X/Twitter | Not started | No account presence yet - lowest priority until organic/GEO channels show traction, since it needs ongoing manual engagement to work | Founder |
| Paid ads (Google/Meta) | Explicitly out of scope | Needs a founder budget decision first | Paid Ads agent (not yet activated) |

## Single-channel-dependency risk
Right now, everything active is organic-search/AI-answer-engine adjacent
(SEO + GEO + Content). That's a reasonable place to start (zero cost,
compounds over time) but it's not diversified - Product Hunt and community
engagement are the next real breadth additions, and both require the
founder directly (account reputation, launch timing judgment) rather than
being agent-automatable.
