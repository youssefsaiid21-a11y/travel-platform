import { describe, it, expect } from "vitest";
import { parseBusinessState, readBusinessState } from "@/lib/businessState";

const WELL_FORMED = `# Business State

## North-star metrics
Booking conversion rate: instrumented, no data yet.

## Agent roster status
| Agent | Status | Notes |
|---|---|---|
| Operations | active | \`.claude/agents/operations-agent.md\` - read-only |
| Finance | drafted, NOT activated | needs founder review |

## Harness calibration log
| Date | Blocked action | Resolution | Bucket |
|---|---|---|---|
| 2026-07-09 | \`vercel env add DATABASE_URL\` | Founder approved via AskUserQuestion | Always-confirm |

## Recent autonomous decisions (most recent first)
- 2026-07-10: Shipped the account recovery flow.

## Open escalations (nothing autonomous can resolve without founder input)
- Finance and Paid Ads agents are drafted but not activated.
`;

describe("parseBusinessState", () => {
  it("splits the file into named sections by ## header", () => {
    const result = parseBusinessState(WELL_FORMED);
    expect(Object.keys(result.sections)).toEqual([
      "North-star metrics",
      "Agent roster status",
      "Harness calibration log",
      "Recent autonomous decisions (most recent first)",
      "Open escalations (nothing autonomous can resolve without founder input)",
    ]);
    expect(result.sections["North-star metrics"]).toContain("Booking conversion rate");
  });

  it("parses a well-formed agent roster table into rows", () => {
    const result = parseBusinessState(WELL_FORMED);
    expect(result.agentRoster).toEqual([
      { agent: "Operations", status: "active", notes: "`.claude/agents/operations-agent.md` - read-only" },
      { agent: "Finance", status: "drafted, NOT activated", notes: "needs founder review" },
    ]);
  });

  it("parses a well-formed calibration log table into rows", () => {
    const result = parseBusinessState(WELL_FORMED);
    expect(result.calibrationLog).toEqual([
      {
        date: "2026-07-09",
        blockedAction: "`vercel env add DATABASE_URL`",
        resolution: "Founder approved via AskUserQuestion",
        bucket: "Always-confirm",
      },
    ]);
  });

  it("falls back to null (raw text available separately) when a table row has fewer cells than expected", () => {
    const malformed = `## Agent roster status
| Agent | Status |
|---|---|
| Operations | active |
`;
    const result = parseBusinessState(malformed);
    expect(result.agentRoster).toBeNull();
    expect(result.agentRosterRaw).toContain("Operations");
  });

  it("returns null (not a throw) when a section is missing entirely", () => {
    const result = parseBusinessState("# Business State\n\nNo sections here.\n");
    expect(result.agentRoster).toBeNull();
    expect(result.calibrationLog).toBeNull();
    expect(result.agentRosterRaw).toBe("");
  });

  it("always returns available: true for parseBusinessState (unavailability is only a file-read concern)", () => {
    expect(parseBusinessState("").available).toBe(true);
  });
});

describe("readBusinessState", () => {
  it("reads the real repo file successfully in this environment", () => {
    // Not a fixture - proves the actual .claude/BUSINESS_STATE.md file is
    // readable and produces the two tables this page depends on, without
    // asserting on its exact prose (which changes every session).
    const result = readBusinessState();
    expect(result.available).toBe(true);
    if (result.available) {
      expect(result.sections["Agent roster status"]).toBeTruthy();
    }
  });
});
