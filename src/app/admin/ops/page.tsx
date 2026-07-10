import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { requireAdmin } from "@/lib/adminAuth";
import { db } from "@/lib/db";
import { readBusinessState } from "@/lib/businessState";
import styles from "../admin.module.css";

export const metadata: Metadata = {
  title: "Operations · Admin · Orbi",
  robots: { index: false, follow: false },
};

// Hardcoded rather than read from vercel.json at runtime: these three
// schedules change rarely, and vercel.json lives outside src/ same as
// BUSINESS_STATE.md - reading it would need its own outputFileTracingIncludes
// pin for no real benefit over just listing the three known routes here.
const CRON_JOBS = [
  { path: "/api/cron/check-price-drops", schedule: "0 8 * * *" },
  { path: "/api/cron/cleanup-chat-sessions", schedule: "0 3 * * *" },
  { path: "/api/cron/check-site-health", schedule: "0 6 * * *" },
];

// Normalizes BUSINESS_STATE.md's free-form status prose ("merged to main,
// live", "agent defined, feature LIVE", "drafted, NOT activated", ...) into
// one of a fixed set of display buckets - matching the raw text directly
// via CSS would need a rule per phrasing variant, which isn't a stable
// contract against a hand-edited file.
function statusBucket(status: string): "live" | "drafted" | "not-activated" | "unknown" {
  const s = status.toLowerCase();
  if (s.includes("not activated") || s.includes("not active")) return "not-activated";
  if (s.includes("draft")) return "drafted";
  if (s.includes("active") || s.includes("live") || s.includes("merged")) return "live";
  return "unknown";
}

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

export default async function AdminOpsPage() {
  const admin = await requireAdmin();
  if (!admin.ok) redirect(admin.reason === "unauthenticated" ? "/login" : "/");

  const [bookingsByStatus, ticketsByStatus, userCount, newUsersThisWeek, trackedSearchCount] =
    await Promise.all([
      db.booking.groupBy({ by: ["status"], _count: true }),
      db.supportTicket.groupBy({ by: ["status"], _count: true }),
      db.user.count(),
      db.user.count({ where: { createdAt: { gte: daysAgo(7) } } }),
      db.trackedSearch.count(),
    ]);

  const businessState = readBusinessState();

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1 className={styles.heading}>Operations</h1>
          <nav className={styles.nav}>
            <Link href="/admin" className={styles.navLink}>Dashboard</Link>
            <Link href="/admin/support-tickets" className={styles.navLink}>Support tickets</Link>
            <Link href="/admin/bookings" className={styles.navLink}>Bookings</Link>
          </nav>
        </div>

        <h3 style={{ marginBottom: "0.6rem" }}>Business snapshot</h3>
        <div className={styles.statStrip} style={{ marginBottom: "1.5rem" }}>
          {bookingsByStatus.map((b) => (
            <div className={styles.stat} key={`booking-${b.status}`}>
              <div className={styles.statValue}>{b._count}</div>
              <div className={styles.statLabel}>{b.status} bookings</div>
            </div>
          ))}
          {ticketsByStatus.map((t) => (
            <div className={styles.stat} key={`ticket-${t.status}`}>
              <div className={styles.statValue}>{t._count}</div>
              <div className={styles.statLabel}>{t.status} tickets</div>
            </div>
          ))}
          <div className={styles.stat}>
            <div className={styles.statValue}>{userCount}</div>
            <div className={styles.statLabel}>Total users</div>
          </div>
          <div className={styles.stat}>
            <div className={styles.statValue}>{newUsersThisWeek}</div>
            <div className={styles.statLabel}>New this week</div>
          </div>
          <div className={styles.stat}>
            <div className={styles.statValue}>{trackedSearchCount}</div>
            <div className={styles.statLabel}>Tracked searches</div>
          </div>
        </div>

        {!businessState.available ? (
          <p className={styles.emptyText}>
            Could not read .claude/BUSINESS_STATE.md: {businessState.error}
          </p>
        ) : (
          <>
            <h3 style={{ marginBottom: "0.6rem" }}>Agent roster</h3>
            {businessState.agentRoster ? (
              <table className={styles.table} style={{ marginBottom: "1.5rem" }}>
                <thead>
                  <tr><th>Agent</th><th>Status</th><th>Notes</th></tr>
                </thead>
                <tbody>
                  {businessState.agentRoster.map((row) => (
                    <tr key={row.agent}>
                      <td>{row.agent}</td>
                      <td><span className={styles.status} data-status={statusBucket(row.status)}>{row.status}</span></td>
                      <td>{row.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <pre className={styles.rawSection} style={{ marginBottom: "1.5rem" }}>{businessState.agentRosterRaw}</pre>
            )}

            <h3 style={{ marginBottom: "0.6rem" }}>Harness calibration log</h3>
            {businessState.calibrationLog ? (
              <table className={styles.table} style={{ marginBottom: "1.5rem" }}>
                <thead>
                  <tr><th>Date</th><th>Blocked action</th><th>Resolution</th><th>Bucket</th></tr>
                </thead>
                <tbody>
                  {businessState.calibrationLog.map((row, i) => (
                    <tr key={i}>
                      <td>{row.date}</td>
                      <td>{row.blockedAction}</td>
                      <td>{row.resolution}</td>
                      <td>{row.bucket}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <pre className={styles.rawSection} style={{ marginBottom: "1.5rem" }}>{businessState.calibrationLogRaw}</pre>
            )}

            <h3 style={{ marginBottom: "0.6rem" }}>Recent autonomous decisions</h3>
            <pre className={styles.rawSection} style={{ marginBottom: "1.5rem" }}>
              {businessState.sections["Recent autonomous decisions (most recent first)"] ?? "None recorded."}
            </pre>

            <h3 style={{ marginBottom: "0.6rem" }}>Open escalations</h3>
            <pre className={styles.rawSection} style={{ marginBottom: "1.5rem" }}>
              {businessState.sections["Open escalations (nothing autonomous can resolve without founder input)"] ?? "None recorded."}
            </pre>
          </>
        )}

        <h3 style={{ marginBottom: "0.6rem" }}>Infrastructure</h3>
        <table className={styles.table}>
          <thead>
            <tr><th>Check</th><th>Status</th><th>Detail</th></tr>
          </thead>
          <tbody>
            {CRON_JOBS.map((job) => (
              <tr key={job.path}>
                <td>{job.path}</td>
                <td><span className={styles.status} data-status="not-wired">not wired</span></td>
                <td>Schedule {job.schedule} - no run history persisted yet</td>
              </tr>
            ))}
            <tr>
              <td>CI (GitHub Actions)</td>
              <td><span className={styles.status} data-status="not-wired">not wired</span></td>
              <td>Needs a GITHUB_TOKEN - phase 2</td>
            </tr>
            <tr>
              <td>Error tracking (Sentry)</td>
              <td><span className={styles.status} data-status="not-wired">not wired</span></td>
              <td>SENTRY_DSN unset</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
