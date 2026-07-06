import styles from "./OrbiLogo.module.css";

// The "O" in "Orbi" rendered as two crossing ellipses (an orbit ring) instead
// of a letterform - `tone="mono"` drops the brand colors in favor of
// currentColor, for use on colored backgrounds like the chat avatar.
export function OrbiMark({
  tone = "brand",
  className,
}: {
  tone?: "brand" | "mono";
  className?: string;
}) {
  const ring = tone === "brand" ? undefined : styles.ringMono;
  return (
    <svg className={className} viewBox="0 0 34 34" aria-hidden="true">
      <ellipse
        className={ring ?? styles.ringA}
        cx="17"
        cy="17"
        rx="16"
        ry="9.5"
        transform="rotate(-30 17 17)"
      />
      <ellipse
        className={ring ?? styles.ringB}
        cx="17"
        cy="17"
        rx="16"
        ry="9.5"
        transform="rotate(30 17 17)"
      />
      <circle
        className={tone === "brand" ? styles.dot : styles.dotMono}
        cx="31.2"
        cy="13.7"
        r="2.1"
      />
    </svg>
  );
}

// Full wordmark - inherits font-size/color from whatever heading or link
// wraps it (NavBar's gradient-clipped .brand, the hero's .heroLogo, etc.)
// so it drops in without a size prop.
export function OrbiWordmark({ className }: { className?: string }) {
  return (
    <span className={`${styles.logotype} ${className ?? ""}`} aria-label="Orbi">
      <OrbiMark className={styles.mark} />
      rbi
    </span>
  );
}
