// First slice of programmatic SEO landing pages, per the SEO agent's audit.
// Scoped small and real (3 routes) rather than generating dozens at once -
// expand this list in a future pass once these prove out.
export interface FlightGuide {
  slug: string;
  origin: string;
  destination: string;
  originCity: string;
  destinationCity: string;
  originAirport: string;
  destinationAirport: string;
  query: string;
  intro: string;
  faqs: { q: string; a: string }[];
}

export const FLIGHT_GUIDES: FlightGuide[] = [
  {
    slug: "london-to-new-york",
    origin: "LHR",
    destination: "JFK",
    originCity: "London",
    destinationCity: "New York",
    originAirport: "Heathrow (LHR)",
    destinationAirport: "John F. Kennedy International (JFK)",
    query: "London to New York next Friday",
    intro:
      "London to New York is one of the busiest transatlantic routes, flown by multiple airlines with several non-stop departures a day.",
    faqs: [
      {
        q: "How long is the flight from London to New York?",
        a: "A non-stop flight from London Heathrow to New York JFK typically takes around 8 hours westbound, and closer to 7 hours on the return eastbound leg due to the jet stream.",
      },
      {
        q: "Do I need a visa to fly from London to New York?",
        a: "UK citizens typically travel to the US under the ESTA visa waiver program rather than a visa, but requirements change - always check current entry requirements for your nationality before booking.",
      },
      {
        q: "What's the time difference between London and New York?",
        a: "New York is normally 5 hours behind London, though this can shift by an hour around UK/US daylight saving transitions, which don't happen on the same dates.",
      },
    ],
  },
  {
    slug: "dubai-to-bangkok",
    origin: "DXB",
    destination: "BKK",
    originCity: "Dubai",
    destinationCity: "Bangkok",
    originAirport: "Dubai International (DXB)",
    destinationAirport: "Suvarnabhumi (BKK)",
    query: "Dubai to Bangkok next month",
    intro:
      "Dubai to Bangkok is a well-served route connecting the Middle East and Southeast Asia, with several non-stop options daily.",
    faqs: [
      {
        q: "How long is the flight from Dubai to Bangkok?",
        a: "A non-stop flight from Dubai to Bangkok takes around 6 hours.",
      },
      {
        q: "What's the time difference between Dubai and Bangkok?",
        a: "Bangkok is normally 3 hours ahead of Dubai - neither city observes daylight saving time, so this gap stays constant year-round.",
      },
    ],
  },
  {
    slug: "paris-to-tokyo",
    origin: "CDG",
    destination: "NRT",
    originCity: "Paris",
    destinationCity: "Tokyo",
    originAirport: "Charles de Gaulle (CDG)",
    destinationAirport: "Narita International (NRT)",
    query: "Paris to Tokyo business class",
    intro:
      "Paris to Tokyo is a long-haul route typically flown non-stop by major European and Japanese carriers.",
    faqs: [
      {
        q: "How long is the flight from Paris to Tokyo?",
        a: "A non-stop flight from Paris CDG to Tokyo Narita takes around 12 hours outbound, and around 11.5 hours on the return leg.",
      },
      {
        q: "Do I need a visa to fly from Paris to Tokyo?",
        a: "Requirements vary by nationality and change over time - always check current entry requirements before booking rather than relying on a general rule.",
      },
    ],
  },
];

export function getFlightGuide(slug: string): FlightGuide | undefined {
  return FLIGHT_GUIDES.find((g) => g.slug === slug);
}
