"use client";

import type { MetricStats } from "@/lib/insightsTypes";
import { formatSigned } from "@/lib/insightsTypes";
import styles from "./DotWhisker.module.css";

export type DotRow = {
  key: string;
  label: string;
  stats: MetricStats;
  n: number;
  small_n?: boolean;
};

type Props = {
  rows: DotRow[];
  unitLabel?: string;
  heightPerRow?: number;
};

/**
 * Horizontal dot-and-whisker: mean as a filled circle, 95% CI as a bar,
 * zero reference line. Values come from insights JSON only.
 */
export function DotWhisker({
  rows,
  unitLabel = "pts",
  heightPerRow = 36,
}: Props) {
  if (rows.length === 0) return null;

  const padL = 96;
  const padR = 64;
  const padT = 12;
  const padB = 28;
  const width = 400;
  const plotW = width - padL - padR;
  const height = padT + padB + rows.length * heightPerRow;

  let min = 0;
  let max = 0;
  for (const r of rows) {
    min = Math.min(min, r.stats.ci95[0], r.stats.mean);
    max = Math.max(max, r.stats.ci95[1], r.stats.mean);
  }
  // Keep zero inside and add a little breathing room
  const span = Math.max(max - min, 0.2);
  const pad = span * 0.12;
  min -= pad;
  max += pad;
  if (min > 0) min = -pad;
  if (max < 0) max = pad;

  const xOf = (v: number) => padL + ((v - min) / (max - min)) * plotW;
  const zeroX = xOf(0);

  const ticks = niceTicks(min, max);

  return (
    <div className={styles.wrap}>
      <svg
        className={styles.svg}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Dot and whisker chart of ${unitLabel} differences`}
      >
        {/* zero line */}
        <line
          x1={zeroX}
          x2={zeroX}
          y1={padT - 4}
          y2={height - padB + 4}
          className={styles.zero}
        />
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={xOf(t)}
              x2={xOf(t)}
              y1={height - padB}
              y2={height - padB + 4}
              className={styles.tick}
            />
            <text
              x={xOf(t)}
              y={height - 8}
              textAnchor="middle"
              className={styles.tickLab}
            >
              {formatSigned(t, Math.abs(t) >= 1 ? 1 : 2)}
            </text>
          </g>
        ))}
        {rows.map((r, i) => {
          const y = padT + i * heightPerRow + heightPerRow / 2;
          const xMean = xOf(r.stats.mean);
          const xLo = xOf(r.stats.ci95[0]);
          const xHi = xOf(r.stats.ci95[1]);
          const crossesZero =
            r.stats.ci95[0] <= 0 && r.stats.ci95[1] >= 0;
          return (
            <g key={r.key}>
              <text
                x={padL - 10}
                y={y + 4}
                textAnchor="end"
                className={styles.rowLab}
              >
                {r.label}
              </text>
              <line
                x1={xLo}
                x2={xHi}
                y1={y}
                y2={y}
                className={crossesZero ? styles.ciMuted : styles.ci}
              />
              <circle
                cx={xMean}
                cy={y}
                r={5.5}
                className={crossesZero ? styles.dotMuted : styles.dot}
              />
              <text
                x={padL + plotW + 8}
                y={y + 4}
                textAnchor="start"
                className={styles.value}
              >
                {formatSigned(r.stats.mean)}
                {r.small_n ? "*" : ""}
              </text>
            </g>
          );
        })}
      </svg>
      <p className={styles.axisNote}>
        Difference ({unitLabel}) · whiskers = 95% CI
        {rows.some((r) => r.small_n) ? " · * small sample" : ""}
      </p>
    </div>
  );
}

function niceTicks(min: number, max: number): number[] {
  const span = max - min;
  const rough = span / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(Math.max(rough, 1e-6))));
  const candidates = [1, 2, 2.5, 5, 10].map((m) => m * mag);
  let step = candidates[0];
  for (const c of candidates) {
    if (span / c <= 5) {
      step = c;
      break;
    }
  }
  const start = Math.ceil(min / step) * step;
  const out: number[] = [];
  for (let v = start; v <= max + step * 1e-9; v += step) {
    // snap float noise
    const rounded = Math.abs(v) < step * 1e-6 ? 0 : Number(v.toPrecision(8));
    out.push(rounded);
  }
  if (!out.includes(0) && min < 0 && max > 0) out.push(0);
  return out.sort((a, b) => a - b);
}
