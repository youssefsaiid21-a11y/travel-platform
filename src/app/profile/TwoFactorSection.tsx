"use client";
import { useState } from "react";
import styles from "./page.module.css";

type Stage = "idle" | "setup" | "backupCodes" | "enabled" | "disabling";

export function TwoFactorSection({ initialEnabled }: { initialEnabled: boolean }) {
  const [stage, setStage] = useState<Stage>(initialEnabled ? "enabled" : "idle");
  const [secret, setSecret] = useState("");
  const [otpauthUrl, setOtpauthUrl] = useState("");
  const [code, setCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function startSetup() {
    setError("");
    setBusy(true);
    const res = await fetch("/api/auth/mfa/setup", { method: "POST" });
    setBusy(false);
    if (!res.ok) {
      setError("Could not start two-factor setup. Please try again.");
      return;
    }
    const data = await res.json();
    setSecret(data.secret);
    setOtpauthUrl(data.otpauthUrl);
    setStage("setup");
  }

  async function confirmSetup() {
    setError("");
    setBusy(true);
    const res = await fetch("/api/auth/mfa/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: "" }));
      setError(body.error ?? "Incorrect code.");
      return;
    }
    const data = await res.json();
    setBackupCodes(data.backupCodes);
    setCode("");
    setStage("backupCodes");
  }

  async function disable() {
    setError("");
    setBusy(true);
    const res = await fetch("/api/auth/mfa/disable", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: "" }));
      setError(body.error ?? "Could not disable two-factor authentication.");
      return;
    }
    setPassword("");
    setStage("idle");
  }

  if (stage === "idle") {
    return (
      <div className={styles.pwCollapsed}>
        <span className={styles.rowValue}>Off</span>
        <button type="button" className={styles.editBtn} onClick={startSetup} disabled={busy}>
          {busy ? "Starting…" : "Enable two-factor authentication"}
        </button>
        {error && <p className={styles.formError}>{error}</p>}
      </div>
    );
  }

  if (stage === "setup") {
    return (
      <div className={styles.editForm}>
        <p className={styles.formLabel}>
          Scan this in your authenticator app (Google Authenticator, Authy,
          1Password, etc.), or enter the code manually:
        </p>
        <p className={styles.rowValue} style={{ wordBreak: "break-all" }}>{secret}</p>
        <p className={styles.formLabel} style={{ wordBreak: "break-all", fontSize: "0.75rem" }}>
          {otpauthUrl}
        </p>
        <label className={styles.formLabel}>
          Enter the 6-digit code from your app to confirm
          <input
            className={styles.formInput}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            inputMode="numeric"
            maxLength={6}
          />
        </label>
        {error && <p className={styles.formError}>{error}</p>}
        <div className={styles.editActions}>
          <button type="button" className={styles.saveBtn} onClick={confirmSetup} disabled={busy}>
            {busy ? "Verifying…" : "Confirm"}
          </button>
          <button type="button" className={styles.cancelBtn} onClick={() => setStage("idle")}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (stage === "backupCodes") {
    return (
      <div className={styles.editForm}>
        <p className={styles.formError}>
          Two-factor authentication is now on. Save these backup codes
          somewhere safe - each works once, and this is the only time
          they&apos;ll be shown.
        </p>
        <ul>
          {backupCodes.map((c) => (
            <li key={c} style={{ fontFamily: "monospace" }}>{c}</li>
          ))}
        </ul>
        <button type="button" className={styles.saveBtn} onClick={() => setStage("enabled")}>
          I&apos;ve saved these codes
        </button>
      </div>
    );
  }

  if (stage === "disabling") {
    return (
      <div className={styles.editForm}>
        <label className={styles.formLabel}>
          Password
          <input
            type="password"
            className={styles.formInput}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        {error && <p className={styles.formError}>{error}</p>}
        <div className={styles.editActions}>
          <button type="button" className={styles.saveBtn} onClick={disable} disabled={busy}>
            {busy ? "Disabling…" : "Disable two-factor authentication"}
          </button>
          <button
            type="button"
            className={styles.cancelBtn}
            onClick={() => { setStage("enabled"); setError(""); setPassword(""); }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.pwCollapsed}>
      <span className={styles.rowValue}>On</span>
      <button type="button" className={styles.editBtn} onClick={() => setStage("disabling")}>
        Disable
      </button>
    </div>
  );
}
