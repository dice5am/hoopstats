"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./AppNav.module.css";

const LINKS = [
  { href: "/", label: "Insights" },
  { href: "/players", label: "Players" },
] as const;

/** Hardwood top bar: lowercase wordmark + primary links. */
export function AppNav() {
  const pathname = usePathname();
  return (
    <nav className={styles.nav} aria-label="Primary">
      <Link href="/" className={styles.brand}>
        <span className={styles.ball} aria-hidden />
        <span>hoopstats</span>
      </Link>
      <div className={styles.links}>
        {LINKS.map((l) => {
          const on =
            l.href === "/"
              ? pathname === "/"
              : pathname === l.href || pathname.startsWith(`${l.href}/`);
          return (
            <Link
              key={l.href}
              href={l.href}
              className={on ? styles.linkOn : styles.link}
              aria-current={on ? "page" : undefined}
            >
              {l.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
