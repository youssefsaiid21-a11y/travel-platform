import type { Metadata } from "next";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import Link from "next/link";
import type { NormalizedOffer } from "@/lib/duffel/types";
import type { SearchParams } from "@/lib/parser/types";
import { SearchSimilarBtn } from "@/components/SearchSimilarBtn";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "My Bookings · Orbi",
  description: "View and manage your flight bookings.",
  robots: { index: false },
};

function formatDate(dt: string | Date) {
  return new Date(dt).toLocaleDateString("en-GB", { dateStyle: "medium" });
}

function fmtAmount(amount: string, currency: string) {
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

function buildSearchQuery(searchParamsJson: string, offer: NormalizedOffer): string {
  try {
    const p = JSON.parse(searchParamsJson) as SearchParams;
    const cabin = p.cabin_class && p.cabin_class !== "economy" ? `${p.cabin_class} ` : "";
    const paxCount = p.passengers.reduce((n, p) => n + p.count, 0);
    const pax = paxCount > 1 ? `${paxCount} passengers ` : "";
    const ret = p.return_date ? ` return ${p.return_date}` : "";
    return `${pax}${cabin}${p.origin} to ${p.destination} on ${p.departure_date}${ret}`;
  } catch {
    const first = offer.slices[0].segments[0];
    const last = offer.slices[0].segments[offer.slices[0].segments.length - 1];
    return `${first.origin.iata_code} to ${last.destination.iata_code}`;
  }
}

export default async function BookingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const bookings = await db.booking.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1 className={styles.heading}>My bookings</h1>
          <Link href="/" className={styles.newSearch}>
            + New search
          </Link>
        </div>

        {bookings.length === 0 ? (
          <div className={styles.emptyCard}>
            <div className={styles.emptyIcon}>
              <svg width="52" height="52" viewBox="0 0 52 52" fill="none" aria-hidden="true">
                <circle cx="26" cy="26" r="25" stroke="var(--accent-border)" strokeWidth="1.5" />
                <path d="M12 30 L22 20 L26 24 L36 14" stroke="var(--accent-light)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.5"/>
                <path d="M14 34 C18 28 24 24 32 22 L36 26 L38 18 L30 20" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <circle cx="38" cy="18" r="3" fill="var(--accent)" opacity="0.8"/>
              </svg>
            </div>
            <h2 className={styles.emptyHeading}>No flights booked yet</h2>
            <p className={styles.emptyText}>
              Find your next flight with a simple message - just tell Orbi where you want to go.
            </p>
            <Link href="/" className={styles.emptyCta}>
              Search for flights
            </Link>
          </div>
        ) : (
          <ul className={styles.list}>
            {bookings.map((b) => {
              // A booking whose payment succeeded but whose offer could
              // never be verified (see POST /api/booking) has a minimal
              // { offerId, reason } snapshot instead of a full offer - one
              // such row must not crash the whole list.
              const raw = JSON.parse(b.offerSnapshot) as unknown;
              const offer =
                raw &&
                typeof raw === "object" &&
                Array.isArray((raw as NormalizedOffer).slices) &&
                (raw as NormalizedOffer).slices.length > 0
                  ? (raw as NormalizedOffer)
                  : null;

              if (!offer) {
                return (
                  <li key={b.id} className={styles.item}>
                    <Link href={`/booking/${b.id}`} className={styles.itemLink}>
                      <div className={styles.itemTop}>
                        <span className={styles.route}>Flight details unavailable</span>
                        <span className={styles.status} data-status={b.status}>
                          {b.status}
                        </span>
                      </div>
                      <div className={styles.itemMeta}>
                        <span>{fmtAmount(b.totalAmount, b.totalCurrency)}</span>
                      </div>
                      <div className={styles.bookedOn}>
                        Booked {formatDate(b.createdAt)}
                      </div>
                    </Link>
                  </li>
                );
              }

              const firstSeg = offer.slices[0].segments[0];
              const lastSlice = offer.slices[offer.slices.length - 1];
              const finalSeg = lastSlice.segments[lastSlice.segments.length - 1];
              const isRoundTrip = offer.slices.length > 1;
              return (
                <li key={b.id} className={styles.item}>
                  <Link href={`/booking/${b.id}`} className={styles.itemLink}>
                    <div className={styles.itemTop}>
                      <span className={styles.route}>
                        {firstSeg.origin.iata_code} →{" "}
                        {finalSeg.destination.iata_code}
                        {isRoundTrip && <span className={styles.tripType}> · Return</span>}
                      </span>
                      <span className={styles.status} data-status={b.status}>
                        {b.status}
                      </span>
                    </div>
                    <div className={styles.itemMeta}>
                      <span>{offer.owner.name}</span>
                      <span>·</span>
                      <span>
                        {new Date(firstSeg.departing_at).toLocaleString("en-GB", {
                          weekday: "short",
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: false,
                        })}
                      </span>
                      <span>·</span>
                      <span>{fmtAmount(b.totalAmount, b.totalCurrency)}</span>
                    </div>
                    {b.duffelBookingRef && (
                      <div className={styles.ref}>Ref: {b.duffelBookingRef}</div>
                    )}
                    <div className={styles.bookedOn}>
                      Booked {formatDate(b.createdAt)}
                    </div>
                  </Link>
                  <div className={styles.itemActions}>
                    <SearchSimilarBtn query={buildSearchQuery(b.searchParams, offer)} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
