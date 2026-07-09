"use client";

import { useState, FormEvent } from "react";
import styles from "./page.module.css";

export default function SupportPage() {
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [bookingRef, setBookingRef] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const res = await fetch("/api/support-tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, subject, message, bookingRef: bookingRef || undefined }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Something went wrong - please try again.");
      setLoading(false);
      return;
    }

    setSubmitted(true);
    setLoading(false);
  }

  if (submitted) {
    return (
      <div className={styles.container}>
        <div className={styles.card}>
          <div className={styles.success}>
            <p className={styles.successTitle}>Thanks - we&apos;ve got it.</p>
            <p>We&apos;ll get back to you at {email} as soon as we can.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <h1 className={styles.title}>Contact support</h1>
        <p className={styles.subtitle}>
          Tell us what&apos;s going on and we&apos;ll get back to you by email.
        </p>

        <form onSubmit={handleSubmit} className={styles.form}>
          <label className={styles.label}>
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={styles.input}
              autoComplete="email"
              required
            />
          </label>

          <label className={styles.label}>
            Booking reference (optional)
            <input
              type="text"
              value={bookingRef}
              onChange={(e) => setBookingRef(e.target.value)}
              className={styles.input}
              placeholder="e.g. ABCD12"
            />
          </label>

          <label className={styles.label}>
            Subject
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className={styles.input}
              maxLength={200}
              required
            />
          </label>

          <label className={styles.label}>
            Message
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className={styles.textarea}
              maxLength={5000}
              required
            />
          </label>

          {error && <p className={styles.error}>{error}</p>}

          <button type="submit" disabled={loading} className={styles.button}>
            {loading ? "Sending…" : "Send message"}
          </button>
        </form>
      </div>
    </div>
  );
}
