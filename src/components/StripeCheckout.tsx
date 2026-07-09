"use client";

import { useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  CardElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import type { NormalizedOffer } from "@/lib/duffel/types";
import type { SearchParams } from "@/lib/parser/types";
import type { BookingPassenger } from "@/app/api/booking/route";
import { chargeAmountCents, centsToAmountString } from "@/lib/pricing";
import styles from "./StripeCheckout.module.css";

const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ""
);

interface Props {
  clientSecret: string;
  offer: NormalizedOffer;
  searchParams: SearchParams;
  passengers: BookingPassenger[];
  onSuccess: (bookingId: string) => void;
  onError: (msg: string) => void;
  specialRequests?: string;
}

function CheckoutForm({
  clientSecret,
  offer,
  searchParams,
  passengers,
  onSuccess,
  onError,
  specialRequests,
}: Props) {
  const stripe = useStripe();
  const elements = useElements();
  const [paying, setPaying] = useState(false);
  const [cardComplete, setCardComplete] = useState(false);

  const fmtTotal = (() => {
    try {
      return new Intl.NumberFormat("en-GB", {
        style: "currency",
        currency: offer.total_currency,
        minimumFractionDigits: 2,
      }).format(parseFloat(centsToAmountString(chargeAmountCents(offer.total_amount))));
    } catch {
      return `${offer.total_amount} ${offer.total_currency}`;
    }
  })();

  async function handlePay() {
    if (!stripe || !elements) return;
    setPaying(true);

    const cardElement = elements.getElement(CardElement);
    if (!cardElement) {
      setPaying(false);
      return;
    }

    const { paymentIntent, error } = await stripe.confirmCardPayment(
      clientSecret,
      { payment_method: { card: cardElement } }
    );

    if (error || !paymentIntent) {
      onError(error?.message ?? "Payment failed.");
      setPaying(false);
      return;
    }

    const res = await fetch("/api/booking", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        offerId: offer.id,
        searchParams,
        passengers,
        stripePaymentIntentId: paymentIntent.id,
        ...(specialRequests ? { specialRequests } : {}),
      }),
    });

    if (!res.ok) {
      const body = await res.json();
      onError(body.error ?? "Booking failed after payment.");
      setPaying(false);
      return;
    }

    const { booking } = await res.json();
    onSuccess(booking.id);
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.cardWrapper}>
        <CardElement
          options={{
            style: {
              base: {
                fontSize: "16px",
                color: "#1f2937",
                "::placeholder": { color: "#9ca3af" },
              },
            },
          }}
          onChange={(e) => setCardComplete(e.complete)}
        />
      </div>
      <button
        className={styles.payButton}
        onClick={handlePay}
        disabled={paying || !stripe || !cardComplete}
      >
        {paying ? "Processing…" : `Confirm and pay ${fmtTotal}`}
      </button>
    </div>
  );
}

export default function StripeCheckout(props: Props) {
  return (
    <Elements stripe={stripePromise} options={{ clientSecret: props.clientSecret }}>
      <CheckoutForm {...props} />
    </Elements>
  );
}
