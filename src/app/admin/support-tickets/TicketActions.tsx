"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "../admin.module.css";

// Mirrors the collapsed-summary → expand-to-confirm pattern used for
// destructive account actions (src/app/profile/DeleteAccountSection.tsx) -
// a status change here isn't destructive, but it should still be a
// deliberate two-step action, not a one-click misclick.
export function TicketActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  async function updateStatus(newStatus: string) {
    setSaving(true);
    const res = await fetch(`/api/admin/support-tickets/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    setSaving(false);
    setConfirming(false);
    if (res.ok) router.refresh();
  }

  if (status === "resolved") {
    return (
      <button type="button" className={styles.reopenBtn} onClick={() => updateStatus("open")} disabled={saving}>
        {saving ? "Reopening…" : "Reopen"}
      </button>
    );
  }

  if (!confirming) {
    return (
      <button type="button" className={styles.resolveBtn} onClick={() => setConfirming(true)}>
        Mark resolved
      </button>
    );
  }

  return (
    <>
      <button type="button" className={styles.reopenBtn} onClick={() => setConfirming(false)}>
        Cancel
      </button>
      <button type="button" className={styles.resolveBtn} onClick={() => updateStatus("resolved")} disabled={saving}>
        {saving ? "Saving…" : "Confirm resolved"}
      </button>
    </>
  );
}
