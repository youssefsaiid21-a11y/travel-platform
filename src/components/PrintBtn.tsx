"use client";

import styles from "./PrintBtn.module.css";

export function PrintBtn() {
  return (
    <button
      className={styles.btn}
      onClick={() => window.print()}
      aria-label="Print or save as PDF"
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <rect x="2" y="4" width="10" height="7" rx="1" stroke="currentColor" strokeWidth="1.4"/>
        <path d="M4 4V2h6v2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
        <rect x="4" y="8" width="6" height="1.5" rx="0.5" fill="currentColor"/>
      </svg>
      Print
    </button>
  );
}
