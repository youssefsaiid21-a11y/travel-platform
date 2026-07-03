import styles from "./loading.module.css";

export default function BookingsLoading() {
  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <div className={styles.header}>
          <div className={styles.skeletonHeading} />
          <div className={styles.skeletonBtn} />
        </div>
        <ul className={styles.list}>
          {[1, 2, 3].map((i) => (
            <li key={i} className={styles.item}>
              <div className={styles.itemTop}>
                <div className={styles.skeletonRoute} />
                <div className={styles.skeletonStatus} />
              </div>
              <div className={styles.skeletonMeta} />
              <div className={styles.skeletonMeta2} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
