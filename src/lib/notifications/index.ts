import type { NormalizedOffer } from "@/lib/duffel/types";
import { sendConfirmationEmail } from "./email";
import { sendConfirmationSms } from "./sms";
import { sendConfirmationWhatsApp } from "./whatsapp";

export interface BookingNotificationData {
  bookingId: string;
  bookingRef: string | null;
  passengerName: string;
  origin: string;
  destination: string;
  departureDate: string;
  totalAmount: string;
  totalCurrency: string;
  userEmail: string;
  userPhone: string | null;
  appUrl: string;
}

function buildNotificationData(booking: {
  id: string;
  duffelBookingRef: string | null;
  totalAmount: string;
  totalCurrency: string;
  offerSnapshot: string;
  passengerNames: string;
  user: { email: string; passengerProfile: { phone: string } | null };
}): BookingNotificationData {
  const offer = JSON.parse(booking.offerSnapshot) as NormalizedOffer;
  const firstSeg = offer.slices[0]?.segments[0];
  const lastSeg = offer.slices[0]?.segments.at(-1);

  const origin = firstSeg?.origin.iata_code ?? "???";
  const destination = lastSeg?.destination.iata_code ?? "???";
  const departureDate = firstSeg?.departing_at
    ? new Date(firstSeg.departing_at).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "-";

  const names = JSON.parse(booking.passengerNames) as string[];
  const passengerName = names[0] ?? "Passenger";

  return {
    bookingId: booking.id,
    bookingRef: booking.duffelBookingRef,
    passengerName,
    origin,
    destination,
    departureDate,
    totalAmount: booking.totalAmount,
    totalCurrency: booking.totalCurrency,
    userEmail: booking.user.email,
    userPhone: booking.user.passengerProfile?.phone ?? null,
    appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "https://orbi.travel",
  };
}

export async function sendBookingConfirmations(booking: Parameters<typeof buildNotificationData>[0]): Promise<void> {
  const data = buildNotificationData(booking);

  // Fire all three in parallel; failures in one don't block the others
  await Promise.allSettled([
    sendConfirmationEmail(data),
    sendConfirmationSms(data),
    sendConfirmationWhatsApp(data),
  ]);
}
