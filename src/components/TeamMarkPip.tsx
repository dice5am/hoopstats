/**
 * Name-adjacent team mark — locked chartPrimary pip + soft glow.
 * Cite: /workspace/nba-branding/TEAM_MARK_UX.md (Cavin — no logos).
 */
import type { CSSProperties } from "react";
import styles from "./TeamMarkPip.module.css";

type Props = {
  /** Exact chartPrimary hex (CHART_UI_MAINS lock). */
  color: string | null | undefined;
  /** 6–8px; default 7. */
  size?: number;
  className?: string;
  title?: string;
};

export function TeamMarkPip({
  color,
  size = 7,
  className,
  title,
}: Props) {
  if (!color) return null;
  const style = {
    width: size,
    height: size,
    background: color,
    ["--fh-pip-color" as string]: color,
  } as CSSProperties;
  return (
    <span
      className={`${styles.pip}${className ? ` ${className}` : ""}`}
      style={style}
      title={title}
      aria-hidden
    />
  );
}

/** Soft glow box-shadow from the same hex (~35% opacity) — no second hue. */
export function teamMarkGlow(color: string, blurPx = 8): string {
  return `0 0 ${blurPx}px color-mix(in srgb, ${color} 35%, transparent)`;
}
