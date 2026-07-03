"use client";

import { useState } from "react";
import type {
  NormalizedOffer,
  NormalizedSeatElement,
  NormalizedSeatMap,
  NormalizedService,
} from "@/lib/duffel/types";
import styles from "./OfferCard.module.css";

export type OfferTag = "cheapest" | "fastest" | "best";

const TAG_LABELS: Record<OfferTag, string> = {
  cheapest: "Cheapest",
  fastest: "Fastest",
  best: "Best",
};

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

function formatDuration(iso: string) {
  const h = iso.match(/(\d+)H/)?.[1];
  const m = iso.match(/(\d+)M/)?.[1];
  return [h ? `${h}h` : "", m ? `${m}m` : ""].filter(Boolean).join(" ");
}

function isNextDay(dep: string, arr: string) {
  return new Date(arr).toDateString() !== new Date(dep).toDateString();
}

function fmtLayover(dep: string, arr: string): string {
  const mins = Math.round((new Date(dep).getTime() - new Date(arr).getTime()) / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatPrice(amount: string, currency: string) {
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
    }).format(parseFloat(amount));
  } catch {
    return `${amount} ${currency}`;
  }
}

// "Outbound"/"Return" only applies to an actual round trip on the same city
// pair - 2 slices where the second exactly reverses the first (B→A after A→B).
// A 2-slice open-jaw multi-city trip (e.g. LHR→CDG, then FCO→LHR days later)
// also has 2 slices and ends back at the origin, but isn't the same route
// reversed, so it must not get "Outbound"/"Return" labels either.
function sliceLabels(offer: NormalizedOffer): Array<string | undefined> {
  const { slices } = offer;
  if (slices.length === 1) return [undefined];

  const outboundOrigin = slices[0].segments[0].origin.iata_code;
  const outboundLastSeg = slices[0].segments[slices[0].segments.length - 1];
  const outboundDestination = outboundLastSeg.destination.iata_code;

  const returnOrigin = slices[1].segments[0].origin.iata_code;
  const returnLastSeg = slices[1].segments[slices[1].segments.length - 1];
  const returnDestination = returnLastSeg.destination.iata_code;

  const isRoundTrip =
    slices.length === 2 &&
    returnOrigin === outboundDestination &&
    returnDestination === outboundOrigin;

  return slices.map((slice, i) => {
    const date = formatDate(slice.segments[0].departing_at);
    if (isRoundTrip) return i === 0 ? `Outbound · ${date}` : `Return · ${date}`;
    return `Flight ${i + 1} · ${date}`;
  });
}

// Returns the "· £75 fee" suffix when Duffel discloses a non-zero penalty
// amount, otherwise "" so the badge falls back to its plain label.
function feeSuffix(fee: NormalizedOffer["conditions"]["refundFee"]): string {
  if (!fee || parseFloat(fee.amount) === 0) return "";
  return ` · ${formatPrice(fee.amount, fee.currency)} fee`;
}

function baggageSummary(offer: NormalizedOffer): string | null {
  const bag = offer.includedBaggage;
  if (!bag) return null;
  const parts: string[] = [];
  if (bag.checked > 0) {
    parts.push(`${bag.checked} checked bag${bag.checked > 1 ? "s" : ""} included`);
  } else {
    parts.push("No checked bag included");
  }
  if (bag.carryOn > 0) {
    parts.push(`${bag.carryOn} carry-on${bag.carryOn > 1 ? "s" : ""}`);
  }
  return parts.join(" · ");
}

type ServicesState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; services: NormalizedService[] }
  | { status: "error" };

