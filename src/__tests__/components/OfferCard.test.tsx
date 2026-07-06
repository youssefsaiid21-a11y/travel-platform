// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { OfferCard } from "@/components/OfferCard";
import type { NormalizedOffer } from "@/lib/duffel/types";

afterEach(() => {
  cleanup();
});

const MOCK_OFFER: NormalizedOffer = {
  id: "off_test_001",
  expires_at: "2026-08-01T12:00:00Z",
  total_amount: "350.00",
  total_currency: "GBP",
  base_amount: "300.00",
  tax_amount: "50.00",
  owner: { iata_code: "BA", name: "British Airways" },
  slices: [
    {
      duration: "PT7H30M",
      stops: 0,
      segments: [
        {
          departing_at: "2026-09-01T08:00:00",
          arriving_at: "2026-09-01T15:30:00",
          duration: "PT7H30M",
          origin: { iata_code: "LHR", name: "Heathrow" },
          destination: { iata_code: "JFK", name: "John F Kennedy" },
          marketing_carrier: { iata_code: "BA", name: "British Airways" },
          operating_carrier: { iata_code: "BA", name: "British Airways" },
          flight_number: "117",
        },
      ],
    },
  ],
  conditions: { refundable: false, changeable: true },
  passengers: [{ id: "pas_test_001", type: "adult" }],
};

function getSelectButton() {
  return screen.getByRole("button", { name: /Select British Airways/i }) as HTMLButtonElement;
}

describe("OfferCard - Select button", () => {
  it("calls onSelect once and shows an instant disabled 'Selecting…' state", () => {
    const onSelect = vi.fn();
    render(<OfferCard offer={MOCK_OFFER} onSelect={onSelect} />);

    const button = getSelectButton();
    expect(button.disabled).toBe(false);
    expect(button.textContent).toContain("Select");

    fireEvent.click(button);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(MOCK_OFFER);
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain("Selecting");
  });

  it("ignores a second click while already selecting", () => {
    const onSelect = vi.fn();
    render(<OfferCard offer={MOCK_OFFER} onSelect={onSelect} />);

    const button = getSelectButton();
    fireEvent.click(button);
    fireEvent.click(button);

    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("re-enables the button instead of leaving it stuck when onSelect throws synchronously", () => {
    // Regression test: onSelect writes to localStorage before navigating
    // (see page.tsx's handleSelectOffer) - if that throws (e.g. Safari
    // private browsing / quota exceeded), the button used to stay
    // permanently disabled with no way to retry short of a page reload.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const onSelect = vi.fn(() => {
      throw new Error("localStorage quota exceeded");
    });
    render(<OfferCard offer={MOCK_OFFER} onSelect={onSelect} />);

    const button = getSelectButton();
    fireEvent.click(button);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(button.disabled).toBe(false);
    expect(button.textContent).toContain("Select");
    expect(button.textContent).not.toContain("Selecting");

    consoleError.mockRestore();
  });
});
