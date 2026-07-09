"use client";

import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import { usePathname } from "next/navigation";
import { OrbiWordmark } from "./OrbiLogo";
import styles from "./NavBar.module.css";

export default function NavBar() {
  const { data: session } = useSession();
  const pathname = usePathname();
  const name = session?.user?.name ?? session?.user?.email?.split("@")[0] ?? "";

  return (
    <nav className={styles.nav} aria-label="Main navigation">
      <Link href="/" className={styles.brand} aria-label="Orbi">
        <OrbiWordmark />
      </Link>
      <div className={styles.right}>
        <Link
          href="/support"
          className={`${styles.link} ${pathname === "/support" ? styles.linkActive : ""}`}
        >
          Support
        </Link>
        {session?.user ? (
          <>
            <Link
              href="/bookings"
              className={`${styles.link} ${pathname === "/bookings" ? styles.linkActive : ""}`}
            >
              My bookings
            </Link>
            <Link
              href="/profile"
              className={`${styles.avatar} ${pathname === "/profile" ? styles.avatarActive : ""}`}
              aria-label={`Account settings for ${name}`}
              title={`Hi, ${name} - Account & profile`}
            >
              {name.charAt(0).toUpperCase() || "?"}
            </Link>
            <button
              className={styles.signOut}
              onClick={() => signOut({ callbackUrl: "/" })}
            >
              Sign out
            </button>
          </>
        ) : (
          <>
            <Link href="/login" className={styles.link}>
              Sign in
            </Link>
            <Link href="/signup" className={styles.cta}>
              Create account
            </Link>
          </>
        )}
      </div>
    </nav>
  );
}
