"use client";

import type { PriceCalendarEntry } from "@/lib/duffel/search";
import styles from "./PriceCalendar.module.css";

function formatDay(date: string): string {
  return new Date(date + "T00:00:00Z").toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

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

export function PriceCalendar({
  entries,
  selectedDate,
  onSelectDate,
  disabled,
}: {
  entries: PriceCalendarEntry[];
  selectedDate: string;
  onSelectDate: (date: string) => void;
  disabled?: boolean;
}) {
  const priced = entries.filter((e) => e.cheapestAmount !== null);
  const cheapestAmount = priced.length
    ? Math.min(...priced.map((e) => parseFloat(e.cheapestAmount!)))
    : null;

  return (
    <div className={styles.strip} role="group" aria-label="Prices on nearby dates">
      {entries.map((entry) => {
        const isSelected = entry.date === selectedDate;
        const isCheapest =
          cheapestAmount !== null &&
          entry.cheapestAmount !== null &&
          parseFloat(entry.cheapestAmount) === cheapestAmount;

        const priceLabel =
          entry.cheapestAmount && entry.currency
            ? formatPrice(entry.cheapestAmount, entry.currency)
            : "-";

        return (
          <button
            key={entry.date}
            className={`${styles.day} ${isSelected ? styles.selected : ""} ${isCheapest && !isSelected ? styles.cheapest : ""}`}
            onClick={() => onSelectDate(entry.date)}
            disabled={disabled || isSelected || entry.cheapestAmount === null}
            aria-pressed={isSelected}
            aria-label={`${formatDay(entry.date)}, ${priceLabel}${isCheapest ? " - cheapest date" : ""}`}
          >
            <span className={styles.dayLabel}>{formatDay(entry.date)}</span>
            <span className={styles.dayPrice}>{priceLabel}</span>
            {isCheapest && !isSelected && (
              <span className={styles.cheapestTag} aria-hidden="true">Cheapest</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
