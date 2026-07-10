import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { requireAdmin } from "@/lib/adminAuth";
import { db } from "@/lib/db";
import styles from "../admin.module.css";

export const metadata: Metadata = {
  title: "Bookings · Admin · Orbi",
  robots: { index: false, follow: false },
};

function formatDate(dt: Date) {
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

export default async function AdminBookingsPage() {
  const admin = await requireAdmin();
  if (!admin.ok) redirect(admin.reason === "unauthenticated" ? "/login" : "/");

  const bookings = await db.booking.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { user: { select: { email: true } } },
  });

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1 className={styles.heading}>Bookings</h1>
          <nav className={styles.nav}>
            <Link href="/admin" className={styles.navLink}>Dashboard</Link>
            <Link href="/admin/support-tickets" className={styles.navLink}>Support tickets</Link>
            <Link href="/admin/ops" className={styles.navLink}>Operations</Link>
          </nav>
        </div>

        {bookings.length === 0 ? (
          <p className={styles.emptyText}>No bookings yet.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Booked</th>
                  <th>Customer</th>
                  <th>Ref</th>
                  <th>Status</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {bookings.map((b) => (
                  <tr key={b.id}>
                    <td>{formatDate(b.createdAt)}</td>
                    <td>{b.user.email}</td>
                    <td>
                      <Link href={`/booking/${b.id}`}>{b.duffelBookingRef ?? b.id.slice(0, 8)}</Link>
                    </td>
                    <td>
                      <span className={styles.status} data-status={b.status}>
                        {b.status}
                      </span>
                    </td>
                    <td>{fmtAmount(b.totalAmount, b.totalCurrency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
