import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { GUIDES, getGuide } from "@/lib/guides";
import styles from "./page.module.css";

export function generateStaticParams() {
  return GUIDES.map((g) => ({ slug: g.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const guide = getGuide(slug);
  if (!guide) return {};
  return {
    title: `${guide.title} · Orbi`,
    description: guide.description,
    openGraph: { title: guide.title, description: guide.description, type: "article" },
    twitter: { card: "summary", title: guide.title, description: guide.description },
  };
}

export default async function GuidePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const guide = getGuide(slug);
  if (!guide) notFound();

  return (
    <div className={styles.container}>
      <nav className={styles.breadcrumb} aria-label="Breadcrumb">
        <Link href="/guides">Guides</Link> / {guide.title}
      </nav>
      <h1 className={styles.title}>{guide.title}</h1>
      <div className={styles.body}>
        {guide.body.map((paragraph, i) => (
          <p key={i}>{paragraph}</p>
        ))}
      </div>
    </div>
  );
}
