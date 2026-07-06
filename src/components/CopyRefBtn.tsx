"use client";

import { useTemporaryFlag } from "@/lib/useTemporaryFlag";
import styles from "./CopyRefBtn.module.css";

export function CopyRefBtn({ value }: { value: string }) {
  const [copied, markCopied] = useTemporaryFlag();

  async function handleCopy() {
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(value);
      } else {
        // Fallback for environments where clipboard API is unavailable
        const ta = document.createElement("textarea");
        ta.value = value;
        ta.style.cssText = "position:fixed;opacity:0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      markCopied();
    } catch { /* ignore */ }
  }

  return (
    <button
      className={`${styles.btn} ${copied ? styles.copied : ""}`}
      onClick={handleCopy}
      aria-label={copied ? "Copied!" : "Copy booking reference"}
      title={copied ? "Copied!" : "Copy to clipboard"}
      type="button"
    >
      {copied ? (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      ) : (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
        </svg>
      )}
    </button>
  );
}
