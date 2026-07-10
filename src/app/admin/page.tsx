import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { requireAdmin } from "@/lib/adminAuth";
import { db } from "@/lib/db";
import styles from "./admin.module.css";

export const metadata: Metadata = {
  title: "Admin · Orbi",
  robots: { index: false, follow: false },
};

export default async function AdminPage() {
  const admin = await requireAdmin();
  if (!admin.ok) redirect(admin.reason === "unauthenticated" ? "/login" : "/");

  const [openTickets, totalBookings] = await Promise.all([
    db.supportTicket.count({ where: { status: "open" } }),
    db.booking.count(),
  ]);

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1 className={styles.heading}>Admin</h1>
        </div>

        <Link href="/admin/support-tickets" className={styles.card}>
          <h2 className={styles.cardTitle}>Support tickets</h2>
          <p className={styles.cardSubtitle}>
            {openTickets} open ticket{openTickets === 1 ? "" : "s"}
          </p>
        </Link>

        <Link href="/admin/bookings" className={styles.card}>
          <h2 className={styles.cardTitle}>Bookings</h2>
          <p className={styles.cardSubtitle}>
            {totalBookings} booking{totalBookings === 1 ? "" : "s"} total
          </p>
        </Link>
      </div>
    </div>
  );
}
