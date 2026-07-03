"use client";

import { useState } from "react";
import { PriceCalendar } from "./PriceCalendar";
import { MonthCalendar } from "./MonthCalendar";
import type { PriceCalendarEntry } from "@/lib/duffel/search";
import type { SearchParams } from "@/lib/parser/types";
import styles from "./PriceCalendarSection.module.css";

// Wraps the default ±3 day PriceCalendar strip with a "view full month"
// toggle. The strip itself (props/behaviour) is untouched - this component
// only adds an expand/collapse affordance around it and lazily fetches the
// month grid on first expand, so a normal search's hot path never pays for a
// month's worth of Duffel calls.
export function PriceCalendarSection({
  entries,
  searchParams,
  selectedDate,
  onSelectDate,
  disabled,
}: {
  entries: PriceCalendarEntry[];
  searchParams: SearchParams;
  selectedDate: string;
  onSelectDate: (date: string) => void;
  disabled?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [monthEntries, setMonthEntries] = useState<PriceCalendarEntry[] | null>(null);
  const [loadingMonth, setLoadingMonth] = useState(false);
  const [monthError, setMonthError] = useState<string | null>(null);

  async function handleExpand() {
    setExpanded(true);
    if (monthEntries || loadingMonth) return;

    setLoadingMonth(true);
    setMonthError(null);
    try {
      const exact = entries.find((e) => e.date === searchParams.departure_date) ?? null;
      const res = await fetch("/api/calendar/month", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          search_params: searchParams,
          ...(exact
            ? { known_exact_date: { cheapestAmount: exact.cheapestAmount, currency: exact.currency } }
            : {}),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { entries: PriceCalendarEntry[] };
      setMonthEntries(data.entries);
    } catch {
      setMonthError("Couldn't load the full month view. Please try again.");
    } finally {
      setLoadingMonth(false);
    }
  }

  if (!expanded) {
    return (
      <div className={styles.section}>
        <PriceCalendar
          entries={entries}
          selectedDate={selectedDate}
          onSelectDate={onSelectDate}
          disabled={disabled}
        />
        <button type="button" className={styles.toggleBtn} onClick={handleExpand} disabled={disabled}>
          View full month ▾
        </button>
      </div>
    );
  }

  return (
    <div className={styles.section}>
      {loadingMonth && <p className={styles.monthStatus}>Loading month view…</p>}
      {monthError && <p className={styles.monthStatus}>{monthError}</p>}
      {monthEntries && (
        <MonthCalendar
          entries={monthEntries}
          monthDate={searchParams.departure_date}
          selectedDate={selectedDate}
          onSelectDate={onSelectDate}
          disabled={disabled}
        />
      )}
      <button
        type="button"
        className={styles.toggleBtn}
        onClick={() => setExpanded(false)}
        disabled={disabled}
      >
        ▴ Collapse to week view
      </button>
    </div>
  );
}
