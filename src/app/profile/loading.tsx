import styles from "./loading.module.css";

export default function ProfileLoading() {
  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <div className={styles.skeletonHeading} />
        <div className={styles.card}>
          <div className={styles.skeletonTitle} />
          {[1, 2, 3].map((i) => (
            <div key={i} className={styles.row}>
              <div className={styles.skeletonLabel} />
              <div className={styles.skeletonValue} />
            </div>
          ))}
        </div>
        <div className={styles.card}>
          <div className={styles.skeletonTitle} />
          <div className={styles.profileGrid}>
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className={styles.field}>
                <div className={styles.skeletonFieldLabel} />
                <div className={styles.skeletonFieldValue} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
