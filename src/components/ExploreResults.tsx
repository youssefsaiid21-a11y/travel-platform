"use client";

import type { ExploreDestinationResult } from "@/lib/parser/types";
import styles from "./ExploreResults.module.css";

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

// Renders the ranked "cheapest destinations from your city" list returned by
// explore-anywhere mode. Clicking a card starts a normal single-destination
// search (via onSelect) - the same underlying search that produced this
// card's price, so the price shown is exactly what that search will return.
export function ExploreResults({
  results,
  onSelect,
  disabled,
}: {
  results: ExploreDestinationResult[];
  onSelect: (destination: string) => void;
  disabled?: boolean;
}) {
  if (results.length === 0) return null;

  return (
    <div className={styles.grid} role="list" aria-label="Cheapest destinations">
      {results.map((r, i) => (
        <button
          key={r.destination}
          type="button"
          role="listitem"
          className={styles.card}
          onClick={() => onSelect(r.destination)}
          disabled={disabled}
        >
          <span className={styles.rank}>#{i + 1}</span>
          <span className={styles.city}>{r.city}</span>
          <span className={styles.country}>{r.country} · {r.destination}</span>
          <span className={styles.price}>{formatPrice(r.cheapestAmount, r.currency)}</span>
          <span className={styles.airline}>{r.airline}</span>
        </button>
      ))}
    </div>
  );
}
