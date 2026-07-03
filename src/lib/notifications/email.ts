import type { BookingNotificationData, PriceDropNotificationData } from "./index";

function formatPrice(amount: string, currency: string): string {
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

function buildHtml(data: BookingNotificationData): string {
  const ref = data.bookingRef ?? data.bookingId.slice(0, 8).toUpperCase();
  const price = formatPrice(data.totalAmount, data.totalCurrency);
  const bookingUrl = `${data.appUrl}/booking/${data.bookingId}`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f0f9ff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:520px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08)">
    <div style="background:linear-gradient(135deg,#0284c7,#0ea5e9);padding:32px 36px">
      <div style="font-size:22px;font-weight:700;color:#fff;letter-spacing:-0.02em">Orbi</div>
      <div style="font-size:14px;color:rgba(255,255,255,0.8);margin-top:4px">AI Flight Search</div>
    </div>
    <div style="padding:32px 36px">
      <h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#0f172a">Booking confirmed</h1>
      <p style="margin:0 0 28px;font-size:14px;color:#64748b">Your flight has been booked successfully.</p>

      <div style="background:#f8fafc;border-radius:8px;padding:20px;margin-bottom:24px">
        <div style="display:flex;justify-content:space-between;margin-bottom:12px">
          <span style="font-size:12px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em">Booking ref</span>
          <span style="font-size:14px;font-weight:700;color:#0f172a;font-family:monospace">${ref}</span>
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:12px">
          <span style="font-size:12px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em">Route</span>
          <span style="font-size:14px;font-weight:600;color:#0f172a">${data.origin} &rarr; ${data.destination}</span>
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:12px">
          <span style="font-size:12px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em">Departure</span>
          <span style="font-size:14px;color:#0f172a">${data.departureDate}</span>
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:12px">
          <span style="font-size:12px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em">Passenger</span>
          <span style="font-size:14px;color:#0f172a">${data.passengerName}</span>
        </div>
        <div style="border-top:1px solid #e2e8f0;margin:12px 0"></div>
        <div style="display:flex;justify-content:space-between">
          <span style="font-size:12px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em">Total paid</span>
          <span style="font-size:16px;font-weight:700;color:#0284c7">${price}</span>
        </div>
      </div>

      <a href="${bookingUrl}" style="display:block;text-align:center;background:#0284c7;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:14px 24px;border-radius:8px">View booking details</a>

      <p style="margin:24px 0 0;font-size:12px;color:#94a3b8;text-align:center">
        Questions? Reply to this email or visit <a href="${data.appUrl}" style="color:#0284c7;text-decoration:none">orbi.travel</a>
      </p>
    </div>
  </div>
</body>
</html>`;
}

export async function sendConfirmationEmail(data: BookingNotificationData): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn("[notifications/email] RESEND_API_KEY not set - skipping");
    return;
  }

  const ref = data.bookingRef ?? data.bookingId.slice(0, 8).toUpperCase();

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Orbi Bookings <bookings@orbi.travel>",
      to: [data.userEmail],
      subject: `Booking confirmed - ${ref}`,
      html: buildHtml(data),
    }),
  });

  if (!res.ok) {
    console.error("[notifications/email] Resend error:", res.status, await res.text().catch(() => ""));
  }
}

function buildPriceDropHtml(data: PriceDropNotificationData): string {
  const newPrice = formatPrice(data.newAmount, data.newCurrency);
  const oldPrice = formatPrice(data.previousAmount, data.previousCurrency);
  const searchUrl = data.appUrl;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f0f9ff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:520px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08)">
    <div style="background:linear-gradient(135deg,#16a34a,#22c55e);padding:32px 36px">
      <div style="font-size:22px;font-weight:700;color:#fff;letter-spacing:-0.02em">Orbi</div>
      <div style="font-size:14px;color:rgba(255,255,255,0.85);margin-top:4px">Price drop alert</div>
    </div>
    <div style="padding:32px 36px">
      <h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#0f172a">Good news - the price dropped</h1>
      <p style="margin:0 0 28px;font-size:14px;color:#64748b">A flight you're tracking just got cheaper.</p>

      <div style="background:#f8fafc;border-radius:8px;padding:20px;margin-bottom:24px">
        <div style="display:flex;justify-content:space-between;margin-bottom:12px">
          <span style="font-size:12px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em">Route</span>
          <span style="font-size:14px;font-weight:600;color:#0f172a">${data.origin} &rarr; ${data.destination}</span>
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:12px">
          <span style="font-size:12px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em">Departure</span>
          <span style="font-size:14px;color:#0f172a">${data.departureDate}</span>
        </div>
        <div style="border-top:1px solid #e2e8f0;margin:12px 0"></div>
        <div style="display:flex;justify-content:space-between;margin-bottom:6px">
          <span style="font-size:12px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em">Was</span>
          <span style="font-size:14px;color:#94a3b8;text-decoration:line-through">${oldPrice}</span>
        </div>
        <div style="display:flex;justify-content:space-between">
          <span style="font-size:12px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em">Now</span>
          <span style="font-size:16px;font-weight:700;color:#16a34a">${newPrice}</span>
        </div>
      </div>

      <a href="${searchUrl}" style="display:block;text-align:center;background:#16a34a;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:14px 24px;border-radius:8px">Search this flight</a>

      <p style="margin:24px 0 0;font-size:12px;color:#94a3b8;text-align:center">
        Prices can change quickly - book soon if you want this fare.
      </p>
    </div>
  </div>
</body>
</html>`;
}

export async function sendPriceDropEmail(data: PriceDropNotificationData): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn("[notifications/email] RESEND_API_KEY not set - skipping");
    return;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Orbi Alerts <alerts@orbi.travel>",
      to: [data.userEmail],
      subject: `Price drop: ${data.origin} → ${data.destination} is now ${formatPrice(data.newAmount, data.newCurrency)}`,
      html: buildPriceDropHtml(data),
    }),
  });

  if (!res.ok) {
    console.error("[notifications/email] Resend error:", res.status, await res.text().catch(() => ""));
  }
}
