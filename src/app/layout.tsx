import type { Metadata } from "next";
import { ViewTransition } from "react";
import { SessionProvider } from "next-auth/react";
import { Analytics } from "@vercel/analytics/next";
import { auth } from "@/auth";
import NavBar from "@/components/NavBar";
import "./globals.css";

export const metadata: Metadata = {
  title: "Orbi - AI Flight Search",
  description: "Search and book flights from 500+ airlines using plain English. Powered by AI.",
  openGraph: {
    title: "Orbi - AI Flight Search",
    description: "Search and book flights from 500+ airlines using plain English. Powered by AI.",
    type: "website",
    siteName: "Orbi",
  },
  twitter: {
    // "summary_large_image" is the right card type now that a real
    // opengraph-image.tsx exists (src/app/opengraph-image.tsx) - "summary"
    // renders a small square thumbnail even when a large image is available.
    card: "summary_large_image",
    title: "Orbi - AI Flight Search",
    description: "Search and book flights from 500+ airlines using plain English.",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();

  return (
    <html lang="en">
      <body>
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
