import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Contact support · Orbi",
  description: "Get help with a booking, a search question, or anything else - Orbi's support team responds by email.",
};

export default function SupportLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
