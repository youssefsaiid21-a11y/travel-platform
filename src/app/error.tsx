"use client";

import { useEffect } from "react";
import Link from "next/link";
import * as Sentry from "@sentry/nextjs";
import styles from "./error.module.css";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <div className={styles.code}>500</div>
        <h1 className={styles.heading}>Something went wrong</h1>
        <p className={styles.sub}>
          An unexpected error occurred. You can try again or return to search.
        </p>
        <div className={styles.actions}>
          <button className={styles.retry} onClick={reset}>
            Try again
          </button>
          <Link href="/" className={styles.cta}>
            Back to search
          </Link>
        </div>
        {error.digest && (
          <p className={styles.digest}>Error ID: {error.digest}</p>
        )}
      </div>
    </div>
  );
}
