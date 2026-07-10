"use client";

import { useState, FormEvent } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
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

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<"password" | "otp">("password");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const result = await signIn("credentials", {
      email,
      password,
      otp: step === "otp" ? otp : "",
      redirect: false,
    });

    setLoading(false);

    if (result?.code === "mfa_required") {
      setStep("otp");
      return;
    }
    if (result?.code === "invalid_code") {
      setError("Incorrect code. Please try again.");
      return;
    }
    if (result?.error) {
      setError("Invalid email or password.");
      return;
    }
    router.push(callbackUrl);
    router.refresh();
  }

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <div className={styles.brand}>
          <OrbiWordmark className={styles.logo} />
        </div>
        <h1 className={styles.title}>Welcome back</h1>
        <p className={styles.subtitle}>Sign in to your account</p>
        <div className={styles.features}>
          <span className={styles.chip}>Real flights</span>
          <span className={styles.chipDot} />
          <span className={styles.chip}>AI-powered search</span>
          <span className={styles.chipDot} />
          <span className={styles.chip}>Book in seconds</span>
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>
          {step === "password" ? (
            <>
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

              <label className={styles.label}>
                Password
                <div className={styles.passwordWrap}>
                  <input
                    type={showPw ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={styles.input}
                    autoComplete="current-password"
                    required
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
              </label>

              <Link href="/forgot-password" className={styles.link} style={{ alignSelf: "flex-end", fontSize: "0.8rem" }}>
                Forgot your password?
              </Link>
            </>
          ) : (
            <label className={styles.label}>
              Two-factor code
              <input
                type="text"
                inputMode="numeric"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                className={styles.input}
                placeholder="6-digit code or backup code"
                autoComplete="one-time-code"
                autoFocus
                required
              />
            </label>
          )}

          <div aria-live="polite" className={styles.srOnly}>
            {step === "otp" ? "Two-factor authentication required" : ""}
          </div>

          {error && <p className={styles.error} aria-live="polite">{error}</p>}

          <button type="submit" disabled={loading} className={styles.button}>
            {loading
              ? "Signing in…"
              : step === "otp"
                ? "Verify"
                : "Sign in"}
          </button>

          {step === "otp" && (
            <button
              type="button"
              className={styles.link}
              style={{ background: "none", border: "none", cursor: "pointer" }}
              onClick={() => { setStep("password"); setOtp(""); setError(""); }}
            >
              ← Back
            </button>
          )}
        </form>

        <p className={styles.footer}>
          No account?{" "}
          <Link href="/signup" className={styles.link}>
            Create one
          </Link>
        </p>
      </div>
    </div>
  );
}
