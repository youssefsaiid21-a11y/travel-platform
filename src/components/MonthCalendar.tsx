"use client";

import type { PriceCalendarEntry } from "@/lib/duffel/search";
import styles from "./MonthCalendar.module.css";

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function formatPrice(amount: string, currency: string): string {
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(parseFloat(amount));
  } catch {
    return `${amount} ${currency}`;
  }
}

function monthLabel(monthDate: string): string {
  return new Date(monthDate + "T00:00:00Z").toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

type Cell = { date: string; dayNum: number } | null;

// Lays out a real month grid (weeks as rows, days as columns), Monday-first -
// unlike PriceCalendar's horizontal ±N day strip. `entries` only needs to
// cover the dates actually priced (getMonthPriceCalendar already omits past
// dates); any day in the month grid without a matching entry renders as a
// disabled, price-less cell rather than being left out of the layout.
export function MonthCalendar({
  entries,
  monthDate,
  selectedDate,
  onSelectDate,
  disabled,
}: {
  entries: PriceCalendarEntry[];
  monthDate: string;
  selectedDate: string;
  onSelectDate: (date: string) => void;
  disabled?: boolean;
}) {
  const [year, month] = monthDate.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  // JS getUTCDay(): 0=Sun..6=Sat. Shift to Monday-first: 0=Mon..6=Sun.
  const firstWeekday = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;

  const cells: Cell[] = [
    ...Array.from({ length: firstWeekday }, (): Cell => null),
    ...Array.from({ length: daysInMonth }, (_, i): Cell => {
      const dayNum = i + 1;
      const date = `${year}-${String(month).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
      return { date, dayNum };
    }),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const byDate = new Map(entries.map((e) => [e.date, e]));
  const priced = entries.filter((e) => e.cheapestAmount !== null);
  const cheapestAmount = priced.length
    ? Math.min(...priced.map((e) => parseFloat(e.cheapestAmount!)))
    : null;

  return (
    <div className={styles.month} role="group" aria-label={`Prices for ${monthLabel(monthDate)}`}>
      <div className={styles.header}>{monthLabel(monthDate)}</div>
      <div className={styles.weekdays} aria-hidden="true">
        {WEEKDAY_LABELS.map((w) => (
          <span key={w} className={styles.weekday}>{w}</span>
        ))}
      </div>
      <div className={styles.grid}>
        {cells.map((cell, i) => {
          if (!cell) {
            return <span key={`empty-${i}`} className={`${styles.cell} ${styles.empty}`} aria-hidden="true" />;
          }

          const entry = byDate.get(cell.date) ?? null;
          const isSelected = cell.date === selectedDate;
          const isCheapest =
            cheapestAmount !== null &&
            entry?.cheapestAmount != null &&
            parseFloat(entry.cheapestAmount) === cheapestAmount;
          const priceLabel =
            entry?.cheapestAmount && entry.currency ? formatPrice(entry.cheapestAmount, entry.currency) : "-";

          return (
            <button
              key={cell.date}
              type="button"
              className={`${styles.cell} ${isSelected ? styles.selected : ""} ${isCheapest && !isSelected ? styles.cheapest : ""}`}
              onClick={() => onSelectDate(cell.date)}
              disabled={disabled || isSelected || !entry || entry.cheapestAmount === null}
              aria-pressed={isSelected}
              aria-label={`${cell.date}, ${priceLabel}${isCheapest ? " - cheapest date this month" : ""}`}
            >
              <span className={styles.dayNum}>{cell.dayNum}</span>
              <span className={styles.dayPrice}>{priceLabel}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
