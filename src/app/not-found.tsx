import type { Metadata } from "next";
import Link from "next/link";
import styles from "./not-found.module.css";

export const metadata: Metadata = {
  title: "404 Not Found · Orbi",
};

export default function NotFound() {
  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <div className={styles.code}>404</div>
        <h1 className={styles.heading}>Page not found</h1>
        <p className={styles.sub}>
          This page doesn&apos;t exist, or you don&apos;t have access to it.
        </p>
        <Link href="/" className={styles.cta}>
          Search for flights →
        </Link>
      </div>
    </div>
  );
}
