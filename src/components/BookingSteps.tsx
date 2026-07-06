import styles from "./BookingSteps.module.css";

const STEPS = ["Search", "Select", "Details", "Pay"] as const;

// Search and Select are always shown as done - reaching this page already
// implies both happened. Only "details" vs "payment" is real client state.
export function BookingSteps({ current }: { current: "details" | "payment" }) {
  const activeIndex = current === "details" ? 2 : 3;

  return (
    <div className={styles.wrap} aria-label="Booking progress">
      {STEPS.map((label, i) => {
        const state = i < activeIndex ? "done" : i === activeIndex ? "active" : "upcoming";
        return (
          <div key={label} className={styles.step}>
            <div className={`${styles.dot} ${styles[state]}`}>
              {state === "done" ? (
                <svg viewBox="0 0 12 12" aria-hidden="true">
                  <polyline
                    points="2,6 5,9 10,3"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : (
                i + 1
              )}
            </div>
            <span className={state === "active" ? styles.labelActive : styles.label}>
              {label}
            </span>
            {i < STEPS.length - 1 && (
              <div className={`${styles.connector} ${i < activeIndex ? styles.connectorDone : ""}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}
