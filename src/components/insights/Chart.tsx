"use client";

import Link from "next/link";
import { useId, useLayoutEffect, useRef, useState } from "react";
import type { ChartRow, ChartSpec, LegendKey } from "@/lib/insights/types";
import { kindOf } from "@/lib/insights/util";
import styles from "./insights.module.css";

const INK = "#2b1d12";
const UP = "#e4572e";
const DOWN = "#5c4128";
const FLAT = "#c89a62";
const FLAT_INK = "#7a5630";
const GRID = "rgba(106,76,46,.22)";
const LINE = "#fff8ee";
const BAND = "rgba(200,154,98,.38)";

export function useWidth(initial = 324) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(initial);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const upd = () => setW(Math.max(160, Math.floor(el.clientWidth)));
    upd();
    const ro = new ResizeObserver(upd);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/* ───────── axis ───────── */
const LOG_SETS = [
  [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2],
  [0.67, 0.8, 1, 1.25, 1.5],
  [0.8, 1, 1.25],
  [0.5, 1, 2],
  [0.25, 0.5, 1, 2, 4],
  [0.1, 0.25, 0.5, 1, 2, 4, 10],
];

function niceStep(rough: number) {
  const mag = Math.pow(10, Math.floor(Math.log10(Math.max(rough, 1e-9))));
  for (const m of [1, 2, 2.5, 5, 10]) if (rough <= m * mag * 1.0000001) return m * mag;
  return 10 * mag;
}

type Axis = { min: number; max: number; ticks: number[]; fmt: (t: number) => string };

export function buildAxis(spec: ChartSpec): Axis {
  const vals: number[] = [spec.base];
  for (const r of spec.rows) {
    if (r.thin) continue;
    for (const v of [r.est, r.lo, r.hi]) if (v != null && Number.isFinite(v)) vals.push(v);
  }
  if (spec.band) vals.push(...spec.band);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (spec.min != null) lo = Math.min(lo, spec.min);
  if (spec.max != null) hi = Math.max(hi, spec.max);

  if (spec.log) {
    const l = Math.log(lo);
    const h = Math.log(hi);
    const pad = Math.max((h - l) * 0.06, 0.04);
    const min = Math.exp(l - pad);
    const max = Math.exp(h + pad);
    let ticks = spec.ticks;
    if (!ticks) {
      for (const set of LOG_SETS) {
        const inside = set.filter((t) => t >= min * 0.999 && t <= max * 1.001);
        if (inside.length >= 3 && inside.length <= 5 && inside.includes(1)) {
          ticks = inside;
          break;
        }
      }
      ticks ??= [1];
    }
    return { min, max, ticks, fmt: spec.tickFmt ?? ((t) => String(Number(t.toPrecision(3)))) };
  }

  const span0 = hi - lo || Math.max(Math.abs(spec.base) * 0.2, 1);
  let step = niceStep(span0 / 4);
  const build = (st: number) => {
    const a = Math.max(spec.floor ?? -Infinity, Math.floor((lo - span0 * 0.04) / st + 1e-9) * st);
    const b = Math.ceil((hi + span0 * 0.04) / st - 1e-9) * st;
    const t: number[] = [];
    for (let v = a; v <= b + st * 1e-6; v += st) t.push(Number(v.toPrecision(10)));
    return t;
  };
  let ticks = spec.ticks ?? build(step);
  if (!spec.ticks) {
    while (ticks.length > 5) {
      step = niceStep(step * 1.01 * 1.5);
      ticks = build(step);
    }
    if (!ticks.some((t) => Math.abs(t - spec.base) < step * 1e-6)) ticks = [...ticks, spec.base].sort((a, b) => a - b);
  }
  const dec = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3;
  const fmt =
    spec.tickFmt ??
    ((t: number) =>
      spec.base === 0 ? (t === 0 ? "0" : `${t < 0 ? "−" : "+"}${Math.abs(t).toFixed(dec)}`) : t.toFixed(dec));
  return { min: Math.max(spec.floor ?? -Infinity, Math.min(ticks[0], lo - span0 * 0.04)), max: Math.max(ticks[ticks.length - 1], hi + span0 * 0.04), ticks, fmt };
}

