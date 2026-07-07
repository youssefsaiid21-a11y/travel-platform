"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

export default function GlobalError({
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
    <html lang="en">
      <body
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          fontFamily: "system-ui, -apple-system, sans-serif",
          background: "#e0f2fe",
          textAlign: "center",
          padding: "2rem",
          color: "#0c1a2e",
          flexDirection: "column",
          gap: "1rem",
        }}
      >
        <h1 style={{ fontSize: "2rem", fontWeight: 800, margin: 0 }}>
          Something went wrong
        </h1>
        <p style={{ color: "#5b8db0", margin: 0 }}>
          An unexpected error occurred. Please refresh or try again.
        </p>
        <button
          onClick={reset}
          style={{
            background: "linear-gradient(135deg,#0284c7 0%,#06b6d4 100%)",
            color: "#fff",
            border: "none",
            borderRadius: "9999px",
            padding: "0.65rem 1.5rem",
            fontSize: "0.9rem",
            fontWeight: 600,
            cursor: "pointer",
            marginTop: "0.5rem",
          }}
        >
          Try again
        </button>
        {error.digest && (
          <p style={{ fontSize: "0.7rem", color: "#5b8db0", fontFamily: "monospace", opacity: 0.7 }}>
            Error ID: {error.digest}
          </p>
        )}
      </body>
    </html>
  );
}
