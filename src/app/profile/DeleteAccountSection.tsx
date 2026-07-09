"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import styles from "./page.module.css";

async function downloadExport() {
  const res = await fetch("/api/account/export");
  if (!res.ok) return;
  const data = await res.json();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `orbi-data-export-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function DeleteAccountSection() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setError("");
    if (confirmText !== "DELETE") {
      setError('Type "DELETE" to confirm.');
      return;
    }
    if (!password) {
      setError("Enter your password to confirm.");
      return;
    }

    setDeleting(true);
    const res = await fetch("/api/account", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setDeleting(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: "" })) as { error?: string };
      setError(body.error ?? "Could not delete account.");
      return;
    }

    await signOut({ redirect: false });
    router.push("/");
  }

  return (
    <>
      <div className={styles.pwCollapsed}>
        <button type="button" className={styles.editBtn} onClick={downloadExport}>
          Download my data
        </button>
      </div>

      {!open ? (
        <div className={styles.pwCollapsed}>
          <button
            type="button"
            className={styles.editBtn}
            style={{ color: "var(--danger)" }}
            onClick={() => setOpen(true)}
          >
            Delete my account
          </button>
        </div>
      ) : (
        <div className={styles.editForm}>
          <p className={styles.formError} style={{ marginBottom: "0.5rem" }}>
            This permanently removes your saved passenger details and can&apos;t be
            undone. Your booking history is kept for accounting/legal reasons but is
            no longer linked to a working login.
          </p>
          <label className={styles.formLabel}>
            Type &quot;DELETE&quot; to confirm
            <input
              className={styles.formInput}
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
            />
          </label>
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
            <button
              type="button"
              className={styles.saveBtn}
              style={{ background: "var(--danger)" }}
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? "Deleting…" : "Permanently delete account"}
            </button>
            <button
              type="button"
              className={styles.cancelBtn}
              onClick={() => { setOpen(false); setError(""); setConfirmText(""); setPassword(""); }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}
