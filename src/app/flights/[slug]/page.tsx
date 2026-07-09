import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { headers } from "next/headers";
import { FLIGHT_GUIDES, getFlightGuide } from "@/lib/flightGuides";
import { getBaseUrl } from "@/lib/site";
import { WaitlistForm } from "@/components/WaitlistForm";
import styles from "./page.module.css";

export function generateStaticParams() {
  return FLIGHT_GUIDES.map((g) => ({ slug: g.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const guide = getFlightGuide(slug);
  if (!guide) return {};

  const title = `${guide.originCity} to ${guide.destinationCity} Flights (${guide.origin} to ${guide.destination}) | Orbi`;
  const description = `Compare real ${guide.originCity} to ${guide.destinationCity} flights and book in plain English. Flight time, time difference, and travel FAQs for the ${guide.origin}-${guide.destination} route.`;

  return {
    title,
    description,
    openGraph: { title, description, type: "article" },
    twitter: { card: "summary", title, description },
  };
}

export default async function FlightGuidePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const guide = getFlightGuide(slug);
  if (!guide) notFound();

  const base = getBaseUrl();
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: base },
          {
            "@type": "ListItem",
            position: 2,
            name: `${guide.originCity} to ${guide.destinationCity}`,
            item: `${base}/flights/${guide.slug}`,
          },
        ],
      },
      {
        "@type": "FAQPage",
        mainEntity: guide.faqs.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      },
    ],
  };

  return (
    <div className={styles.container}>
      <script
        type="application/ld+json"
        nonce={nonce}
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <nav className={styles.breadcrumb} aria-label="Breadcrumb">
        <Link href="/">Home</Link> / {guide.originCity} to {guide.destinationCity}
      </nav>
      <h1 className={styles.title}>
        {guide.originCity} to {guide.destinationCity} flights
      </h1>
      <p className={styles.route}>
        {guide.originAirport} &rarr; {guide.destinationAirport}
      </p>
      <p className={styles.intro}>{guide.intro}</p>

      <Link
        href={`/?q=${encodeURIComponent(guide.query)}`}
        className={styles.cta}
      >
        {`Search ${guide.originCity} to ${guide.destinationCity} flights`} &rarr;
      </Link>

      <h2 className={styles.faqTitle}>Frequently asked questions</h2>
      <dl className={styles.faqList}>
        {guide.faqs.map((f) => (
          <div key={f.q} className={styles.faqItem}>
            <dt className={styles.faqQ}>{f.q}</dt>
            <dd className={styles.faqA}>{f.a}</dd>
          </div>
        ))}
      </dl>

      <WaitlistForm
        label={`Not ready to book your ${guide.originCity} to ${guide.destinationCity} flight yet? Get notified about fare drops on this route.`}
      />
    </div>
  );
}
