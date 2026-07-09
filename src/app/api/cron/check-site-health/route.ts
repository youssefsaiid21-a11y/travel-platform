import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/cronAuth";
import { getBaseUrl } from "@/lib/site";
import { sendAlertEmail } from "@/lib/notifications/email";

// Checklist item 14 ("no uptime monitoring") - a DIY check using the
// existing Vercel Cron pattern (see vercel.json) rather than a new
// third-party monitoring account. Important limitation, not glossed over:
// Vercel's Hobby plan only runs cron jobs once per day, so this is a daily
// health digest, not near-real-time uptime alerting - a real outage could
// run for up to ~24 hours before this catches it. A genuine uptime monitor
// (UptimeRobot, Checkly, etc., checking every few minutes) is the correct
// long-term fix; this closes the "literally nothing checks" gap cheaply in
// the meantime.
export async function POST(req: NextRequest) {
  const unauthorized = requireCronSecret(req);
  if (unauthorized) return unauthorized;

  const url = getBaseUrl();
  let ok = false;
  let detail = "";

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    ok = res.ok;
    detail = `HTTP ${res.status}`;
  } catch (err) {
    detail = err instanceof Error ? err.message : "Unknown fetch error";
  }

  if (!ok) {
    await sendAlertEmail(
      "Orbi site health check failed",
      `${url} did not respond successfully.\n\nDetail: ${detail}\n\nChecked at: ${new Date().toISOString()}`
    ).catch((err) => console.error("Failed to send site health alert:", err));
  }

  return NextResponse.json({ ok, detail });
}
