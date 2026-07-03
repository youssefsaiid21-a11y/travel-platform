import styles from "./loading.module.css";

export default function BookingDetailLoading() {
  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <div className={styles.bannerSkeleton} />
        <div className={styles.card}>
          <div className={styles.rowSkeleton} />
          <div className={styles.rowSkeletonNarrow} />
        </div>
        <div className={styles.card}>
          <div className={styles.flightSkeleton} />
        </div>
        <div className={styles.card}>
          <div className={styles.rowSkeleton} />
        </div>
        <div className={styles.card}>
          <div className={styles.priceSkeleton} />
        </div>
      </div>
    </div>
  );
}
