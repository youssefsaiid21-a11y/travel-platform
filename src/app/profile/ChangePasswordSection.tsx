"use client";
import { useState } from "react";
import styles from "./page.module.css";

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  );
}

function PasswordInput({
  id,
  value,
  onChange,
  autoComplete,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className={styles.pwWrap}>
      <input
        id={id}
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={styles.formInput}
        autoComplete={autoComplete}
        placeholder={placeholder}
      />
      <button
        type="button"
        className={styles.pwShowBtn}
        onClick={() => setShow((v) => !v)}
        aria-label={show ? "Hide password" : "Show password"}
      >
        <EyeIcon open={show} />
      </button>
    </div>
  );
}

export function ChangePasswordSection() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  function reset() {
    setCurrent("");
    setNext("");
    setConfirm("");
    setError("");
    setSuccess(false);
  }

  async function handleSubmit() {
    setError("");
    setSuccess(false);

    if (!current || !next || !confirm) {
      setError("All fields are required.");
      return;
    }
    if (next.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (next !== confirm) {
      setError("New passwords do not match.");
      return;
    }

    setSaving(true);
    const res = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: current, newPassword: next }),
    });
    setSaving(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: "" })) as { error?: string };
      setError(body.error ?? "Failed to change password.");
      return;
    }

    setSuccess(true);
    reset();
    setOpen(false);
  }

  if (!open) {
    return (
      <div className={styles.pwCollapsed}>
        {success && (
          <span className={styles.pwSuccess}>Password changed successfully.</span>
        )}
        <button type="button" className={styles.editBtn} onClick={() => { reset(); setOpen(true); }}>
          Change password
        </button>
      </div>
    );
  }

  return (
    <div className={styles.editForm}>
      <div className={styles.pwFormGrid}>
        <label className={styles.formLabel} htmlFor="pw-current">
          Current password
          <PasswordInput id="pw-current" value={current} onChange={setCurrent} autoComplete="current-password" />
        </label>
        <label className={styles.formLabel} htmlFor="pw-new">
          New password
          <PasswordInput id="pw-new" value={next} onChange={setNext} autoComplete="new-password" placeholder="Min. 8 characters" />
        </label>
        <label className={styles.formLabel} htmlFor="pw-confirm">
          Confirm new password
          <PasswordInput id="pw-confirm" value={confirm} onChange={setConfirm} autoComplete="new-password" />
        </label>
      </div>
      {error && <p className={styles.formError}>{error}</p>}
      <div className={styles.editActions}>
        <button type="button" className={styles.saveBtn} onClick={handleSubmit} disabled={saving}>
          {saving ? "Updating…" : "Update password"}
        </button>
        <button type="button" className={styles.cancelBtn} onClick={() => { reset(); setOpen(false); }}>
          Cancel
        </button>
      </div>
    </div>
  );
}
