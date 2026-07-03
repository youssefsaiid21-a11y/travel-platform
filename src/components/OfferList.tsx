"use client";

import { useState, useMemo } from "react";
import { OfferCard, type OfferTag } from "./OfferCard";
import type { NormalizedOffer } from "@/lib/duffel/types";
import styles from "./OfferList.module.css";

type SortKey = "price" | "duration" | "departure";
type StopsFilter = "all" | "nonstop" | "max1";
type RefundFilter = "any" | "refundable";

const SORT_LABELS: Record<SortKey, string> = {
  price: "Cheapest",
  duration: "Fastest",
  departure: "Earliest",
};

const STOPS_LABELS: Record<StopsFilter, string> = {
  all: "Any",
  nonstop: "Non-stop",
  max1: "Max 1 stop",
};

function totalMinutes(offer: NormalizedOffer) {
  return offer.slices.reduce((sum, s) => {
    const h = parseInt(s.duration.match(/(\d+)H/)?.[1] ?? "0");
    const m = parseInt(s.duration.match(/(\d+)M/)?.[1] ?? "0");
    return sum + h * 60 + m;
  }, 0);
}

export function OfferList({
  offers,
  onSelect,
}: {
  offers: NormalizedOffer[];
  onSelect?: (offer: NormalizedOffer) => void;
}) {
  const [sort, setSort] = useState<SortKey>("price");
  const [stops, setStops] = useState<StopsFilter>("all");
  const [refund, setRefund] = useState<RefundFilter>("any");
  const [showAll, setShowAll] = useState(false);

  const VISIBLE = 5;

  const filtered = useMemo(() => {
    let result = [...offers];

    if (stops === "nonstop") {
      result = result.filter((o) => o.slices.every((s) => s.stops === 0));
    } else if (stops === "max1") {
      result = result.filter((o) => o.slices.every((s) => s.stops <= 1));
    }

    if (refund === "refundable") {
      result = result.filter((o) => o.conditions.refundable);
    }

    if (sort === "price") {
      result.sort((a, b) => parseFloat(a.total_amount) - parseFloat(b.total_amount));
    } else if (sort === "duration") {
      result.sort((a, b) => totalMinutes(a) - totalMinutes(b));
    } else if (sort === "departure") {
      result.sort(
        (a, b) =>
          (a.slices[0]?.segments[0]?.departing_at ?? "").localeCompare(
            b.slices[0]?.segments[0]?.departing_at ?? ""
          )
      );
    }

    return result;
  }, [offers, sort, stops, refund]);

  const sortedByPrice = useMemo(
    () => [...offers].sort((a, b) => parseFloat(a.total_amount) - parseFloat(b.total_amount)),
    [offers]
  );

  const cheapestId = sortedByPrice[0]?.id;

  const fastestId = useMemo(
    () => [...offers].sort((a, b) => totalMinutes(a) - totalMinutes(b))[0]?.id,
    [offers]
  );

  const priceRange = useMemo(() => {
    if (sortedByPrice.length < 2) return null;
    const lo = sortedByPrice[0];
    const hi = sortedByPrice[sortedByPrice.length - 1];
    try {
      const fmt = (a: string) => new Intl.NumberFormat("en-GB", {
        style: "currency", currency: lo.total_currency, minimumFractionDigits: 0, maximumFractionDigits: 0,
      }).format(parseFloat(a));
      return `${fmt(lo.total_amount)} – ${fmt(hi.total_amount)}`;
    } catch { return null; }
  }, [sortedByPrice]);

  function getTag(offer: NormalizedOffer): OfferTag | undefined {
    if (offer.id === cheapestId && offer.id === fastestId) return "best";
    if (offer.id === cheapestId) return "cheapest";
    if (offer.id === fastestId) return "fastest";
    return undefined;
  }

  const visible = showAll ? filtered : filtered.slice(0, VISIBLE);

  return (
    <div className={styles.wrapper}>
      <div className={styles.controls} role="toolbar" aria-label="Filter and sort flights">
        <div className={styles.group} role="group" aria-label="Sort by">
          {(["price", "duration", "departure"] as const).map((k) => (
            <button
              key={k}
              className={`${styles.chip} ${sort === k ? styles.active : ""}`}
              onClick={() => setSort(k)}
              aria-pressed={sort === k}
            >
              {SORT_LABELS[k]}
            </button>
          ))}
        </div>
        <div className={styles.divider} aria-hidden="true" />
        <div className={styles.group} role="group" aria-label="Filter by stops">
          {(["all", "nonstop", "max1"] as const).map((k) => (
            <button
              key={k}
              className={`${styles.chip} ${stops === k ? styles.active : ""}`}
              onClick={() => setStops(k)}
              aria-pressed={stops === k}
            >
              {STOPS_LABELS[k]}
            </button>
          ))}
        </div>
        <div className={styles.divider} aria-hidden="true" />
        <button
          className={`${styles.chip} ${refund === "refundable" ? styles.active : ""}`}
          onClick={() => setRefund((r) => r === "refundable" ? "any" : "refundable")}
          aria-pressed={refund === "refundable"}
        >
          Refundable
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className={styles.empty}>
          No flights match{stops !== "all" && refund === "refundable" ? " non-stop refundable" : stops !== "all" ? " your stops filter" : " the refundable filter"} -{" "}
          <button
            className={styles.clearBtn}
            onClick={() => { setStops("all"); setRefund("any"); }}
          >
            clear filters
          </button>
        </div>
      ) : (
        <>
          <div className={styles.count}>
            <span>
              {filtered.length !== offers.length
                ? `${filtered.length} of ${offers.length} flights`
                : `${filtered.length} flight${filtered.length !== 1 ? "s" : ""}`}
            </span>
            {priceRange && <span className={styles.priceRange}>{priceRange}</span>}
          </div>
          {visible.map((offer) => (
            <OfferCard
              key={offer.id}
              offer={offer}
              onSelect={onSelect}
              tag={getTag(offer)}
            />
          ))}
          {!showAll && filtered.length > VISIBLE && (
            <button
              className={styles.showMore}
              onClick={() => setShowAll(true)}
            >
              Show {filtered.length - VISIBLE} more flights ↓
            </button>
          )}
          {showAll && filtered.length > VISIBLE && (
            <button
              className={styles.showLess}
              onClick={() => setShowAll(false)}
            >
              Show fewer ↑
            </button>
          )}
        </>
      )}
    </div>
  );
}
