import fs from "node:fs";
import path from "node:path";

// Reads .claude/BUSINESS_STATE.md live rather than duplicating its content
// into a second, structured file that would need to be kept in sync by
// hand - this project has already been burned twice by exactly that kind
// of two-sources-of-truth drift (see CLAUDE.md's own scope-drift note and
// the Parallel Agent Protocol postmortem). The tradeoff is that markdown
// parsing is a bit brittle against a hand-edited file - each table parser
// below falls back to raw text rather than crashing or silently dropping
// a section if the file's shape ever drifts from what's expected here.

export interface AgentRosterRow {
  agent: string;
  status: string;
  notes: string;
}

export interface CalibrationLogRow {
  date: string;
  blockedAction: string;
  resolution: string;
  bucket: string;
}

export interface BusinessState {
  available: true;
  sections: Record<string, string>;
  agentRoster: AgentRosterRow[] | null;
  agentRosterRaw: string;
  calibrationLog: CalibrationLogRow[] | null;
  calibrationLogRaw: string;
}

export interface BusinessStateUnavailable {
  available: false;
  error: string;
}

const SECTION_HEADER_RE = /^## (.+)$/gm;

function splitIntoSections(raw: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const matches = [...raw.matchAll(SECTION_HEADER_RE)];

  for (let i = 0; i < matches.length; i++) {
    const title = matches[i][1].trim();
    const start = matches[i].index! + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : raw.length;
    sections[title] = raw.slice(start, end).trim();
  }

  return sections;
}

// Splits a markdown pipe-table into cell rows, skipping the header and the
// `|---|---|` separator row. Returns null (triggering the raw-text
// fallback in the caller) if fewer than `expectedColumns` cells are found
// in any data row - a cheap, cross-checkable signal that the section's
// shape no longer matches what this parser expects, rather than silently
// misrendering a reformatted table.
function parseMarkdownTable(sectionText: string, expectedColumns: number): string[][] | null {
  const lines = sectionText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("|"));

  if (lines.length < 2) return null;

  const rows = lines
    .slice(1) // drop header row
    .filter((l) => !/^\|[\s-:|]+\|$/.test(l)) // drop the |---|---| separator
    .map((line) =>
      line
        .split("|")
        .slice(1, -1) // markdown tables have leading/trailing "|"
        .map((cell) => cell.trim())
    );

  if (rows.some((row) => row.length < expectedColumns)) return null;

  return rows;
}

// Pure - kept separate from the fs read below so it's directly unit
// testable against fixture strings, with no need to mock the filesystem.
export function parseBusinessState(raw: string): BusinessState {
  const sections = splitIntoSections(raw);

  const agentRosterRaw = sections["Agent roster status"] ?? "";
  const agentRosterTable = parseMarkdownTable(agentRosterRaw, 3);
  const agentRoster = agentRosterTable
    ? agentRosterTable.map(([agent, status, notes]) => ({ agent, status, notes }))
    : null;

  const calibrationLogRaw = sections["Harness calibration log"] ?? "";
  const calibrationTable = parseMarkdownTable(calibrationLogRaw, 4);
  const calibrationLog = calibrationTable
    ? calibrationTable.map(([date, blockedAction, resolution, bucket]) => ({
        date,
        blockedAction,
        resolution,
        bucket,
      }))
    : null;

  return {
    available: true,
    sections,
    agentRoster,
    agentRosterRaw,
    calibrationLog,
    calibrationLogRaw,
  };
}

export function readBusinessState(): BusinessState | BusinessStateUnavailable {
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), ".claude/BUSINESS_STATE.md"), "utf-8");
    return parseBusinessState(raw);
  } catch (err) {
    return {
      available: false,
      error: err instanceof Error ? err.message : "Unknown error reading BUSINESS_STATE.md",
    };
  }
}
