"use client";

import { useState, FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { OrbiWordmark } from "@/components/OrbiLogo";
import styles from "./page.module.css";

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  );
}

export default function ResetPasswordPage() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    const res = await fetch("/api/auth/recovery/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, newPassword: password }),
    });
    setLoading(false);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error ?? "Something went wrong. Please try again.");
      return;
    }

    setDone(true);
  }

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <div className={styles.brand}>
          <OrbiWordmark className={styles.logo} />
        </div>
        <h1 className={styles.title}>Choose a new password</h1>
        <p className={styles.subtitle}>
          This also turns off two-factor authentication on your account -
          you can re-enable it after signing in.
        </p>

        {done ? (
          <>
            <p className={styles.success} role="status">
              Your password has been reset. You can now sign in with your new password.
            </p>
            <p className={styles.footer}>
              <Link href="/login" className={styles.link}>
                Go to sign in
              </Link>
            </p>
          </>
        ) : !token ? (
          <p className={styles.error}>
            This reset link is missing its token. Please request a new one from
            the <Link href="/forgot-password" className={styles.link}>forgot password</Link> page.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className={styles.form}>
            <label className={styles.label}>
              New password
              <div className={styles.passwordWrap}>
                <input
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={styles.input}
                  autoComplete="new-password"
                  required
                  minLength={8}
                  autoFocus
                />
                <button
                  type="button"
                  className={styles.showBtn}
                  onClick={() => setShowPw((v) => !v)}
                  aria-label={showPw ? "Hide password" : "Show password"}
                >
                  <EyeIcon open={showPw} />
                </button>
              </div>
              <span className={styles.hint}>Minimum 8 characters</span>
            </label>

            <label className={styles.label}>
              Confirm new password
              <input
                type={showPw ? "text" : "password"}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className={styles.input}
                autoComplete="new-password"
                required
                minLength={8}
              />
            </label>

            {error && <p className={styles.error}>{error}</p>}

            <button type="submit" disabled={loading} className={styles.button}>
              {loading ? "Resetting…" : "Reset password"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
