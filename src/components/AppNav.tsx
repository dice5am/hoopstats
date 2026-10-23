import styles from "./AppNav.module.css";

/** Hardwood top bar: lowercase wordmark + season pill. */
export function AppNav() {
  return (
    <nav className={styles.nav} aria-label="Primary">
      <div className={styles.brand}>
        <span className={styles.ball} aria-hidden />
        <span>hoopstats</span>
      </div>
      <div className={styles.season} aria-label="Season">
        2026-27
      </div>
    </nav>
  );
}
