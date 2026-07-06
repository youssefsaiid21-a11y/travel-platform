interface IconProps {
  className?: string;
}

// Decorative only - always paired with an adjacent text label that already
// carries the meaning, so no aria-label is added (would double-announce).
export function BagIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="6" y="8" width="12" height="12" rx="1.5" />
      <path d="M9 8V6a3 3 0 0 1 6 0v2" />
    </svg>
  );
}

export function SeatIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M7 20V9a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v11" />
      <path d="M4 20h16" />
    </svg>
  );
}

export function PassportIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <circle cx="12" cy="9" r="2.5" />
      <path d="M8 16h8" />
    </svg>
  );
}

// Shared by FlightPath, OfferCard's real/skeleton duration-line gliders, and
// the booking-confirm flight summary - kept in one place so the glyph can't
// drift out of sync across its 4 call sites.
//
// A prior 8-point-star placeholder shape read as an abstract sparkle rather
// than a plane at the 12-16px sizes it's actually used at - this is the
// standard "flight" glyph (Material Symbols), chosen because its silhouette
// (tapered fuselage + swept wings) stays legible as an airplane even that
// small, which the symmetric star shape did not.
export function PlaneIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2.5 1.5V22l4-1 4 1v-1.5L13 19v-5.5l8 2.5z" />
    </svg>
  );
}
