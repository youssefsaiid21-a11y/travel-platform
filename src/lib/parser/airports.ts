// Curated map of well-known IATA *metropolitan/city* codes - which cover
// multiple airports and are NOT themselves a single bookable airport - to
// a primary bookable airport code. There are only ~30-40 of these worldwide;
// this is deliberately NOT an attempt at a full ~9,000-entry IATA airport
// allowlist (see nl-parser.ts's Change 2 scope note for why that's out of
// scope). Seeded to be consistent with the primaries already in the system
// prompt's few-shot list.
export const METRO_TO_AIRPORT: Record<string, string> = {
  ROM: "FCO", // Rome (FCO Fiumicino + CIA Ciampino)
  LON: "LHR", // London (LHR/LGW/STN/LTN/LCY/SEN)
  NYC: "JFK", // New York (JFK/EWR/LGA)
  PAR: "CDG", // Paris (CDG/ORY)
  TYO: "NRT", // Tokyo (NRT/HND)
  MIL: "MXP", // Milan (MXP/LIN/BGY)
  WAS: "IAD", // Washington DC (IAD/DCA/BWI)
  BUE: "EZE", // Buenos Aires (EZE/AEP)
  SAO: "GRU", // Sao Paulo (GRU/CGH)
  RIO: "GIG", // Rio de Janeiro (GIG/SDU)
  OSA: "KIX", // Osaka (KIX/ITM)
  BJS: "PEK", // Beijing (PEK/PKX)
  SHA: "PVG", // Shanghai (PVG/SHA)
  SEL: "ICN", // Seoul (ICN/GMP)
  MOW: "SVO", // Moscow (SVO/DME/VKO)
  STO: "ARN", // Stockholm (ARN/BMA/NYO)
  BER: "BER", // Berlin - single-airport metro code, kept as identity for clarity
  CHI: "ORD", // Chicago (ORD/MDW)
  RKV: "KEF", // Reykjavik (KEF/RKV)
  YMQ: "YUL", // Montreal (YUL/YHU)
  YTO: "YYZ", // Toronto (YYZ/YTZ)
};

// Uppercase/slice to 3 chars (matching every existing call site's normalization),
// then map to the primary bookable airport if it's a known metro code, else
// return the code unchanged. Genuinely unknown/garbage codes fall through to
// Duffel's own validation, which route.ts already handles with friendly,
// specific errors - this is not attempting to be a full validator.
export function normalizeAirportCode(code: string): string {
  const upper = code.toUpperCase().slice(0, 3);
  return METRO_TO_AIRPORT[upper] ?? upper;
}