function BagSeatOptions({ offerId }: { offerId: string }) {
  const [expanded, setExpanded] = useState(false);
  const [state, setState] = useState<ServicesState>({ status: "idle" });

  async function toggle() {
    const next = !expanded;
    setExpanded(next);
    if (next && (state.status === "idle" || state.status === "error")) {
      setState({ status: "loading" });
      try {
        const res = await fetch(`/api/offers/${offerId}/services`);
        if (!res.ok) throw new Error("request failed");
        const data = (await res.json()) as { services: NormalizedService[] };
        setState({ status: "loaded", services: data.services });
      } catch {
        setState({ status: "error" });
      }
    }
  }

  return (
    <div className={styles.bagSeatOptions}>
      <button
        className={styles.expandBtn}
        onClick={toggle}
        aria-expanded={expanded}
      >
        {expanded ? "Hide" : "View"} bag & seat options
      </button>
      {expanded && (
        <div className={styles.servicesList} aria-live="polite">
          {state.status === "loading" && <span>Loading options…</span>}
          {state.status === "error" && (
            <span>Couldn&apos;t load bag & seat options right now.</span>
          )}
          {state.status === "loaded" && state.services.length === 0 && (
            <span>No additional bag or seat options for this fare.</span>
          )}
          {state.status === "loaded" &&
            state.services.map((s) => (
              <div key={s.id} className={styles.serviceRow}>
                <span>{s.label}</span>
                <span>{formatPrice(s.amount, s.currency)}</span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

type SeatMapState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; seatMaps: NormalizedSeatMap[] }
  | { status: "error" };

interface SelectedSeat {
  designator: string;
  amount: string;
  currency: string;
}

// A seat element can carry more than one available_service (one per
// passenger, sometimes at different prices) - the picker is a single-adult
// MVP with no booking/order wiring, so it just surfaces the cheapest option
// rather than trying to model a per-passenger assignment flow.
function cheapestOption(element: NormalizedSeatElement) {
  if (element.options.length === 0) return undefined;
  return [...element.options].sort(
    (a, b) => parseFloat(a.amount) - parseFloat(b.amount)
  )[0];
}

function SeatButton({
  element,
  segmentId,
  selected,
  onSelect,
}: {
  element: NormalizedSeatElement;
  segmentId: string;
  selected: boolean;
  onSelect: (segmentId: string, seat: SelectedSeat) => void;
}) {
  // Non-seat elements (aisles/lavatories/galleys/exit rows/etc.) still need
  // to occupy their grid position so rows line up - render an inert filler.
  if (element.type !== "seat") {
    return <div className={styles.seatGap} aria-hidden="true" />;
  }

  const { designator } = element;
  // A "seat" element with no available_services (or no designator at all)
  // is occupied/blocked - Duffel still returns it so the grid keeps its
  // real shape, but it can't be selected.
  if (!element.available || !designator) {
    return (
      <div
        className={styles.seatTaken}
        aria-label={designator ? `Seat ${designator} unavailable` : "Seat unavailable"}
      >
        {designator ?? ""}
      </div>
    );
  }

  const option = cheapestOption(element);

  return (
    <button
      type="button"
      className={`${styles.seatBtn} ${selected ? styles.seatBtnSelected : ""}`}
      onClick={() =>
        option &&
        onSelect(segmentId, {
          designator,
          amount: option.amount,
          currency: option.currency,
        })
      }
      disabled={!option}
      title={
        option
          ? `Seat ${designator} · ${formatPrice(option.amount, option.currency)}`
          : `Seat ${designator}`
      }
      aria-pressed={selected}
    >
      {designator}
    </button>
  );
}

function SeatMapPicker({ offerId }: { offerId: string }) {
  const [expanded, setExpanded] = useState(false);
  const [state, setState] = useState<SeatMapState>({ status: "idle" });
  const [selected, setSelected] = useState<Record<string, SelectedSeat>>({});

  async function toggle() {
    const next = !expanded;
    setExpanded(next);
    if (next && (state.status === "idle" || state.status === "error")) {
      setState({ status: "loading" });
      try {
        const res = await fetch(`/api/offers/${offerId}/seat-map`);
        if (!res.ok) throw new Error("request failed");
        const data = (await res.json()) as { seatMaps: NormalizedSeatMap[] };
        setState({ status: "loaded", seatMaps: data.seatMaps ?? [] });
      } catch {
        setState({ status: "error" });
      }
    }
  }

  function selectSeat(segmentId: string, seat: SelectedSeat) {
    setSelected((prev) => {
      if (prev[segmentId]?.designator === seat.designator) {
        const rest = { ...prev };
        delete rest[segmentId];
        return rest;
      }
      return { ...prev, [segmentId]: seat };
    });
  }

  const selectedList = Object.values(selected);

  return (
    <div className={styles.seatMapPicker}>
      <button
        className={styles.expandBtn}
        onClick={toggle}
        aria-expanded={expanded}
      >
        {expanded ? "Hide" : "View"} seat map
      </button>
      {expanded && (
        <div className={styles.seatMapPanel} aria-live="polite">
          {state.status === "loading" && <span>Loading seat map…</span>}
          {state.status === "error" && (
            <span>Couldn&apos;t load the seat map right now.</span>
          )}
          {state.status === "loaded" && state.seatMaps.length === 0 && (
            <span>Seat selection isn&apos;t available for this fare.</span>
          )}

          {state.status === "loaded" && state.seatMaps.length > 0 && (
            <>
              {state.seatMaps.map((seatMap, mapIndex) => (
                <div key={seatMap.id || mapIndex} className={styles.seatMapSegment}>
                  {state.seatMaps.length > 1 && (
                    <div className={styles.seatSegmentLabel}>
                      Flight {mapIndex + 1}
                    </div>
                  )}
                  {seatMap.cabins.length === 0 && (
                    <span>No seat layout available for this segment.</span>
                  )}
                  {seatMap.cabins.map((cabin, cabinIndex) => (
                    <div key={cabinIndex} className={styles.seatCabin}>
                      {cabin.cabinClass && (
                        <div className={styles.seatCabinLabel}>{cabin.cabinClass}</div>
                      )}
                      <div className={styles.seatGrid}>
                        {cabin.rows.map((row, rowIndex) => (
                          <div key={rowIndex} className={styles.seatRow}>
                            {row.sections.map((section, sectionIndex) => (
                              <div key={sectionIndex} className={styles.seatSection}>
                                {section.elements.map((el, elIndex) => (
                                  <SeatButton
                                    key={elIndex}
                                    element={el}
                                    segmentId={seatMap.segmentId}
                                    selected={
                                      selected[seatMap.segmentId]?.designator === el.designator
                                    }
                                    onSelect={selectSeat}
                                  />
                                ))}
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ))}

              <div className={styles.seatLegend}>
                <span><span className={`${styles.legendSwatch} ${styles.legendAvailable}`} /> Available</span>
                <span><span className={`${styles.legendSwatch} ${styles.legendSelected}`} /> Selected</span>
                <span><span className={`${styles.legendSwatch} ${styles.legendTaken}`} /> Unavailable</span>
              </div>

              {selectedList.length > 0 && (
                <div className={styles.seatSelectionSummary}>
                  Selected: {selectedList
                    .map((s) => `${s.designator} (${formatPrice(s.amount, s.currency)})`)
                    .join(", ")}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function shortCity(name: string): string {
  if (name.length <= 12) return name;
  return name.split(" ").slice(0, 2).join(" ");
}

function SliceRow({
  slice,
  label,
}: {
  slice: NormalizedOffer["slices"][0];
  label?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const firstSeg = slice.segments[0];
  const lastSeg = slice.segments[slice.segments.length - 1];
  const nextDay = isNextDay(firstSeg.departing_at, lastSeg.arriving_at);
  const airlines = [...new Set(slice.segments.map((s) => s.marketing_carrier.name))].join(", ");

  return (
    <div className={styles.slice}>
      {label && <div className={styles.sliceLabel}>{label}</div>}
      <div className={styles.routeRow}>
        <div className={styles.endpoint}>
          <span className={styles.time}>{formatTime(firstSeg.departing_at)}</span>
          <span className={styles.iata}>{firstSeg.origin.iata_code}</span>
          <span className={styles.city}>{shortCity(firstSeg.origin.name)}</span>
        </div>

        <div className={styles.middle}>
          <span className={styles.duration}>{formatDuration(slice.duration)}</span>
          <div className={styles.track}>
            <div className={styles.trackLine} />
            {slice.stops > 0 &&
              slice.segments.slice(0, -1).map((_, i) => (
                <div
                  key={i}
                  className={styles.stopDot}
                  style={{ left: `${((i + 1) / slice.segments.length) * 100}%` }}
                />
              ))}
          </div>
          <span className={styles.stops}>
            {slice.stops === 0
              ? "Non-stop"
              : `${slice.stops} stop${slice.stops > 1 ? "s" : ""}`}
          </span>
        </div>

        <div className={`${styles.endpoint} ${styles.right}`}>
          <span className={styles.time}>
            {formatTime(lastSeg.arriving_at)}
            {nextDay && <sup className={styles.plus1}>+1</sup>}
          </span>
          <span className={styles.iata}>{lastSeg.destination.iata_code}</span>
          <span className={styles.city}>{shortCity(lastSeg.destination.name)}</span>
        </div>
      </div>

      <div className={styles.airlineRow}>
        <span className={styles.airlineName}>
          {airlines}
          {slice.segments.length === 1 &&
            slice.segments[0].operating_carrier.iata_code !== slice.segments[0].marketing_carrier.iata_code && (
            <> · <span style={{ fontStyle: "italic" }}>op. {slice.segments[0].operating_carrier.name}</span></>
          )}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span className={styles.flightNums}>
            {slice.segments.map((s) => `${s.marketing_carrier.iata_code}${s.flight_number}`).join(" · ")}
          </span>
          {slice.stops > 0 && (
            <button
              className={styles.expandBtn}
              onClick={(e) => { e.stopPropagation(); setExpanded((x) => !x); }}
              aria-label={expanded ? "Hide flight segment details" : `Show ${slice.stops} stop${slice.stops > 1 ? "s" : ""} detail`}
              aria-expanded={expanded}
            >
              <svg
                width="10"
                height="10"
                viewBox="0 0 10 10"
                aria-hidden="true"
                className={`${styles.chevron} ${expanded ? styles.chevronUp : ""}`}
              >
                <polyline points="1,3 5,7 9,3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              {" "}details
            </button>
          )}
        </div>
      </div>

      {expanded && slice.stops > 0 && (
        <div className={styles.segmentDetails}>
          {slice.segments.map((seg, i) => (
            <div key={i}>
              <div className={styles.segmentRow}>
                <div className={styles.segDot} />
                <div className={styles.segInfo}>
                  <span className={styles.segTime}>{formatTime(seg.departing_at)}</span>
                  <span className={styles.segIata}>{seg.origin.iata_code}</span>
                  <span className={styles.segCity}>{seg.origin.name}</span>
                  <span className={styles.segFlight}>
                    {seg.marketing_carrier.iata_code}{seg.flight_number} · {formatDuration(seg.duration)}
                    {seg.operating_carrier.iata_code !== seg.marketing_carrier.iata_code && (
                      <> · Operated by {seg.operating_carrier.name}</>
                    )}
                  </span>
                </div>
              </div>
              {i < slice.segments.length - 1 && (
                <div className={styles.layoverRow}>
                  <div className={styles.layoverLine} />
                  <span className={styles.layoverLabel}>
                    {fmtLayover(slice.segments[i + 1].departing_at, seg.arriving_at)} layover · {seg.destination.iata_code}
                  </span>
                </div>
              )}
            </div>
          ))}
          <div className={styles.segmentRow}>
            <div className={styles.segDot} />
            <div className={styles.segInfo}>
              <span className={styles.segTime}>{formatTime(lastSeg.arriving_at)}</span>
              <span className={styles.segIata}>{lastSeg.destination.iata_code}</span>
              <span className={styles.segCity}>{lastSeg.destination.name}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function OfferCardSkeleton() {
  return (
    <div className={`${styles.card} ${styles.skeleton}`}>
      <div className={styles.header}>
        <div className={styles.skeletonAirline} />
        <div className={styles.skeletonPrice} />
      </div>
      <div className={styles.skeletonRoute}>
        <div className={styles.skeletonEndpoint}>
          <div className={styles.skeletonTime} />
          <div className={styles.skeletonIata} />
        </div>
        <div className={styles.skeletonMiddle}>
          <div className={styles.skeletonDuration} />
          <div className={styles.skeletonTrack} />
          <div className={styles.skeletonIata} />
        </div>
        <div className={styles.skeletonEndpoint}>
          <div className={styles.skeletonTime} />
          <div className={styles.skeletonIata} />
        </div>
      </div>
    </div>
  );
}

export function OfferCard({
  offer,
  onSelect,
  tag,
}: {
  offer: NormalizedOffer;
  onSelect?: (offer: NormalizedOffer) => void;
  tag?: OfferTag;
}) {
  const totalPax = offer.passengers.length;
  const perPaxAmount = totalPax > 1
    ? formatPrice(String(parseFloat(offer.total_amount) / totalPax), offer.total_currency)
    : null;
  const labels = sliceLabels(offer);

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <div className={styles.airlineInfo}>
          {offer.owner.logo_symbol_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={offer.owner.logo_symbol_url}
              alt={offer.owner.name}
              className={styles.logo}
              loading="lazy"
              decoding="async"
            />
          )}
          <span className={styles.airlineLabel}>{offer.owner.name}</span>
        </div>
        <div className={styles.priceBlock}>
          {tag && (
            <span className={`${styles.tag} ${styles[`tag_${tag}`]}`}>
              {TAG_LABELS[tag]}
            </span>
          )}
          <span className={styles.price}>
            {formatPrice(offer.total_amount, offer.total_currency)}
          </span>
          {perPaxAmount ? (
            <span className={styles.pricePerPax}>{perPaxAmount} / person</span>
          ) : (
            <span className={styles.priceSub}>total</span>
          )}
        </div>
      </div>

      <div className={styles.slices}>
        {offer.slices.map((slice, i) => (
          <SliceRow key={i} slice={slice} label={labels[i]} />
        ))}
      </div>

      {baggageSummary(offer) && (
        <div className={styles.baggageRow}>{baggageSummary(offer)}</div>
      )}

      <BagSeatOptions offerId={offer.id} />
      <SeatMapPicker offerId={offer.id} />

      <div className={styles.footer}>
        <div className={styles.badges}>
          {offer.conditions.refundable && (
            <span className={`${styles.badge} ${styles.badgeGreen}`}>
              Refundable{feeSuffix(offer.conditions.refundFee)}
            </span>
          )}
          {offer.conditions.changeable && (
            <span className={`${styles.badge} ${styles.badgeBlue}`}>
              Changeable{feeSuffix(offer.conditions.changeFee)}
            </span>
          )}
          {!offer.conditions.refundable && (
            <span className={`${styles.badge} ${styles.badgeGray}`}>Non-refundable</span>
          )}
        </div>
        {onSelect && (
          <button
            className={styles.selectBtn}
            onClick={() => onSelect(offer)}
            aria-label={`Select ${offer.owner.name} - ${formatPrice(offer.total_amount, offer.total_currency)}`}
          >
            Select →
          </button>
        )}
      </div>
    </div>
  );
}
