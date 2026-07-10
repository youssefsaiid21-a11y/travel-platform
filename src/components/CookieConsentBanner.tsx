"use client";
import { useState, useEffect, useRef } from "react";
import styles from "./CookieConsentBanner.module.css";

function getConsentCookie(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)orbi_cookie_consent=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function setConsentCookie(value: "accepted" | "declined") {
  // 1 year - long enough that returning visitors aren't re-asked constantly,
  // short enough that a consent choice doesn't stick around forever.
  document.cookie = `orbi_cookie_consent=${value}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
}

// NextAuth's session cookie is strictly necessary (the app can't function
// without it) and isn't gated here. orbi_channel (first-touch UTM
// attribution, src/proxy.ts) is the only non-essential cookie this app
// sets, and it's gated on this consent choice.
export function CookieConsentBanner() {
  const [visible, setVisible] = useState(false);
  const bannerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!getConsentCookie()) setVisible(true);
  }, []);

  useEffect(() => {
    if (visible) bannerRef.current?.focus();
  }, [visible]);

  if (!visible) return null;

  function handleChoice(choice: "accepted" | "declined") {
    setConsentCookie(choice);
    setVisible(false);
  }

  // Escape is treated as a real consent decision (decline non-essential),
  // not a no-op dismissal - matches the Decline button, so the choice is
  // actually recorded rather than just hiding the banner for this session.
  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") handleChoice("declined");
  }

  return (
    <div
      ref={bannerRef}
      className={styles.banner}
      role="dialog"
      aria-modal="true"
      aria-label="Cookie consent"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      <p className={styles.text}>
        We use a strictly-necessary cookie to keep you signed in. We&apos;d also
        like to set a cookie that remembers how you found Orbi (e.g. Product
        Hunt, Google) - purely for our own analytics, never shared or sold.
      </p>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.decline}
          onClick={() => handleChoice("declined")}
        >
          Decline non-essential
        </button>
        <button
          type="button"
          className={styles.accept}
          onClick={() => handleChoice("accepted")}
        >
          Accept
        </button>
      </div>
    </div>
  );
}
