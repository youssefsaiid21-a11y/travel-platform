import type { Metadata } from "next";
import Link from "next/link";
import { GUIDES } from "@/lib/guides";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Guides · Orbi",
  description: "Practical guides on how Orbi's flight search works and route-specific travel tips.",
};

export default function GuidesIndexPage() {
  return (
    <div className={styles.container}>
      <h1 className={styles.title}>Guides</h1>
      <p className={styles.subtitle}>How Orbi works, and practical tips for popular routes.</p>
      <div className={styles.list}>
        {GUIDES.map((g) => (
          <Link key={g.slug} href={`/guides/${g.slug}`} className={styles.card}>
            <p className={styles.cardTitle}>{g.title}</p>
            <p className={styles.cardDescription}>{g.description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
