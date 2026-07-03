// Duffel doesn't expose airline alliance membership anywhere in its offer
// data, so this is a small static lookup keyed by marketing-carrier IATA
// code. Covers the major international carriers in the three global
// alliances; anything not listed here (regional/LCC/charter carriers) is
// bucketed as "Other" rather than guessed at.

export const ALLIANCES = ["Star Alliance", "SkyTeam", "Oneworld", "Other"] as const;

export type Alliance = (typeof ALLIANCES)[number];

const ALLIANCE_BY_CODE: Record<string, Exclude<Alliance, "Other">> = {
  // Star Alliance
  UA: "Star Alliance", // United Airlines
  LH: "Star Alliance", // Lufthansa
  AC: "Star Alliance", // Air Canada
  NH: "Star Alliance", // ANA
  SQ: "Star Alliance", // Singapore Airlines
  TG: "Star Alliance", // Thai Airways
  TK: "Star Alliance", // Turkish Airlines
  LX: "Star Alliance", // Swiss
  OS: "Star Alliance", // Austrian Airlines
  SK: "Star Alliance", // SAS
  CA: "Star Alliance", // Air China
  NZ: "Star Alliance", // Air New Zealand
  AI: "Star Alliance", // Air India
  OZ: "Star Alliance", // Asiana Airlines
  SA: "Star Alliance", // South African Airways
  AV: "Star Alliance", // Avianca
  EN: "Star Alliance", // Air Dolomiti

  // SkyTeam
  DL: "SkyTeam", // Delta Air Lines
  AF: "SkyTeam", // Air France
  KL: "SkyTeam", // KLM
  KE: "SkyTeam", // Korean Air
  AZ: "SkyTeam", // ITA Airways
  SU: "SkyTeam", // Aeroflot
  CI: "SkyTeam", // China Airlines
  MU: "SkyTeam", // China Eastern
  GA: "SkyTeam", // Garuda Indonesia
  VN: "SkyTeam", // Vietnam Airlines
  SV: "SkyTeam", // Saudia
  MF: "SkyTeam", // Xiamen Airlines
  ME: "SkyTeam", // Middle East Airlines

  // Oneworld
  AA: "Oneworld", // American Airlines
  BA: "Oneworld", // British Airways
  IB: "Oneworld", // Iberia
  QF: "Oneworld", // Qantas
  CX: "Oneworld", // Cathay Pacific
  JL: "Oneworld", // Japan Airlines
  QR: "Oneworld", // Qatar Airways
  AY: "Oneworld", // Finnair
  MH: "Oneworld", // Malaysia Airlines
  RJ: "Oneworld", // Royal Jordanian
  UL: "Oneworld", // SriLankan Airlines
};

export function allianceForCarrier(iataCode: string): Alliance {
  return ALLIANCE_BY_CODE[iataCode.toUpperCase()] ?? "Other";
}
