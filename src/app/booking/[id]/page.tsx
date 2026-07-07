import { auth } from "@/auth";
import { db } from "@/lib/db";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";

import type { NormalizedOffer } from "@/lib/duffel/types";
import Link from "next/link";
import { ShareButtons } from "@/components/ShareButtons";
import { CopyRefBtn } from "@/components/CopyRefBtn";
import { PrintBtn } from "@/components/PrintBtn";
import { getOrderStatus, checkForScheduleChanges, type ScheduleChangeResult } from "@/lib/duffel/orders";
import styles from "./page.module.css";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const noindex = { robots: { index: false } };
  const session = await auth();
  if (!session?.user?.id) return { title: "Booking · Orbi", ...noindex };

  const { id } = await params;
  const booking = await db.booking.findUnique({
    where: { id },
    select: { offerSnapshot: true, duffelBookingRef: true, userId: true },
  });
  // Route/PNR are only safe to embed in the page title (and thus link
  // previews) for the booking's owner - anyone else who knows/guesses the
  // booking id should see the same generic title as a 404.
  if (!booking || booking.userId !== session.user.id) return { title: "Booking · Orbi", ...noindex };
  try {
    const offer = booking.offerSnapshot as unknown as NormalizedOffer;
    const seg0 = offer.slices[0].segments[0];
    const segLast = offer.slices[0].segments[offer.slices[0].segments.length - 1];
    const route = `${seg0.origin.iata_code} → ${segLast.destination.iata_code}`;
    const ref = booking.duffelBookingRef ? ` · ${booking.duffelBookingRef}` : "";
    return { title: `${route}${ref} · Orbi`, ...noindex };
  } catch {
    return { title: "Booking · Orbi", ...noindex };
  }
}

