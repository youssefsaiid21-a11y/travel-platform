import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { requireAdmin } from "@/lib/adminAuth";
import { db } from "@/lib/db";
import { TicketActions } from "./TicketActions";
import styles from "../admin.module.css";

export const metadata: Metadata = {
  title: "Support tickets · Admin · Orbi",
  robots: { index: false, follow: false },
};

function formatDate(dt: Date) {
  return new Date(dt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

export default async function AdminSupportTicketsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const admin = await requireAdmin();
  if (!admin.ok) redirect(admin.reason === "unauthenticated" ? "/login" : "/");

  const { status } = await searchParams;
  const filter = status === "resolved" ? "resolved" : status === "open" ? "open" : null;

  const tickets = await db.supportTicket.findMany({
    where: filter ? { status: filter } : undefined,
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 100,
  });

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1 className={styles.heading}>Support tickets</h1>
          <nav className={styles.nav}>
            <Link href="/admin" className={styles.navLink}>Dashboard</Link>
            <Link href="/admin/bookings" className={styles.navLink}>Bookings</Link>
          </nav>
        </div>

        <div className={styles.filterRow}>
          <Link href="/admin/support-tickets" className={`${styles.filterBtn} ${!filter ? styles.filterBtnActive : ""}`}>
            All
          </Link>
          <Link href="/admin/support-tickets?status=open" className={`${styles.filterBtn} ${filter === "open" ? styles.filterBtnActive : ""}`}>
            Open
          </Link>
          <Link href="/admin/support-tickets?status=resolved" className={`${styles.filterBtn} ${filter === "resolved" ? styles.filterBtnActive : ""}`}>
            Resolved
          </Link>
        </div>

        {tickets.length === 0 ? (
          <p className={styles.emptyText}>No tickets{filter ? ` with status "${filter}"` : ""}.</p>
        ) : (
          <ul className={styles.list}>
            {tickets.map((t) => (
              <li key={t.id} className={styles.item}>
                <div className={styles.itemTop}>
                  <span className={styles.itemSubject}>{t.subject}</span>
                  <span className={styles.status} data-status={t.status}>{t.status}</span>
                </div>
                <div className={styles.itemMeta}>
                  {t.email} · {formatDate(t.createdAt)}
                  {t.bookingRef && ` · Booking ref: ${t.bookingRef}`}
                </div>
                <p className={styles.itemMessage}>{t.message}</p>
                <div className={styles.itemActions}>
                  <TicketActions id={t.id} status={t.status} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
