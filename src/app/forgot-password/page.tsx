"use client";

import { useState, FormEvent } from "react";
import Link from "next/link";
import { OrbiWordmark } from "@/components/OrbiLogo";
import styles from "./page.module.css";

// The server always returns the same 200 { ok: true } whether or not the
// email matches a real account (see POST /api/auth/recovery/request) - this
// page shows the same confirmation message regardless, so there's no client-
// side signal either that could let someone enumerate registered emails.
const CONFIRMATION_MESSAGE =
  "If an account exists for that email, we've sent a link to reset your password. The link expires in 60 minutes.";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const res = await fetch("/api/auth/recovery/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });

    setLoading(false);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error ?? "Something went wrong. Please try again.");
      return;
    }

    setSubmitted(true);
  }

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <div className={styles.brand}>
          <OrbiWordmark className={styles.logo} />
        </div>
        <h1 className={styles.title}>Reset your password</h1>
        <p className={styles.subtitle}>
          Enter your account email and we&apos;ll send you a link to reset your
          password and two-factor authentication.
        </p>

        {submitted ? (
          <p className={styles.success} role="status">{CONFIRMATION_MESSAGE}</p>
        ) : (
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
                autoFocus
              />
            </label>

            {error && <p className={styles.error}>{error}</p>}

            <button type="submit" disabled={loading} className={styles.button}>
              {loading ? "Sending…" : "Send reset link"}
            </button>
          </form>
        )}

        <p className={styles.footer}>
          Remembered your password?{" "}
          <Link href="/login" className={styles.link}>
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
