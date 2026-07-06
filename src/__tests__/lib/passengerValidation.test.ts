import { describe, it, expect } from "vitest";
import { passengerValidationError } from "@/lib/passengerValidation";

const TODAY = "2026-07-06";

function validPassenger(overrides: Record<string, string> = {}) {
  return {
    given_name: "Jane",
    family_name: "Smith",
    born_on: "1990-01-01",
    phone_number: "+442079460000",
    nationality: "GB",
    passport_number: "123456789",
    passport_expiry: "2035-01-01",
    ...overrides,
  };
}

describe("passengerValidationError", () => {
  it("returns null for a fully valid passenger", () => {
    expect(passengerValidationError(validPassenger(), TODAY)).toBeNull();
  });

  it("rejects a missing given_name", () => {
    expect(passengerValidationError(validPassenger({ given_name: "" }), TODAY)).toMatch(/name.*required/i);
  });

  it("rejects a whitespace-only given_name", () => {
    expect(passengerValidationError(validPassenger({ given_name: "   " }), TODAY)).toMatch(/name.*required/i);
  });

  it("rejects a missing phone number", () => {
    expect(passengerValidationError(validPassenger({ phone_number: "" }), TODAY)).toMatch(/phone/i);
  });

  it("rejects an empty nationality", () => {
    expect(passengerValidationError(validPassenger({ nationality: "" }), TODAY)).toMatch(/nationality/i);
  });

  it("rejects a nationality that isn't a 2-letter ISO code", () => {
    expect(passengerValidationError(validPassenger({ nationality: "United Kingdom" }), TODAY)).toMatch(/nationality/i);
  });

  it("rejects a lowercase nationality code (must be uppercase ISO 3166-1 alpha-2)", () => {
    expect(passengerValidationError(validPassenger({ nationality: "gb" }), TODAY)).toMatch(/nationality/i);
  });

  it("rejects a missing passport number", () => {
    expect(passengerValidationError(validPassenger({ passport_number: "" }), TODAY)).toMatch(/passport number/i);
  });

  it("rejects a whitespace-only passport number", () => {
    expect(passengerValidationError(validPassenger({ passport_number: "   " }), TODAY)).toMatch(/passport number/i);
  });

  it("rejects a missing passport expiry", () => {
    expect(passengerValidationError(validPassenger({ passport_expiry: "" }), TODAY)).toMatch(/expiry/i);
  });

  it("rejects an unparseable passport expiry", () => {
    expect(passengerValidationError(validPassenger({ passport_expiry: "not-a-date" }), TODAY)).toMatch(/expiry/i);
  });

  it("rejects a passport that expires today (must be strictly in the future)", () => {
    expect(passengerValidationError(validPassenger({ passport_expiry: TODAY }), TODAY)).toMatch(/expired/i);
  });

  it("rejects an already-expired passport", () => {
    expect(passengerValidationError(validPassenger({ passport_expiry: "2020-01-01" }), TODAY)).toMatch(/expired/i);
  });

  it("accepts a passport expiring tomorrow", () => {
    expect(passengerValidationError(validPassenger({ passport_expiry: "2026-07-07" }), TODAY)).toBeNull();
  });
});
