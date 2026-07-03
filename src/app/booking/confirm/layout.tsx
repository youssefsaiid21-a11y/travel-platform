import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Confirm booking · Orbi",
  description: "Review your flight and complete your booking.",
  robots: { index: false },
};

export default function ConfirmLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
