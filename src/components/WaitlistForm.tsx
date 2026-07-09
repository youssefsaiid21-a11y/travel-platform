"use client";

import { useState, FormEvent } from "react";
import { getChannelCookie } from "@/lib/channel";
import styles from "./WaitlistForm.module.css";

export function WaitlistForm({ label }: { label?: string }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus("loading");

    const res = await fetch("/api/waitlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, channel: getChannelCookie() }),
    });

    setStatus(res.ok ? "done" : "error");
  }

  if (status === "done") {
    return <p className={styles.done}>You&apos;re on the list - we&apos;ll email you.</p>;
  }

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      <p className={styles.label}>
        {label ?? "Not ready to book yet? Get notified about fare drops and new routes."}
      </p>
      <div className={styles.row}>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className={styles.input}
          autoComplete="email"
          required
        />
        <button type="submit" disabled={status === "loading"} className={styles.button}>
          {status === "loading" ? "Joining…" : "Notify me"}
        </button>
      </div>
      {status === "error" && (
        <p className={styles.error}>Something went wrong - please try again.</p>
      )}
    </form>
  );
}
