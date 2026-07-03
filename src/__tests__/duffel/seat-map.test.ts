import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/duffel/client", () => ({
  duffelRequest: vi.fn(),
  requestLog: [],
}));

import { duffelRequest } from "@/lib/duffel/client";
import { getSeatMap } from "@/lib/duffel/search";

function makeRawSeatMap(overrides: Record<string, unknown> = {}) {
  return {
    id: "sea_1",
    segment_id: "seg_1",
    slice_id: "sli_1",
    cabins: [
      {
        cabin_class: "economy",
        deck: 0,
        aisles: 1,
        rows: [
          {
            sections: [
              {
                elements: [
                  {
                    type: "seat",
                    designator: "1A",
                    name: "",
                    disclosures: [],
                    available_services: [
                      {
                        id: "ase_1",
                        passenger_id: "pas_1",
                        total_amount: "15.00",
                        total_currency: "GBP",
                      },
                    ],
                  },
                  { type: "aisle" },
                  {
                    type: "seat",
                    designator: "1B",
                    name: "",
                    disclosures: ["No extra legroom"],
                    available_services: [],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(duffelRequest).mockReset();
});

describe("getSeatMap", () => {
  it("requests offer_id and normalizes cabins/rows/sections/elements", async () => {
    vi.mocked(duffelRequest).mockResolvedValueOnce([makeRawSeatMap()]);

    const seatMaps = await getSeatMap("off_1");

    expect(vi.mocked(duffelRequest)).toHaveBeenCalledWith(
      "/air/seat_maps",
      expect.objectContaining({ params: { offer_id: "off_1" } })
    );

    expect(seatMaps).toHaveLength(1);
    expect(seatMaps[0]).toMatchObject({
      id: "sea_1",
      segmentId: "seg_1",
      sliceId: "sli_1",
    });

    const elements = seatMaps[0].cabins[0].rows[0].sections[0].elements;
    expect(elements).toEqual([
      {
        type: "seat",
        designator: "1A",
        available: true,
        disclosures: [],
        options: [
          { serviceId: "ase_1", passengerId: "pas_1", amount: "15.00", currency: "GBP" },
        ],
      },
      {
        type: "aisle",
        designator: undefined,
        available: false,
        disclosures: [],
        options: [],
      },
      {
        type: "seat",
        designator: "1B",
        available: false,
        disclosures: ["No extra legroom"],
        options: [],
      },
    ]);
  });

  it("returns an empty array (not a crash) when the fare doesn't support seat selection", async () => {
    vi.mocked(duffelRequest).mockResolvedValueOnce([]);

    const seatMaps = await getSeatMap("off_1");
    expect(seatMaps).toEqual([]);
  });

  it("tolerates a null/undefined data payload from Duffel", async () => {
    vi.mocked(duffelRequest).mockResolvedValueOnce(undefined);

    const seatMaps = await getSeatMap("off_1");
    expect(seatMaps).toEqual([]);
  });

  it("defensively normalizes malformed/partial seat map data without crashing", async () => {
    const malformed = makeRawSeatMap({
      cabins: [
        {
          // no cabin_class - should just be omitted, not crash
          deck: 0,
          aisles: 1,
          // rows missing entirely
        },
      ],
    });
    vi.mocked(duffelRequest).mockResolvedValueOnce([malformed]);

    const seatMaps = await getSeatMap("off_1");
    expect(seatMaps[0].cabins[0]).toEqual({
      cabinClass: undefined,
      deck: 0,
      aisles: 1,
      rows: [],
    });
  });

  it("defensively normalizes a row/section with missing sections/elements arrays", async () => {
    const malformed = makeRawSeatMap({
      cabins: [
        {
          cabin_class: "economy",
          deck: 0,
          aisles: 1,
          rows: [{}, { sections: [{}] }],
        },
      ],
    });
    vi.mocked(duffelRequest).mockResolvedValueOnce([malformed]);

    const seatMaps = await getSeatMap("off_1");
    expect(seatMaps[0].cabins[0].rows).toEqual([
      { sections: [] },
      { sections: [{ elements: [] }] },
    ]);
  });

  it("treats a seat element with no designator as unavailable rather than crashing", async () => {
    const malformed = makeRawSeatMap({
      cabins: [
        {
          cabin_class: "economy",
          deck: 0,
          aisles: 1,
          rows: [
            {
              sections: [
                {
                  elements: [
                    {
                      type: "seat",
                      available_services: [
                        { id: "ase_x", passenger_id: "pas_1", total_amount: "5.00", total_currency: "GBP" },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    vi.mocked(duffelRequest).mockResolvedValueOnce([malformed]);

    const seatMaps = await getSeatMap("off_1");
    const el = seatMaps[0].cabins[0].rows[0].sections[0].elements[0];
    expect(el.designator).toBeUndefined();
    // Still "seat" type with services, but the UI can't render a click
    // target without a designator - normalization surfaces the raw options
    // as-is and lets the component decide how to render it defensively.
    expect(el.type).toBe("seat");
    expect(el.options).toHaveLength(1);
  });
});
