"use client";
import { signOut } from "next-auth/react";
import styles from "./page.module.css";

export function SignOutBtn() {
  return (
    <button
      type="button"
      className={styles.signOutBtn}
      onClick={() => signOut({ callbackUrl: "/" })}
    >
      Sign out
    </button>
  );
}
