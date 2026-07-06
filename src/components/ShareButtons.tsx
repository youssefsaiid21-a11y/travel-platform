"use client";

import { useTemporaryFlag } from "@/lib/useTemporaryFlag";
import styles from "./ShareButtons.module.css";

interface ShareButtonsProps {
  bookingRef: string | null;
  route: string;        // e.g. "LHR → JFK"
  airline: string;
  departsAt: string;    // human-readable, already formatted
  arrivesAt: string;
  passengers: string[];
  totalAmount: string;
  totalCurrency: string;
}

function fmtAmount(amount: string, currency: string): string {
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

function buildMessage(p: ShareButtonsProps): string {
  const pax = p.passengers.join(", ");
  return [
    "✈️ Flight booking confirmed!",
    "",
    `Ref: ${p.bookingRef ?? "-"}`,
    `${p.route}`,
    `${p.airline}`,
    `Departs: ${p.departsAt}`,
    `Arrives: ${p.arrivesAt}`,
    `Passengers: ${pax}`,
    "",
    `Total: ${fmtAmount(p.totalAmount, p.totalCurrency)}`,
    "",
    "Booked via Orbi 🌐",
  ].join("\n");
}

export function ShareButtons(props: ShareButtonsProps) {
  const [copied, markCopied] = useTemporaryFlag();

  const msg = buildMessage(props);
  const encoded = encodeURIComponent(msg);

  const whatsappUrl = `https://wa.me/?text=${encoded}`;
  const smsUrl = `sms:&body=${encoded}`;

  async function copyToClipboard() {
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(msg);
      } else {
        const ta = document.createElement("textarea");
        ta.value = msg;
        ta.style.cssText = "position:fixed;opacity:0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      markCopied();
    } catch { /* ignore */ }
  }

  return (
    <div className={styles.wrap}>
      <p className={styles.label}>Share confirmation</p>
      <div className={styles.row}>
        <a
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={`${styles.btn} ${styles.whatsapp}`}
          aria-label="Share via WhatsApp"
        >
          <WhatsAppIcon />
          WhatsApp
        </a>

        <a
          href={smsUrl}
          className={`${styles.btn} ${styles.imessage}`}
          aria-label="Share via iMessage"
        >
          <IMessageIcon />
          iMessage
        </a>

        <button
          className={`${styles.btn} ${styles.copy} ${copied ? styles.copied : ""}`}
          onClick={copyToClipboard}
          type="button"
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
    </div>
  );
}

function WhatsAppIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
    </svg>
  );
}

function IMessageIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"/>
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  );
}
