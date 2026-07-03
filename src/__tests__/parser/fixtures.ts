import type { SearchParams } from "@/lib/parser/types";

export interface Fixture {
  input: string;
  // Partial because some fields (like departure_date for relative dates) are approximate
  expected: Partial<SearchParams> & {
    origin: string;
    destination: string;
    passengers: SearchParams["passengers"];
  };
  description: string;
}

export interface KnowledgeFixture {
  input: string;
  answerContains: string; // substring the answer must include (case-insensitive)
  description: string;
}

// Today for reference - tests use 2026 as the base year
const YEAR = new Date().getFullYear();

export const fixtures: Fixture[] = [
  {
    input: "Fly from London to New York next Friday",
    expected: {
      origin: "LHR",
      destination: "JFK",
      passengers: [{ type: "adult", count: 1 }],
    },
    description: "Basic LHR→JFK, relative date, default 1 adult",
  },
  {
    input: "One-way from LHR to JFK on December 15th 2026",
    expected: {
      origin: "LHR",
      destination: "JFK",
      departure_date: `${YEAR}-12-15`,
      passengers: [{ type: "adult", count: 1 }],
    },
    description: "IATA codes already present, explicit date, one-way",
  },
  {
    input: "Business class return Paris to Dubai, leaving March 10 back March 20",
    expected: {
      origin: "CDG",
      destination: "DXB",
      cabin_class: "business",
      passengers: [{ type: "adult", count: 1 }],
    },
    description: "Business class, round trip, city names",
  },
  {
    input: "Cheapest flight from Singapore to Tokyo sometime in October",
    expected: {
      origin: "SIN",
      destination: "NRT",
      passengers: [{ type: "adult", count: 1 }],
    },
    description: "Flexible date (sometime in October) - flexible_date_note should be set",
  },
  {
    input: "Two adults economy, London to Barcelona on August 5th",
    expected: {
      origin: "LHR",
      destination: "BCN",
      cabin_class: "economy",
      passengers: [{ type: "adult", count: 2 }],
    },
    description: "2 adult passengers, economy, city names",
  },
  {
    input: "Non-stop from Sydney to London business class",
    expected: {
      origin: "SYD",
      destination: "LHR",
      max_connections: 0,
      cabin_class: "business",
      passengers: [{ type: "adult", count: 1 }],
    },
    description: "Non-stop only (max_connections: 0), business class",
  },
  {
    input: "Return from CDG to BKK July 1st back July 15th",
    expected: {
      origin: "CDG",
      destination: "BKK",
      passengers: [{ type: "adult", count: 1 }],
    },
    description: "Round trip, IATA codes, both dates present",
  },
  {
    input: "3 passengers Toronto to Amsterdam in economy",
    expected: {
      origin: "YYZ",
      destination: "AMS",
      cabin_class: "economy",
      passengers: [{ type: "adult", count: 3 }],
    },
    description: "3 adults, city names to IATA",
  },
  {
    input: "Fly me from Berlin to Lisbon this weekend, return Sunday",
    expected: {
      origin: "BER",
      destination: "LIS",
      passengers: [{ type: "adult", count: 1 }],
    },
    description: "Berlin→Lisbon, weekend relative date, round trip implied",
  },
  {
    input: "NYC to LA on the 20th, just one way",
    expected: {
      // NYC maps to JFK, LGA, or EWR - test accepts any; mock returns JFK
      origin: "JFK",
      destination: "LAX",
      passengers: [{ type: "adult", count: 1 }],
    },
    description: "NYC (JFK/LGA/EWR) to LAX, explicit one-way - no return_date",
  },
];

export const knowledgeFixtures: KnowledgeFixture[] = [
  {
    input: "Do I need a visa to visit Japan as a UK citizen?",
    answerContains: "japan",
    description: "Visa question - should trigger answer_travel_question, not flight search",
  },
  {
    input: "What is the best time of year to visit Thailand?",
    answerContains: "thailand",
    description: "Destination question - should trigger answer_travel_question",
  },
  {
    input: "How many kg of luggage can I bring on economy flights?",
    answerContains: "kg",
    description: "Baggage policy question - should trigger answer_travel_question",
  },
];
