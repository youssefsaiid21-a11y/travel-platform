// Curated list of popular international destinations used by "explore
// anywhere" search - Duffel has no wildcard/anywhere query, so we fan out
// parallel searches against this fixed list instead. A reasonable spread
// across regions/continents so results feel like genuine "anywhere" options
// rather than one corner of the map.
export interface PopularDestination {
  iata: string;
  city: string;
  country: string;
  region: string;
}

export const POPULAR_DESTINATIONS: PopularDestination[] = [
  { iata: "JFK", city: "New York", country: "United States", region: "North America" },
  { iata: "LAX", city: "Los Angeles", country: "United States", region: "North America" },
  { iata: "YYZ", city: "Toronto", country: "Canada", region: "North America" },
  { iata: "MEX", city: "Mexico City", country: "Mexico", region: "North America" },
  { iata: "GRU", city: "São Paulo", country: "Brazil", region: "South America" },
  { iata: "CDG", city: "Paris", country: "France", region: "Europe" },
  { iata: "BCN", city: "Barcelona", country: "Spain", region: "Europe" },
  { iata: "MAD", city: "Madrid", country: "Spain", region: "Europe" },
  { iata: "AMS", city: "Amsterdam", country: "Netherlands", region: "Europe" },
  { iata: "FCO", city: "Rome", country: "Italy", region: "Europe" },
  { iata: "LIS", city: "Lisbon", country: "Portugal", region: "Europe" },
  { iata: "BER", city: "Berlin", country: "Germany", region: "Europe" },
  { iata: "ATH", city: "Athens", country: "Greece", region: "Europe" },
  { iata: "IST", city: "Istanbul", country: "Turkey", region: "Europe" },
  { iata: "DXB", city: "Dubai", country: "United Arab Emirates", region: "Middle East" },
  { iata: "DOH", city: "Doha", country: "Qatar", region: "Middle East" },
  { iata: "BKK", city: "Bangkok", country: "Thailand", region: "Asia" },
  { iata: "SIN", city: "Singapore", country: "Singapore", region: "Asia" },
  { iata: "NRT", city: "Tokyo", country: "Japan", region: "Asia" },
  { iata: "HKG", city: "Hong Kong", country: "Hong Kong", region: "Asia" },
  { iata: "DEL", city: "Delhi", country: "India", region: "Asia" },
  { iata: "SYD", city: "Sydney", country: "Australia", region: "Oceania" },
  { iata: "AKL", city: "Auckland", country: "New Zealand", region: "Oceania" },
  { iata: "CPT", city: "Cape Town", country: "South Africa", region: "Africa" },
  { iata: "CAI", city: "Cairo", country: "Egypt", region: "Africa" },
];
