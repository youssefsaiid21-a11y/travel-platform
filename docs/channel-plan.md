# Channel Plan

Owned by the Channel Coverage agent (`.claude/agents/channel-coverage-agent.md`).
Last revised: 2026-07-09. Update the date whenever this changes - don't let
it go stale silently.

No ad budget exists yet - paid channels are explicitly out of scope here.
No agent currently owns this (the Paid Ads agent was deleted 2026-07-11,
drafted-only and never activated); revisit if paid acquisition becomes a
priority.
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
| Waitlist/email capture | Built, migration pending founder approval | `WaitlistSignup` model + `/api/waitlist` + a `WaitlistForm` embedded on every flight-guide and content-guide page shipped 2026-07-09 - converts pre-launch organic/GEO readers who aren't ready to book yet into a contactable list. Needs the same DB-migration sign-off `SupportTicket` got before it's live. | Orchestration (built directly this pass) |
| Product Hunt | Dated, copy drafted | **Target launch day: Friday 2026-08-07** (~30-day prep window from today, Fri/Sat/Sun gives better #1-badge odds for a pre-audience solo founder). `og:image` already shipped. First-comment copy drafted below - founder to review, tweak in your own voice, and post (their account, their identity - not delegable). | Founder |
| Reddit (r/flights, r/travel, r/digitalnomad, r/solotravel) | Dated, copy drafted | Draft posts below for r/travel and r/digitalnomad - post as a genuine community answer/share, not a promotional blast, or it gets removed and burns the account's standing. Target: 1-2 weeks before Product Hunt day (~2026-07-24 onward), spaced out, not all at once. | Founder |
| X/Twitter | Not started | No account presence yet - lowest priority until organic/GEO channels show traction, since it needs ongoing manual engagement to work | Founder |
| Paid ads (Google/Meta) | Explicitly out of scope | Needs a founder budget decision first | No agent (deleted 2026-07-11) |

## Single-channel-dependency risk
Everything currently *live* is organic-search/AI-answer-engine adjacent
(SEO + GEO + Content). That's a reasonable place to start (zero cost,
compounds over time) but it's not diversified on its own - Product Hunt,
community engagement, and the new waitlist capture are the real breadth
additions for launch day. PH/Reddit specifically require the founder
directly (account reputation, launch timing judgment) rather than being
agent-automatable - drafted below so posting is a five-minute task, not a
from-scratch writing task.

---

## Product Hunt - first-comment draft (founder to post as the maker)

> Hey Product Hunt! 👋
>
> I built Orbi because searching for flights still means juggling five
> tabs and decoding a dozen fare rules before you actually know what
> you're paying. Orbi is a flight search that understands plain English -
> "cheapest flight from London to Tokyo in March, one stopover max" - and
> books it in one flow, powered by real airline inventory (Duffel).
>
> A few things I'd love feedback on:
> - Does the "explore anywhere" mode (say "surprise me" or "cheap flights
>   from London, anywhere" and get a ranked list of destinations) feel
>   useful or gimmicky?
> - Is the plain-English search actually faster than a normal flight
>   search form for you, or does it just feel that way?
>
> It's a solo build, still early, and I'm around all day to answer
> questions and take feedback directly. Thanks for taking a look!

*(Founder: personalize the tone/details before posting - this is a
starting draft, not a script.)*

## Reddit drafts (founder to post, spaced out, not same-day)

**r/travel or r/digitalnomad** (as a genuine share, not a promo post -
check each subreddit's self-promotion rules first):

> Title: Built a flight search tool that takes plain-English queries
> (e.g. "cheapest flight London to Bangkok in Feb, one stop max") -
> curious what this community thinks
>
> Body: I got tired of flight search sites making me manually filter
> through stops/dates/prices, so I built Orbi - you describe what you
> want in plain English and it searches real airline fares (via Duffel)
> and books it. Still early and solo-built. If you try it, I'd genuinely
> love to know what's confusing or missing - not trying to sell anything,
> just looking for real feedback from people who actually book a lot of
> flights.

**r/solotravel / r/flights** (answer-style, only in response to a relevant
existing thread - e.g. someone asking "best way to find cheap flights" -
do not start a new promotional thread in these two):

> If you want to skip manually checking fare calendars, I built a tool
> (Orbi) that takes a plain-English request like "flights from Berlin,
> anywhere, under $300" and ranks real fares for you. Not affiliated with
> any airline, just a flight-search side project - happy to answer
> questions about how it works.
