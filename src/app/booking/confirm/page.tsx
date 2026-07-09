"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import dynamic from "next/dynamic";
import type { NormalizedOffer } from "@/lib/duffel/types";
import type { SearchParams } from "@/lib/parser/types";
import type { BookingPassenger } from "@/app/api/booking/route";
import { passengerValidationError } from "@/lib/passengerValidation";
import { getCountryOptions } from "@/lib/countries";
import { SERVICE_FEE_CENTS, chargeAmountCents, centsToAmountString } from "@/lib/pricing";
import { BookingSteps } from "@/components/BookingSteps";
import { PlaneIcon, PassportIcon } from "@/components/icons";
import styles from "./page.module.css";

const StripeCheckout = dynamic(() => import("@/components/StripeCheckout"), {
  ssr: false,
});

interface PendingBooking {
  offer: NormalizedOffer;
  searchParams: SearchParams;
}

interface PassengerProfile {
  id: string;
  givenName: string;
  familyName: string;
  bornOn: string;
  gender: string;
  title: string;
  phone: string;
  specialRequests: string | null;
  nationality: string | null;
  passportNumber: string | null;
  passportExpiry: string | null;
}

const TITLES = ["mr", "ms", "mrs", "dr", "miss"] as const;
const GENDERS = [
  { value: "m", label: "Male" },
  { value: "f", label: "Female" },
] as const;

function useOfferExpiry(expiresAt: string | undefined) {
  const [secondsLeft, setSecondsLeft] = useState<number>(() => {
    if (!expiresAt) return Infinity;
    return Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000);
  });

  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => {
      const secs = Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000);
      setSecondsLeft(secs);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  const expired = secondsLeft <= 0;
  const urgent = !expired && secondsLeft <= 120; // under 2 minutes
  const mm = String(Math.floor(Math.max(0, secondsLeft) / 60)).padStart(2, "0");
  const ss = String(Math.max(0, secondsLeft) % 60).padStart(2, "0");
  const display = `${mm}:${ss}`;

  return { expired, urgent, display };
}

function buildPaxSummary(sp: SearchParams): string {
  const paxParts = sp.passengers.map((p) => {
    const n = p.count;
    const label = p.type === "adult" ? "adult" : p.type === "child" ? "child" : "infant";
    return `${n} ${label}${n > 1 ? "s" : ""}`;
  });
  const cabin = sp.cabin_class
    ? ` · ${sp.cabin_class.replace("_", " ")} class`
    : "";
  return paxParts.join(", ") + cabin;
}

