"use client";

import { PlaneIcon } from "./icons";
import styles from "./FlightPath.module.css";

// Path data is duplicated between the visible <path> and the CSS
// offset-path below because CSS Modules can't share a value with JSX - the
// two strings must stay identical or the plane will drift off the dashed
// line. Coordinates are in the arc SVG's own viewBox units (200x50 /
// 120x34), which is why .track has a fixed pixel size instead of flex:1:
// offset-path doesn't rescale to a variable-width container.
const ARC_PATH = "M6 42 C 70 6, 130 6, 194 20";
const ARC_PATH_COMPACT = "M4 28 C 40 4, 80 4, 116 14";

export function FlightPath({
  origin,
  destination,
  compact = false,
  className,
}: {
  origin?: string;
  destination?: string;
  compact?: boolean;
  className?: string;
}) {
  const path = compact ? ARC_PATH_COMPACT : ARC_PATH;
  return (
    <div className={`${styles.wrap} ${className ?? ""}`}>
      {origin && <span className={styles.code}>{origin}</span>}
      <div className={`${styles.track} ${compact ? styles.compact : ""}`}>
        <svg
          className={styles.arc}
          viewBox={compact ? "0 0 120 34" : "0 0 200 50"}
          aria-hidden="true"
        >
          <path className={styles.dash} d={path} />
          <circle className={styles.endDot} cx={compact ? 4 : 6} cy={compact ? 28 : 42} r="2.6" />
          <circle className={styles.endDot} cx={compact ? 116 : 194} cy={compact ? 14 : 20} r="2.6" />
        </svg>
        <div className={`${styles.plane} ${compact ? styles.planeCompact : ""}`}>
          <PlaneIcon />
        </div>
      </div>
      {destination && <span className={styles.code}>{destination}</span>}
    </div>
  );
}