/* ───────── one row's plot ───────── */
function RowPlot({
  r,
  W,
  H,
  x,
  ticks,
  base,
  mark,
  band,
  uid,
}: {
  r: ChartRow;
  W: number;
  H: number;
  x: (v: number) => number;
  ticks: number[];
  base: number;
  mark: "bar" | "dot";
  band?: [number, number];
  uid: string;
}) {
  const cy = H / 2;
  const hasCi = r.lo != null && r.hi != null && r.est != null;
  const k = r.thin ? "thin" : r.ref || r.neutral || !hasCi ? "neutral" : kindOf(r.lo!, r.hi!, base);
  const fill = k === "up" ? UP : k === "down" ? DOWN : FLAT;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={r.label} style={{ display: "block" }}>
      {r.thin ? (
        <defs>
          <pattern id={`h${uid}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="rgba(106,76,46,.5)" strokeWidth="1.4" />
          </pattern>
        </defs>
      ) : null}
      {ticks.map((t) => (
        <line key={t} x1={x(t)} x2={x(t)} y1={0} y2={H} stroke={GRID} strokeWidth={1} />
      ))}
      {band ? <rect x={x(band[0])} y={cy - 9} width={Math.max(x(band[1]) - x(band[0]), 2)} height={18} fill={BAND} /> : null}
      {r.thin ? (
        <rect x={1} y={cy - 7} width={W - 2} height={14} fill={`url(#h${uid})`} stroke="rgba(106,76,46,.55)" strokeWidth={1} />
      ) : r.ref ? (
        <circle cx={x(base)} cy={cy} r={6.5} fill={LINE} stroke={INK} strokeWidth={2} />
      ) : hasCi ? (
        <>
          {mark === "bar" ? (
            <rect
              x={Math.min(x(base), x(r.est!))}
              y={cy - 7}
              width={Math.max(Math.abs(x(r.est!) - x(base)), 1.5)}
              height={14}
              fill={fill}
              fillOpacity={k === "flat" ? 0.8 : 1}
              stroke={k === "flat" ? FLAT_INK : undefined}
              strokeWidth={k === "flat" ? 1.5 : undefined}
            />
          ) : null}
          <line x1={x(r.lo!)} x2={x(r.hi!)} y1={cy} y2={cy} stroke={INK} strokeWidth={2} />
          <line x1={x(r.lo!)} x2={x(r.lo!)} y1={cy - 5} y2={cy + 5} stroke={INK} strokeWidth={2} />
          <line x1={x(r.hi!)} x2={x(r.hi!)} y1={cy - 5} y2={cy + 5} stroke={INK} strokeWidth={2} />
          {mark === "dot" ? (
            r.ring && !r.strong ? (
              <circle cx={x(r.est!)} cy={cy} r={6.5} fill={LINE} stroke={UP} strokeWidth={3.2} />
            ) : r.strong ? (
              <circle cx={x(r.est!)} cy={cy} r={6.5} fill={UP} stroke={INK} strokeWidth={2} />
            ) : (
              <circle cx={x(r.est!)} cy={cy} r={6.5} fill={k === "flat" ? LINE : fill} stroke={INK} strokeWidth={2} />
            )
          ) : null}
        </>
      ) : r.est != null ? (
        <circle cx={x(r.est)} cy={cy} r={6.5} fill={INK} stroke={INK} strokeWidth={2} />
      ) : null}
      <line x1={x(base)} x2={x(base)} y1={0} y2={H} stroke="rgba(43,29,18,.75)" strokeWidth={1.6} strokeDasharray="2 3" />
    </svg>
  );
}

/* ───────── chart ───────── */
export function Chart({ spec }: { spec: ChartSpec }) {
  const [ref, w] = useWidth();
  const uidBase = useId().replace(/:/g, "");
  const variant = spec.variant ?? (spec.rows.length <= 5 ? "detail" : "compact");
  const LABEL = w < 340 ? 84 : 92;
  const VAL = 62;
  const GAP = 16;
  const cw = variant === "detail" ? w : Math.max(80, w - LABEL - VAL - GAP);
  const ax = buildAxis(spec);
  const sx = spec.log
    ? (v: number) => ((Math.log(v) - Math.log(ax.min)) / (Math.log(ax.max) - Math.log(ax.min))) * cw
    : (v: number) => ((v - ax.min) / (ax.max - ax.min)) * cw;
  const off = variant === "detail" ? 0 : LABEL + 8;

  return (
    <div className={styles.chart} ref={ref} role="group" aria-label={spec.label}>
      {spec.rows.map((r, i) => {
        const val = r.thin ? (r.thinVal ?? "n/a") : r.ref ? (r.valText ?? "ref") : (r.valText ?? "");
        const plot = (
          <RowPlot
            r={r}
            W={cw}
            H={variant === "detail" ? 26 : 36}
            x={sx}
            ticks={ax.ticks}
            base={spec.base}
            mark={spec.mark}
            band={spec.band}
            uid={`${uidBase}_${i}`}
          />
        );
        const name = r.href ? (
          <Link href={r.href} className={styles.nmlink}>
            {r.label}
          </Link>
        ) : (
          r.label
        );
        if (variant === "detail") {
          return (
            <div className={styles.row} key={r.key} aria-current={r.mark ? "true" : undefined}>
              <div className={styles.r1}>
                <div className={styles.nm}>
                  {name}
                  {r.sub ? <i> {r.sub}</i> : null}
                  {r.mark ? <i> · selected</i> : null}
                </div>
                <div className={`${styles.v} ${r.thin && r.thinVal ? styles.dimval : ""}`}>
                  {val}
                  {!r.thin && r.unit ? <small>{r.unit}</small> : null}
                </div>
              </div>
              {plot}
              <div className={styles.r3}>
                <span>{r.thin ? (r.thinTxt ?? "too few games to read") : r.ref ? "reference tier" : (r.ciText ?? "")}</span>
                <span>{r.n ?? ""}</span>
              </div>
            </div>
          );
        }
        return (
          <div className={styles.crow} key={r.key} style={{ gridTemplateColumns: `${LABEL}px 1fr ${VAL}px` }} aria-current={r.mark ? "true" : undefined}>
            <div className={styles.nm} title={r.thin ? `${r.label}: ${r.thinTxt ?? "too few games"}` : r.n}>
              <span>{name}</span>
              {r.sub || r.thin ? <i>{r.thin ? (r.thinTxt ?? "too few games") : r.sub}</i> : null}
            </div>
            {plot}
            <div className={`${styles.v} ${r.thin ? styles.dimval : ""}`}>{val}</div>
          </div>
        );
      })}
      <svg className={styles.axis} width={cw} height={18} viewBox={`0 0 ${cw} 18`} style={{ marginLeft: off, display: "block" }} aria-hidden="true">
        {ax.ticks.map((t) => {
          const px = sx(t);
          const anchor = px < 14 ? "start" : px > cw - 14 ? "end" : "middle";
          return (
            <text key={t} x={px} y={13} textAnchor={anchor} fontFamily="Inter, system-ui, sans-serif" fontSize={12} fontWeight={t === spec.base ? 800 : 500} fill={INK}>
              {ax.fmt(t)}
            </text>
          );
        })}
      </svg>
      <div className={styles.axt} style={{ marginLeft: off, width: cw }}>
        <span>{spec.endL ?? ""}</span>
        <b>{spec.axisTitle}</b>
        <span>{spec.endR ?? ""}</span>
      </div>
    </div>
  );
}

/* ───────── legend ───────── */
const LEGEND: Record<LegendKey, [string, string]> = {
  up: ["sw up", "Above"],
  down: ["sw down", "Below"],
  flat: ["sw flat", "Can’t tell"],
  thin: ["sw thin", "Too few games"],
  whk: ["whk", "95% CI"],
  bl: ["bl", "Baseline"],
  ring: ["sw ring", "Lead only"],
  noise: ["sw noise", "By chance"],
  obs: ["sw obs", "Flagged"],
  band: ["sw band", "League-wide 95% CI"],
};

export function Legend({ keys }: { keys: LegendKey[] }) {
  if (keys.length === 0) return null;
  return (
    <div className={styles.legend}>
      {keys.map((k) => {
        const [cls, label] = LEGEND[k];
        return (
          <span key={k}>
            <i className={cls.split(" ").map((c) => styles[c]).join(" ")} />
            {label}
          </span>
        );
      })}
    </div>
  );
}