function fmt(dt: string) {
  return new Date(dt).toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function fmtPrice(amount: string, currency: string) {
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

function formatDuration(iso: string) {
  const h = iso.match(/(\d+)H/)?.[1];
  const m = iso.match(/(\d+)M/)?.[1];
  return [h ? `${h}h` : "", m ? `${m}m` : ""].filter(Boolean).join(" ");
}

export default function ConfirmPage() {
  const router = useRouter();
  const { data: session } = useSession();

  const [pending] = useState<PendingBooking | null>(() => {
    if (typeof window === "undefined") return null;
    const raw = localStorage.getItem("pending_booking");
    if (!raw) return null;
    try { return JSON.parse(raw) as PendingBooking; } catch { return null; }
  });
  const [profile, setProfile] = useState<PassengerProfile | null | undefined>(undefined); // undefined = loading
  const [editMode, setEditMode] = useState(false);
  const [saveProfile, setSaveProfile] = useState(true);
  // Lazy initializer runs once on mount, not on every render - safe under
  // the render-purity rule, unlike calling Date.now() directly in render.
  const [todayStr] = useState(() => new Date().toISOString().slice(0, 10));

  // Form state for passenger 1 (account holder)
  const [form, setForm] = useState({
    given_name: "",
    family_name: "",
    born_on: "",
    gender: "m" as "m" | "f",
    title: "mr" as BookingPassenger["title"],
    phone_number: "",
    nationality: "",
    passport_number: "",
    passport_expiry: "",
  });

  // getCountryOptions() caches its result after the first call, so this is
  // effectively free on re-renders without needing its own memo hook.
  const countryOptions = getCountryOptions();

  // Extra passengers (indices 1+) for multi-pax bookings
  const [extraPassengers, setExtraPassengers] = useState<BookingPassenger[]>([]);

  // Special requests (shown in both quick-book and form mode)
  const [specialRequests, setSpecialRequests] = useState("");

  // Payment state
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [loadingIntent, setLoadingIntent] = useState(false);
  const [payError, setPayError] = useState("");
  const [step, setStep] = useState<"details" | "payment">("details");

  // Offer expiry countdown - hook must be called unconditionally
  const expiresAt = pending?.offer.expires_at;
  const expiry = useOfferExpiry(expiresAt);

  // Redirect if no pending booking; init extra passengers once pending is known
  useEffect(() => {
    if (!pending) {
      router.push("/");
      return;
    }
    if (pending.offer.passengers.length > 1) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setExtraPassengers(
        pending.offer.passengers.slice(1).map((p) => ({
          id: p.id,
          given_name: "",
          family_name: "",
          born_on: "",
          gender: "m" as const,
          title: "mr" as BookingPassenger["title"],
          email: session?.user?.email ?? "",
          phone_number: "",
          nationality: "",
          passport_number: "",
          passport_expiry: "",
        }))
      );
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally runs once - pending and session email are stable on mount

  // Fetch saved passenger profile
  useEffect(() => {
    fetch("/api/profile/passenger")
      .then((r) => (r.ok ? r.json() : null))
      .then((p: PassengerProfile | null) => {
        setProfile(p);
        if (p) {
          // Pre-fill the form from profile (shown in edit mode)
          setForm({
            given_name: p.givenName,
            family_name: p.familyName,
            born_on: p.bornOn,
            gender: p.gender as "m" | "f",
            title: p.title as BookingPassenger["title"],
            phone_number: p.phone,
            nationality: p.nationality ?? "",
            passport_number: p.passportNumber ?? "",
            passport_expiry: p.passportExpiry ?? "",
          });
          setSpecialRequests(p.specialRequests ?? "");
          // A profile saved before travel-document fields existed, never
          // filled in, or whose passport has since expired can't skip
          // straight to quick-book - the order will be rejected without
          // valid documents. Uses the same check as primaryIsValid() below
          // so this can't drift out of sync with what's actually required
          // to book (it previously only checked presence, not expiry).
          const profileDocsError = passengerValidationError(
            {
              given_name: p.givenName,
              family_name: p.familyName,
              born_on: p.bornOn,
              phone_number: p.phone,
              nationality: p.nationality ?? "",
              passport_number: p.passportNumber ?? "",
              passport_expiry: p.passportExpiry ?? "",
            },
            todayStr
          );
          if (profileDocsError) {
            setEditMode(true);
          }
        } else {
          // No profile yet - go straight to form
          setEditMode(true);
        }
      })
      .catch(() => {
        setProfile(null);
        setEditMode(true);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- todayStr never changes after mount (no setter is ever called), safe to omit
  }, []);

  const updateExtra = useCallback(
    (idx: number, field: keyof BookingPassenger, value: string) => {
      setExtraPassengers((prev) =>
        prev.map((p, i) => (i === idx ? { ...p, [field]: value } : p))
      );
    },
    []
  );

  function buildPassengers(): BookingPassenger[] {
    if (!pending) return [];
    const email = session?.user?.email ?? "";

    const primary: BookingPassenger = {
      id: pending.offer.passengers[0].id,
      given_name: form.given_name,
      family_name: form.family_name,
      born_on: form.born_on,
      gender: form.gender,
      title: form.title,
      email,
      phone_number: form.phone_number,
      nationality: form.nationality,
      passport_number: form.passport_number.trim(),
      passport_expiry: form.passport_expiry,
    };

    return [primary, ...extraPassengers.map((ep, i) => ({
      ...ep,
      id: pending.offer.passengers[i + 1].id,
      email: ep.email || email,
      passport_number: ep.passport_number.trim(),
    }))];
  }

  function primaryIsValid() {
    return !passengerValidationError(form, todayStr);
  }

  function extrasAreValid() {
    return extraPassengers.every((p) => !passengerValidationError(p, todayStr));
  }

  async function handleProceed() {
    if (!pending) return;
    setLoadingIntent(true);
    setPayError("");

    // Save profile if requested
    if (saveProfile && (editMode || !profile)) {
      await fetch("/api/profile/passenger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          givenName: form.given_name,
          familyName: form.family_name,
          bornOn: form.born_on,
          gender: form.gender,
          title: form.title,
          phone: form.phone_number,
          specialRequests: specialRequests || null,
          nationality: form.nationality || null,
          passportNumber: form.passport_number.trim() || null,
          passportExpiry: form.passport_expiry || null,
        }),
      });
    }

    const res = await fetch("/api/stripe/payment-intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ offerId: pending.offer.id }),
    });

    if (!res.ok) {
      const body = await res.json();
      setPayError(body.error ?? "Could not initialise payment.");
      setLoadingIntent(false);
      return;
    }

    const { clientSecret: cs } = await res.json();
    setClientSecret(cs);
    setStep("payment");
    setLoadingIntent(false);
  }

  function handleSuccess(bookingId: string) {
    localStorage.removeItem("pending_booking");
    router.push(`/booking/${bookingId}`);
  }

  if (!pending || profile === undefined) {
    return (
      <div className={styles.page}>
        <div className={styles.loadingWrap}>
          <div className={styles.loadingSpinner} />
          <p className={styles.loadingText}>Loading your booking…</p>
        </div>
      </div>
    );
  }

  const { offer } = pending;
  const isQuickBook = !!profile && !editMode;
  const needsExtraPassengers = extraPassengers.length > 0;
  const canProceed =
    !expiry.expired &&
    (isQuickBook ? extrasAreValid() : primaryIsValid() && extrasAreValid());

  return (
    <div className={styles.page}>
      <div className={styles.container}>

        <BookingSteps current={step} />

        {/* ── Offer expiry bar ───────────────────────── */}
        {expiry.expired ? (
          <div className={`${styles.expiryBar} ${styles.expiryBarExpired}`} role="alert">
            <span><span aria-hidden="true">⚠ </span>This price has expired</span>
            <button
              className={styles.searchAgainLink}
              onClick={() => router.push("/")}
            >
              Search again →
            </button>
          </div>
        ) : offer.expires_at ? (
          <div
            className={`${styles.expiryBar} ${
              expiry.urgent ? styles.expiryBarUrgent : styles.expiryBarLive
            }`}
            role={expiry.urgent ? "alert" : undefined}
          >
            <span>
              <span aria-hidden="true">{expiry.urgent ? "⏰ " : "🔒 "}</span>
              {expiry.urgent ? "Price expiring soon!" : "Price locked"}
            </span>
            <span className={styles.expiryTime} aria-label={`${expiry.display} remaining`}>{expiry.display}</span>
          </div>
        ) : null}

        {/* ── Flight summary ─────────────────────────── */}
        {offer.slices.map((slice, si) => {
          const first = slice.segments[0];
          const last = slice.segments[slice.segments.length - 1];
          return (
            <section key={si} className={styles.flightCard}>
              <div className={styles.flightMeta}>
                <span className={styles.sliceLabel}>
                  {offer.slices.length > 1 ? (si === 0 ? "Outbound" : "Return") : "Flight"}
                </span>
                <span className={styles.flightNum}>
                  {first.marketing_carrier.iata_code}
                  {first.flight_number}
                </span>
              </div>
              <div className={styles.flightRoute}>
                <div className={styles.flightEndpoint}>
                  <span className={styles.flightTime}>
                    {new Date(first.departing_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false })}
                  </span>
                  <span className={styles.flightIata}>{first.origin.iata_code}</span>
                  <span className={styles.flightCity}>{first.origin.name.split(" ").slice(0, 2).join(" ")}</span>
                </div>
                <div className={styles.flightMiddle}>
                  <span className={styles.flightDur}>{formatDuration(slice.duration)}</span>
                  <div className={styles.flightTrack}>
                    <div className={styles.flightLine} />
                    <div className={styles.planeGlider}>
                      <PlaneIcon />
                    </div>
                  </div>
                  <span className={styles.flightStops}>
                    {slice.stops === 0 ? "Non-stop" : `${slice.stops} stop${slice.stops > 1 ? "s" : ""}`}
                  </span>
                </div>
                <div className={`${styles.flightEndpoint} ${styles.right}`}>
                  <span className={styles.flightTime}>
                    {new Date(last.arriving_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false })}
                  </span>
                  <span className={styles.flightIata}>{last.destination.iata_code}</span>
                  <span className={styles.flightCity}>{last.destination.name.split(" ").slice(0, 2).join(" ")}</span>
                </div>
              </div>
              <div className={styles.flightDateRow}>
                {fmt(first.departing_at)} · {offer.owner.name}
              </div>
            </section>
          );
        })}

        {/* ── Passenger summary ─────────────────────────── */}
        <div className={styles.paxSummary}>
          {buildPaxSummary(pending.searchParams)}
        </div>

        {/* ── Price breakdown (guardrail: always before payment) ── */}
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Price breakdown</h2>
          <div className={styles.priceRow}>
            <span>Base fare</span>
            <span>{fmtPrice(offer.base_amount, offer.total_currency)}</span>
          </div>
          {offer.tax_amount && (
            <div className={styles.priceRow}>
              <span>Taxes &amp; fees</span>
              <span>{fmtPrice(offer.tax_amount, offer.total_currency)}</span>
            </div>
          )}
          <div className={styles.priceRow}>
            <span>Service fee</span>
            <span>{fmtPrice(centsToAmountString(SERVICE_FEE_CENTS), offer.total_currency)}</span>
          </div>
          <div className={`${styles.priceRow} ${styles.totalRow}`}>
            <span>Total</span>
            <span>
              {fmtPrice(centsToAmountString(chargeAmountCents(offer.total_amount)), offer.total_currency)}
            </span>
          </div>
        </section>

        {step === "details" && (
          <>
            {/* ── Quick-book: returning user ─────────── */}
            {isQuickBook && (
              <section className={styles.card}>
                <div className={styles.profileHeader}>
                  <div>
                    <h2 className={styles.cardTitle}>Passenger</h2>
                    <p className={styles.profileName}>
                      {profile.givenName} {profile.familyName}
                    </p>
                    <p className={styles.profileMeta}>
                      {session?.user?.email} · {profile.phone}
                    </p>
                    <p className={styles.profileMeta}>
                      Passport {profile.passportNumber} ({profile.nationality}) · expires{" "}
                      {profile.passportExpiry && new Date(profile.passportExpiry).toLocaleDateString("en-GB", { dateStyle: "medium" })}
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: "0.5rem", flexShrink: 0 }}>
                    <button
                      className={styles.editLink}
                      onClick={() => setEditMode(true)}
                    >
                      Edit
                    </button>
                  </div>
                </div>
              </section>
            )}

            {/* ── First-time form ────────────────────── */}
            {!isQuickBook && (
              <section className={styles.card}>
                <h2 className={styles.cardTitle}>
                  Your details
                  {profile && (
                    <button className={styles.cancelEdit} onClick={() => setEditMode(false)}>
                      Cancel
                    </button>
                  )}
                </h2>

                <div className={styles.grid}>
                  <label className={styles.label}>
                    Title
                    <select className={styles.select} value={form.title}
                      onChange={(e) => setForm((f) => ({ ...f, title: e.target.value as BookingPassenger["title"] }))}>
                      {TITLES.map((t) => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                    </select>
                  </label>

                  <label className={styles.label}>
                    Gender
                    <select className={styles.select} value={form.gender}
                      onChange={(e) => setForm((f) => ({ ...f, gender: e.target.value as "m" | "f" }))}>
                      {GENDERS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
                    </select>
                  </label>

                  <label className={styles.label}>
                    First name
                    <input className={styles.input} value={form.given_name} required
                      onChange={(e) => setForm((f) => ({ ...f, given_name: e.target.value }))} />
                  </label>

                  <label className={styles.label}>
                    Last name
                    <input className={styles.input} value={form.family_name} required
                      onChange={(e) => setForm((f) => ({ ...f, family_name: e.target.value }))} />
                  </label>

                  <label className={styles.label}>
                    Date of birth
                    <input type="date" className={styles.input} value={form.born_on} required
                      onChange={(e) => setForm((f) => ({ ...f, born_on: e.target.value }))} />
                  </label>

                  <label className={styles.label}>
                    Phone number
                    <input type="tel" className={styles.input} placeholder="+44 7700 900000"
                      value={form.phone_number} required
                      onChange={(e) => setForm((f) => ({ ...f, phone_number: e.target.value }))} />
                  </label>

                  <label className={styles.label}>
                    Nationality
                    {countryOptions.length > 0 ? (
                      <select className={styles.select} value={form.nationality} required
                        onChange={(e) => setForm((f) => ({ ...f, nationality: e.target.value }))}>
                        <option value="" disabled>Select country</option>
                        {countryOptions.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                      </select>
                    ) : (
                      <input className={styles.input} value={form.nationality} required
                        placeholder="ISO country code, e.g. GB"
                        onChange={(e) => setForm((f) => ({ ...f, nationality: e.target.value.toUpperCase() }))} />
                    )}
                  </label>

                  <label className={styles.label}>
                    <span className={styles.labelText}>
                      <PassportIcon className={styles.labelIcon} />
                      Passport number
                    </span>
                    <input className={styles.input} value={form.passport_number} required
                      onChange={(e) => setForm((f) => ({ ...f, passport_number: e.target.value }))} />
                  </label>

                  <label className={styles.label}>
                    Passport expiry
                    <input type="date" className={styles.input} value={form.passport_expiry} required
                      min={todayStr}
                      onChange={(e) => setForm((f) => ({ ...f, passport_expiry: e.target.value }))} />
                  </label>
                </div>

                <label className={styles.saveCheck}>
                  <input
                    type="checkbox"
                    checked={saveProfile}
                    onChange={(e) => setSaveProfile(e.target.checked)}
                  />
                  <span>Save my details for faster booking next time</span>
                </label>
              </section>
            )}

            {/* ── Extra passengers (always shown if multi-pax) ── */}
            {needsExtraPassengers && extraPassengers.map((ep, i) => (
              <section key={i} className={styles.card}>
                <h2 className={styles.cardTitle}>
                  Passenger {i + 2}
                  <span className={styles.passengerType}> ({offer.passengers[i + 1]?.type ?? "adult"})</span>
                </h2>
                <div className={styles.grid}>
                  <label className={styles.label}>
                    Title
                    <select className={styles.select} value={ep.title}
                      onChange={(e) => updateExtra(i, "title", e.target.value)}>
                      {TITLES.map((t) => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                    </select>
                  </label>
                  <label className={styles.label}>
                    Gender
                    <select className={styles.select} value={ep.gender}
                      onChange={(e) => updateExtra(i, "gender", e.target.value)}>
                      {GENDERS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
                    </select>
                  </label>
                  <label className={styles.label}>
                    First name
                    <input className={styles.input} value={ep.given_name} required
                      onChange={(e) => updateExtra(i, "given_name", e.target.value)} />
                  </label>
                  <label className={styles.label}>
                    Last name
                    <input className={styles.input} value={ep.family_name} required
                      onChange={(e) => updateExtra(i, "family_name", e.target.value)} />
                  </label>
                  <label className={styles.label}>
                    Date of birth
                    <input type="date" className={styles.input} value={ep.born_on} required
                      onChange={(e) => updateExtra(i, "born_on", e.target.value)} />
                  </label>
                  <label className={styles.label}>
                    Phone
                    <input type="tel" className={styles.input} value={ep.phone_number} required
                      onChange={(e) => updateExtra(i, "phone_number", e.target.value)} />
                  </label>
                  <label className={styles.label}>
                    Nationality
                    {countryOptions.length > 0 ? (
                      <select className={styles.select} value={ep.nationality} required
                        onChange={(e) => updateExtra(i, "nationality", e.target.value)}>
                        <option value="" disabled>Select country</option>
                        {countryOptions.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                      </select>
                    ) : (
                      <input className={styles.input} value={ep.nationality} required
                        placeholder="ISO country code, e.g. GB"
                        onChange={(e) => updateExtra(i, "nationality", e.target.value.toUpperCase())} />
                    )}
                  </label>
                  <label className={styles.label}>
                    <span className={styles.labelText}>
                      <PassportIcon className={styles.labelIcon} />
                      Passport number
                    </span>
                    <input className={styles.input} value={ep.passport_number} required
                      onChange={(e) => updateExtra(i, "passport_number", e.target.value)} />
                  </label>
                  <label className={styles.label}>
                    Passport expiry
                    <input type="date" className={styles.input} value={ep.passport_expiry} required
                      min={todayStr}
                      onChange={(e) => updateExtra(i, "passport_expiry", e.target.value)} />
                  </label>
                </div>
              </section>
            ))}

            {/* ── Special requests ───────────────────── */}
            <section className={styles.card}>
              <h2 className={styles.cardTitle}>Special requests <span className={styles.optional}>(optional)</span></h2>
              <textarea
                className={styles.textarea}
                placeholder="Wheelchair access, meal preference, seat request…"
                value={specialRequests}
                onChange={(e) => setSpecialRequests(e.target.value)}
                rows={3}
              />
            </section>

            {payError && <p className={styles.error}>{payError}</p>}

            <button
              className={styles.proceedButton}
              onClick={handleProceed}
              disabled={loadingIntent || !canProceed}
            >
              {loadingIntent
                ? "Preparing payment…"
                : `Pay ${fmtPrice(centsToAmountString(chargeAmountCents(offer.total_amount)), offer.total_currency)}`}
            </button>

            <div className={styles.trustBar}>
              <span aria-hidden="true">🔒</span>
              <span>Secured by Stripe</span>
              <span className={styles.trustSeparator} aria-hidden="true">·</span>
              <span>256-bit SSL</span>
              <span className={styles.trustSeparator} aria-hidden="true">·</span>
              <span>Powered by Duffel</span>
            </div>
          </>
        )}

        {/* ── Payment step ───────────────────────────── */}
        {step === "payment" && clientSecret && (
          <section className={styles.card}>
            <h2 className={styles.cardTitle}>
              Payment
              <button
                className={styles.cancelEdit}
                onClick={() => { setStep("details"); setClientSecret(null); setPayError(""); }}
              >
                ← Back to details
              </button>
            </h2>
            <p className={styles.testNote}>
              Test card: 4242 4242 4242 4242 · any future expiry · any CVC
            </p>
            {payError && <p className={styles.error}>{payError}</p>}
            <StripeCheckout
              clientSecret={clientSecret}
              offer={offer}
              searchParams={pending.searchParams}
              passengers={buildPassengers()}
              onSuccess={handleSuccess}
              onError={setPayError}
              specialRequests={specialRequests || undefined}
            />
          </section>
        )}

      </div>
    </div>
  );
}
