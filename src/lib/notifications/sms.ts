import type { BookingNotificationData, PriceDropNotificationData } from "./index";

function formatPrice(amount: string, currency: string): string {
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(parseFloat(amount));
  } catch {
    return `${amount} ${currency}`;
  }
}

export async function sendConfirmationSms(data: BookingNotificationData): Promise<void> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_SMS_FROM;

  if (!sid || !token || !from) {
    console.warn("[notifications/sms] TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_SMS_FROM not set - skipping");
    return;
  }
  if (!data.userPhone) {
    console.warn("[notifications/sms] No phone number on passenger profile - skipping");
    return;
  }

  const ref = data.bookingRef ?? data.bookingId.slice(0, 8).toUpperCase();
  const price = formatPrice(data.totalAmount, data.totalCurrency);
  const bookingUrl = `${data.appUrl}/booking/${data.bookingId}`;

  const body =
    `Orbi: Booking confirmed! Ref: ${ref}. ` +
    `${data.origin}->${data.destination}, ${data.departureDate}. ` +
    `${price}. Details: ${bookingUrl}`;

  const params = new URLSearchParams({ From: from, To: data.userPhone, Body: body });

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
    // Truncated - Twilio error bodies routinely echo back the invalid `To`
    // phone number in their message field.
    console.error(
      "[notifications/sms] Twilio error:",
      res.status,
      (await res.text().catch(() => "")).slice(0, 300)
    );
  }
}

export async function sendPriceDropSms(data: PriceDropNotificationData): Promise<void> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_SMS_FROM;

  if (!sid || !token || !from) {
    console.warn("[notifications/sms] TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_SMS_FROM not set - skipping");
    return;
  }
  if (!data.userPhone) {
    console.warn("[notifications/sms] No phone number on passenger profile - skipping");
    return;
  }

  const newPrice = formatPrice(data.newAmount, data.newCurrency);
  const oldPrice = formatPrice(data.previousAmount, data.previousCurrency);

  const body =
    `Orbi: Price drop! ${data.origin}->${data.destination}, ${data.departureDate}. ` +
    `Was ${oldPrice}, now ${newPrice}. Search again: ${data.appUrl}`;

  const params = new URLSearchParams({ From: from, To: data.userPhone, Body: body });

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
    // Truncated - Twilio error bodies routinely echo back the invalid `To`
    // phone number in their message field.
    console.error(
      "[notifications/sms] Twilio error:",
      res.status,
      (await res.text().catch(() => "")).slice(0, 300)
    );
  }
}
