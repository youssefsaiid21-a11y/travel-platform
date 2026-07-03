import type { BookingNotificationData } from "./index";

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

export async function sendConfirmationWhatsApp(data: BookingNotificationData): Promise<void> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM; // e.g. "whatsapp:+14155238886"

  if (!sid || !token || !from) {
    console.warn("[notifications/whatsapp] TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_WHATSAPP_FROM not set - skipping");
    return;
  }
  if (!data.userPhone) {
    console.warn("[notifications/whatsapp] No phone number on passenger profile - skipping");
    return;
  }

  const ref = data.bookingRef ?? data.bookingId.slice(0, 8).toUpperCase();
  const price = formatPrice(data.totalAmount, data.totalCurrency);
  const bookingUrl = `${data.appUrl}/booking/${data.bookingId}`;

  const body =
    `Booking confirmed - Orbi\n\n` +
    `Ref: ${ref}\n` +
    `Route: ${data.origin} -> ${data.destination}\n` +
    `Departure: ${data.departureDate}\n` +
    `Passenger: ${data.passengerName}\n` +
    `Total: ${price}\n\n` +
    `View details: ${bookingUrl}`;

  const to = data.userPhone.startsWith("whatsapp:") ? data.userPhone : `whatsapp:${data.userPhone}`;
  const params = new URLSearchParams({ From: from, To: to, Body: body });

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    }
  );

  if (!res.ok) {
    console.error("[notifications/whatsapp] Twilio error:", res.status, await res.text().catch(() => ""));
  }
}
