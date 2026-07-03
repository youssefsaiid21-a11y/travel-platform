import { describe, it, expect } from "vitest";
import { allianceForCarrier, ALLIANCES } from "@/lib/airlines/alliances";

describe("allianceForCarrier", () => {
  it("maps well-known Star Alliance carriers", () => {
    expect(allianceForCarrier("LH")).toBe("Star Alliance");
    expect(allianceForCarrier("UA")).toBe("Star Alliance");
  });

  it("maps well-known SkyTeam carriers", () => {
    expect(allianceForCarrier("DL")).toBe("SkyTeam");
    expect(allianceForCarrier("AF")).toBe("SkyTeam");
  });

  it("maps well-known Oneworld carriers", () => {
    expect(allianceForCarrier("BA")).toBe("Oneworld");
    expect(allianceForCarrier("AA")).toBe("Oneworld");
  });

  it("falls back to Other for carriers not in the lookup table", () => {
    expect(allianceForCarrier("FR")).toBe("Other"); // Ryanair - no alliance
    expect(allianceForCarrier("ZZ")).toBe("Other"); // Duffel's sandbox test airline
  });

  it("is case-insensitive on the IATA code", () => {
    expect(allianceForCarrier("ba")).toBe("Oneworld");
  });

  it("exposes the full set of alliance buckets including Other", () => {
    expect(ALLIANCES).toEqual(["Star Alliance", "SkyTeam", "Oneworld", "Other"]);
  });
});