function formatDateTime(dt: string) {
  return new Date(dt).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function fmtTime(dt: string) {
  return new Date(dt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function fmtDuration(iso: string) {
  const h = iso.match(/(\d+)H/)?.[1];
  const m = iso.match(/(\d+)M/)?.[1];
  return [h ? `${h}h` : "", m ? `${m}m` : ""].filter(Boolean).join(" ");
}

export default async function BookingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const { id } = await params;
  const booking = await db.booking.findUnique({ where: { id } });

  if (!booking || booking.userId !== session.user.id) notFound();

  // A booking whose payment succeeded but whose offer could never be
  // verified (see POST /api/booking) has no real offer to snapshot - its
  // offerSnapshot is a minimal { offerId, reason } record instead of a full
  // NormalizedOffer, so this must not assume `.slices` exists.
  const offerSnapshotRaw = booking.offerSnapshot as unknown;
  const offer =
    offerSnapshotRaw &&
    typeof offerSnapshotRaw === "object" &&
    Array.isArray((offerSnapshotRaw as NormalizedOffer).slices) &&
    (offerSnapshotRaw as NormalizedOffer).slices.length > 0
      ? (offerSnapshotRaw as NormalizedOffer)
      : null;
  const passengerNames = booking.passengerNames as unknown as string[];

  // Post-booking flight status: re-fetch the order from Duffel and diff its
  // current segment times against what was booked. Read-only - this never
  // creates, changes, or cancels the order (CLAUDE.md guardrail #2 doesn't
  // apply here). Failures degrade gracefully - the rest of the page still
  // renders even if Duffel is unreachable.
  let scheduleCheck: ScheduleChangeResult | null = null;
  let scheduleCheckFailed = false;
  if (booking.status === "confirmed" && booking.duffelOrderId && offer) {
    try {
      const order = await getOrderStatus(booking.duffelOrderId);
      scheduleCheck = checkForScheduleChanges(offer, order);
    } catch (err) {
      console.error("[booking detail] flight status check failed:", err);
      scheduleCheckFailed = true;
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <div className={styles.statusBanner} data-status={booking.status}>
          {booking.status === "confirmed" ? (
            <>
              <svg className={styles.checkCircle} viewBox="0 0 26 26" aria-hidden="true">
                <circle cx="13" cy="13" r="11" stroke="rgba(22,163,74,0.25)" strokeWidth="2" fill="none" />
                <circle cx="13" cy="13" r="11" className={styles.checkCircleRing} />
                <polyline points="7,13 11,17 19,9" className={styles.checkMark} />
              </svg>
              Booking confirmed
            </>
          ) : booking.status === "failed" ? (
            <>
              <span className={styles.statusIcon}>!</span>
              Booking could not be completed - your payment was charged. Contact
              support with reference below.
            </>
          ) : (
            "Booking pending…"
          )}
        </div>

        <div className={styles.card}>
          <div className={styles.refRow}>
            <span className={styles.refLabel}>Booking reference</span>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span className={styles.ref}>
                {booking.duffelBookingRef ?? "-"}
              </span>
              {booking.duffelBookingRef && (
                <CopyRefBtn value={booking.duffelBookingRef} />
              )}
            </div>
          </div>
          <div className={styles.refRow}>
            <span className={styles.refLabel}>Booking ID</span>
            <span className={styles.refId}>{booking.id}</span>
          </div>
        </div>

        {offer ? (
          offer.slices.map((slice, si) => {
            const firstSeg = slice.segments[0];
            const lastSeg = slice.segments[slice.segments.length - 1];
            return (
              <div key={si} className={styles.card}>
                <div className={styles.flightMeta}>
                  <span className={styles.airline}>
                    {offer.slices.length > 1
                      ? si === 0 ? `${offer.owner.name} · Outbound` : `${offer.owner.name} · Return`
                      : offer.owner.name}
                  </span>
                  <span className={styles.flightNum}>
                    {firstSeg.marketing_carrier.iata_code}{firstSeg.flight_number}
                  </span>
                </div>
                <div className={styles.flightRoute}>
                  <div className={styles.flightEndpoint}>
                    <span className={styles.flightTime}>{fmtTime(firstSeg.departing_at)}</span>
                    <span className={styles.flightIata}>{firstSeg.origin.iata_code}</span>
                    <span className={styles.flightCity}>{firstSeg.origin.name.split(" ").slice(0, 2).join(" ")}</span>
                  </div>
                  <div className={styles.flightMiddle}>
                    <span className={styles.flightDur}>{fmtDuration(slice.duration)}</span>
                    <div className={styles.flightLine} />
                    <span className={styles.flightStops}>
                      {slice.stops === 0 ? "Non-stop" : `${slice.stops} stop${slice.stops > 1 ? "s" : ""}`}
                    </span>
                  </div>
                  <div className={`${styles.flightEndpoint} ${styles.flightEndpointRight}`}>
                    <span className={styles.flightTime}>{fmtTime(lastSeg.arriving_at)}</span>
                    <span className={styles.flightIata}>{lastSeg.destination.iata_code}</span>
                    <span className={styles.flightCity}>{lastSeg.destination.name.split(" ").slice(0, 2).join(" ")}</span>
                  </div>
                </div>
                <div className={styles.flightDateRow}>
                  {formatDateTime(firstSeg.departing_at)}
                </div>
              </div>
            );
          })
        ) : (
          <div className={styles.card}>
            <p className={styles.statusUnavailable}>
              Flight details aren&apos;t available for this booking - contact
              support with the booking ID above if you were charged.
            </p>
          </div>
        )}

        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Passengers</h2>
          {passengerNames.map((name, i) => (
            <p key={i} className={styles.passenger}>
              {name}
              {offer?.passengers[i]?.type && (
                <span className={styles.passengerType}>
                  {" "}· {offer.passengers[i].type.charAt(0).toUpperCase() + offer.passengers[i].type.slice(1)}
                </span>
              )}
            </p>
          ))}
        </div>

        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Amount paid</h2>
          <p className={styles.amount}>
            {(() => {
              try {
                return new Intl.NumberFormat("en-GB", {
                  style: "currency",
                  currency: booking.totalCurrency,
                  minimumFractionDigits: 2,
                }).format(parseFloat(booking.totalAmount));
              } catch {
                return `${booking.totalAmount} ${booking.totalCurrency}`;
              }
            })()}
          </p>
        </div>

        {booking.status === "confirmed" && booking.duffelOrderId && (
          <div className={styles.card}>
            <h2 className={styles.cardTitle}>Flight status</h2>
            {scheduleCheckFailed ? (
              <p className={styles.statusUnavailable}>
                Unable to check for schedule changes right now - try again later.
              </p>
            ) : scheduleCheck?.hasChanges ? (
              <>
                <p className={styles.statusChanged}>
                  The airline has changed your flight times:
                </p>
                {scheduleCheck.segmentChanges.map((c) => (
                  <div
                    key={`${c.sliceIndex}-${c.segmentIndex}`}
                    className={styles.scheduleChangeRow}
                  >
                    <span className={styles.scheduleChangeFlight}>
                      {c.flightNumber} · {c.origin} → {c.destination}
                    </span>
                    <span className={styles.scheduleChangeTimes}>
                      <span className={styles.scheduleChangeOld}>
                        {formatDateTime(c.originalDepartingAt)}
                      </span>
                      {" → "}
                      <span className={styles.scheduleChangeNew}>
                        {formatDateTime(c.currentDepartingAt)}
                      </span>
                    </span>
                  </div>
                ))}
              </>
            ) : (
              <p className={styles.statusOk}>
                No schedule changes - your flight times match what you booked.
              </p>
            )}
            {scheduleCheck?.hasPendingAirlineChange && (
              <p className={styles.statusPending}>
                The airline has proposed a change that needs a response - contact
                support with your booking reference above.
              </p>
            )}
          </div>
        )}

        {booking.status === "confirmed" && offer && (() => {
          const outboundFirst = offer.slices[0].segments[0];
          const outboundLast = offer.slices[0].segments[offer.slices[0].segments.length - 1];
          const returnLast = offer.slices.length > 1
            ? offer.slices[offer.slices.length - 1].segments.at(-1)
            : null;
          return (
          <div className={`${styles.card} ${styles.noPrint}`}>
            <ShareButtons
              bookingRef={booking.duffelBookingRef}
              route={`${outboundFirst.origin.iata_code} → ${(returnLast ?? outboundLast).destination.iata_code}`}
              airline={offer.owner.name}
              departsAt={formatDateTime(outboundFirst.departing_at)}
              arrivesAt={formatDateTime((returnLast ?? outboundLast).arriving_at)}
              passengers={passengerNames}
              totalAmount={booking.totalAmount}
              totalCurrency={booking.totalCurrency}
            />
          </div>
          );
        })()}

        <p className={styles.bookedOn}>
          Booked on {new Date(booking.createdAt).toLocaleDateString("en-GB", { dateStyle: "long" })}
        </p>

        <div className={styles.actions}>
          <Link href="/" className={styles.backLink}>
            ← New search
          </Link>
          <div className={styles.actionRight}>
            <PrintBtn />
            <Link href="/bookings" className={styles.historyLink}>
              All bookings
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
