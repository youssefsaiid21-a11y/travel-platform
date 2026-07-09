// First slice of the content section, per the Content & Virality agent's
// mandate. Two real, fully-written posts - not just topic titles. Facts
// checked against CLAUDE.md: describes the actual checkpoint/confirm flow,
// real Duffel-sourced fares, and uses "300+ airlines" (matching the GEO
// agent's correction elsewhere), never "500+".
export interface Guide {
  slug: string;
  title: string;
  description: string;
  body: string[]; // paragraphs
}

export const GUIDES: Guide[] = [
  {
    slug: "how-orbi-flight-search-works",
    title: "How Orbi's AI Flight Search Actually Works",
    description:
      "A plain-English look at what happens between typing a search and seeing real flight offers.",
    body: [
      `Most flight search tools make you fill in a form: origin, destination, dates, passengers, cabin class, all as separate fields. Orbi works differently - you type what you want in plain English, like "London to New York next Friday" or "cheap flights from London this weekend, anywhere," and an AI model parses that into a structured search.`,
      `Before Orbi actually searches, it shows you a checkpoint: "here's what we understood" - the parsed origin, destination, dates, and passenger count - and asks you to confirm or edit it. This exists because natural-language parsing isn't perfect, and it's better to catch a misunderstood date or destination before spending time on a search than after.`,
      `Once you confirm, Orbi searches real flight data - not cached or simulated results - across 300+ airlines. The current deployment runs against a Duffel sandbox environment rather than live production airline inventory, so prices and availability reflect Duffel's test data rather than what you'd see booking directly with an airline today.`,
      `If you book, the same "show the real price, then confirm" pattern applies again before any payment is taken - you see an itemized price breakdown and have to explicitly confirm before a charge happens. Payment itself runs through Stripe, currently in test mode in this deployment.`,
      `Passenger details (name, date of birth, passport information) can be saved once to your account, so a repeat booking doesn't require re-typing everything - a good example of Orbi optimizing for making booking as fast and frictionless as possible, which is the core thing it's trying to do well.`,
    ],
  },
  {
    slug: "london-to-new-york-flight-guide",
    title: "London to New York (LHR to JFK): A Practical Flight Guide",
    description:
      "Flight time, time zones, and the practical basics for planning a London-New York trip.",
    body: [
      `London to New York is one of the busiest and most competitive long-haul routes in the world, served by multiple airlines with several non-stop departures a day between Heathrow (LHR) and John F. Kennedy International (JFK).`,
      `A non-stop flight typically takes around 8 hours westbound (London to New York) and around 7 hours on the return eastbound leg - the difference is real and comes from the jet stream, a fast-moving band of high-altitude wind that flows west-to-east and works against westbound flights while helping eastbound ones.`,
      `New York is normally 5 hours behind London, but this isn't fixed year-round: the UK and US don't switch to and from daylight saving time on the same dates, so for a few weeks each spring and autumn the gap is briefly 4 hours instead of 5. Worth double-checking against the actual dates of your trip rather than assuming.`,
      `Entry requirements change over time and depend on your nationality - UK citizens have historically been able to travel to the US under the ESTA visa waiver program for short visits rather than needing a full visa, but you should always verify current requirements for your specific nationality and trip purpose before booking, rather than relying on a general rule.`,
      `Airlines flying this route non-stop include British Airways, American Airlines, Virgin Atlantic, and Delta, among others - real-time options, prices, and schedules are what you'll see when you actually search rather than a fixed list, since availability changes constantly.`,
    ],
  },
];

export function getGuide(slug: string): Guide | undefined {
  return GUIDES.find((g) => g.slug === slug);
}
