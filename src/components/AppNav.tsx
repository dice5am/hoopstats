import styles from "./AppNav.module.css";

/** fantasyhoops AppNav with the tabs removed: wordmark + season pill. */
export function AppNav() {
  return (
    <nav className={styles.nav} aria-label="Primary">
      <div className={styles.brand}>
        <span className={styles.brandMark} aria-hidden>
          ●
        </span>
        <span className={styles.brandText}>HoopStats</span>
      </div>
      <div className={styles.season} aria-label="Season">
        2026-27
      </div>
    </nav>
  );
}
