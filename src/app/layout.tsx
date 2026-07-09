import type { Metadata } from "next";
import { ViewTransition } from "react";
import { headers } from "next/headers";
import { SessionProvider } from "next-auth/react";
import { Analytics } from "@vercel/analytics/next";
import { auth } from "@/auth";
import NavBar from "@/components/NavBar";
import "./globals.css";

export const metadata: Metadata = {
  title: "Orbi - AI Flight Search",
  description: "Search and book flights from 300+ airlines using plain English. Powered by AI.",
  openGraph: {
    title: "Orbi - AI Flight Search",
    description: "Search and book flights from 300+ airlines using plain English. Powered by AI.",
    type: "website",
    siteName: "Orbi",
  },
  twitter: {
    // "summary_large_image" is the right card type now that a real
    // opengraph-image.tsx exists (src/app/opengraph-image.tsx) - "summary"
    // renders a small square thumbnail even when a large image is available.
    card: "summary_large_image",
    title: "Orbi - AI Flight Search",
    description: "Search and book flights from 300+ airlines using plain English.",
  },
};

// Organization + SoftwareApplication JSON-LD for AI answer engines and search
// crawlers. No fabricated fields (ratings, pricing) - only facts verified
// against CLAUDE.md. Domain matches the canonical one in src/app/sitemap.ts.
function structuredData() {
  const base = "https://orbi.travel";
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        name: "Orbi",
        url: base,
        description:
          "AI-agent-driven flight booking platform - conversational natural-language flight search over real Duffel flight data, with real booking via Stripe payment.",
      },
      {
        "@type": "SoftwareApplication",
        name: "Orbi",
        applicationCategory: "TravelApplication",
        operatingSystem: "Web",
        url: base,
        description:
          "Search and book flights from 300+ airlines using plain English. Conversational AI flight search with saved passenger profiles for fast rebooking.",
      },
    ],
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html lang="en">
      <body>
        <script
          type="application/ld+json"
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData()) }}
        />
        <SessionProvider session={session}>
          <a href="#main-content" className="skip-link">Skip to content</a>
          <NavBar />
          <div id="main-content" className="main-content">
            <ViewTransition>{children}</ViewTransition>
          </div>
        </SessionProvider>
        <Analytics />
      </body>
    </html>
  );
}
