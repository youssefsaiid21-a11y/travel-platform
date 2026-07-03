"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./page.module.css";

export function UpdateNameSection({ initialName }: { initialName: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    setSaving(true);
    setError("");
    const res = await fetch("/api/auth/user", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setSaving(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: "" })) as { error?: string };
      setError(body.error ?? "Failed to update name.");
      return;
    }
    setEditing(false);
    router.refresh();
  }

  if (editing) {
    return (
      <div className={styles.nameEdit}>
        <input
          className={styles.nameInput}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          autoFocus
          placeholder="Your name"
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
            if (e.key === "Escape") { setEditing(false); setName(initialName); setError(""); }
          }}
        />
        <button
          type="button"
          className={styles.nameSaveBtn}
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          className={styles.cancelBtn}
          onClick={() => { setEditing(false); setName(initialName); setError(""); }}
        >
          Cancel
        </button>
        {error && <span className={styles.nameError}>{error}</span>}
      </div>
    );
  }

  return (
    <div className={styles.nameView}>
      <span className={styles.rowValue}>{initialName || <span className={styles.namePlaceholder}>Not set</span>}</span>
      <button
        type="button"
        className={styles.editLink}
        onClick={() => { setEditing(true); setError(""); }}
      >
        Edit
      </button>
    </div>
  );
}
