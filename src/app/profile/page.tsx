import { auth } from "@/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { ProfileSection } from "./ProfileSection";
import { ChangePasswordSection } from "./ChangePasswordSection";
import { SignOutBtn } from "./SignOutBtn";
import { UpdateNameSection } from "./UpdateNameSection";
import { DeleteAccountSection } from "./DeleteAccountSection";
import { safeDecryptPassport } from "@/lib/crypto";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Profile · Orbi",
  description: "Manage your account and saved passenger details.",
  robots: { index: false },
};

export default async function ProfilePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const [user, profile] = await Promise.all([
    db.user.findUnique({
      where: { id: session.user.id },
      select: { name: true, email: true, createdAt: true },
    }),
    db.passengerProfile.findUnique({ where: { userId: session.user.id } }),
  ]);

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <div className={styles.headingRow}>
          <h1 className={styles.heading}>Account</h1>
          <Link href="/bookings" className={styles.bookingsLink}>My bookings</Link>
        </div>

        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Account info</h2>
          <div className={styles.row}>
            <span className={styles.rowLabel}>Name</span>
            <UpdateNameSection initialName={user?.name ?? ""} />
          </div>
          <div className={styles.row}>
            <span className={styles.rowLabel}>Email</span>
            <span className={styles.rowValue}>{user?.email}</span>
          </div>
          {user?.createdAt && (
            <div className={styles.row}>
              <span className={styles.rowLabel}>Member since</span>
              <span className={styles.rowValue}>
                {new Date(user.createdAt).toLocaleDateString("en-GB", { dateStyle: "long" })}
              </span>
            </div>
          )}
        </section>

        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Password</h2>
          <ChangePasswordSection />
        </section>

        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Saved passenger profile</h2>
          <ProfileSection
            profile={
              profile
                ? {
                    ...profile,
                    passportNumber: safeDecryptPassport(profile.passportNumber),
                    updatedAt: profile.updatedAt.toISOString(),
                  }
                : null
            }
          />
        </section>

        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Your data</h2>
          <DeleteAccountSection />
        </section>

        <SignOutBtn />
      </div>
    </div>
  );
}
