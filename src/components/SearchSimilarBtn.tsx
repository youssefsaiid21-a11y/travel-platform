"use client";

import { useRouter } from "next/navigation";
import styles from "./SearchSimilarBtn.module.css";

export function SearchSimilarBtn({ query }: { query: string }) {
  const router = useRouter();
  return (
    <button
      className={styles.btn}
      onClick={(e) => {
        e.preventDefault();
        localStorage.setItem("prefill_query", query);
        router.push("/");
      }}
      title="Search for similar flights to this booking"
      aria-label="Search for similar flights"
    >
      Search similar
    </button>
  );
}
