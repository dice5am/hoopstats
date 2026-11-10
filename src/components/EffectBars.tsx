import styles from "./EffectBars.module.css";

export type BarRow = {
  key: string;
  label: string;
  sub?: string;
  est: number | null;
  lo: number | null;
  hi: number | null;
  /** Main value text (right column) and the CI text under it. */
  text?: string;
  ciText?: string;
  /** Extra small line under the row. */
  extra?: string;
  /** Row is blanked (no bars), with the reason shown. */
  blank?: string;
  /** Reference row: a marker at the reference value, no effect. */
  ref?: boolean;
  /** Row belongs to the currently selected segment/season. */
  mark?: boolean;
  /** Small pill next to the label (e.g. a flag). */
  badge?: string;
  badgeStrong?: boolean;
  /** Link for the label. */
  href?: string;
};

function niceStep(span: number): number {
  const rough = span / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(Math.max(rough, 1e-6))));
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (rough <= m * mag) return m * mag;
  }
  return 10 * mag;
}

const LOG_TICKS = [0.4, 0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 3];

type Axis = { tr: (v: number) => number; min: number; max: number; ticks: number[] };

function buildAxis(rows: BarRow[], log: boolean, ref0: number, band?: [number, number]): Axis {
  const vals: number[] = [ref0];
  for (const r of rows) {
    if (r.blank || r.ref) continue;
    for (const v of [r.lo, r.hi, r.est]) if (v != null) vals.push(v);
  }
  if (band) vals.push(band[0], band[1]);
  if (log) {
    const lo = Math.min(...vals) / 1.04;
    const hi = Math.max(...vals) * 1.04;
    let ticks = LOG_TICKS.filter((t) => t >= lo && t <= hi);
    while (ticks.length > 5) {
      // thin evenly but keep the reference tick
      ticks = ticks.filter((t, i) => i % 2 === 0 || t === ref0);
    }
    const tr = Math.log;
    return { tr, min: tr(Math.min(lo, ...ticks)), max: tr(Math.max(hi, ...ticks)), ticks };
  }
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const step = niceStep(Math.max(hi - lo, 0.2) * (4 / 3));
  const min = Math.floor(lo / step + 1e-9) * step;
  const max = Math.ceil(hi / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = min; v <= max + step * 1e-6; v += step) {
    ticks.push(Math.abs(v) < step * 1e-6 ? 0 : Number(v.toPrecision(6)));
  }
  return { tr: (v) => v, min, max, ticks };
}

export function EffectBars({
  rows,
  log = false,
  ref0 = log ? 1 : 0,
  tickFmt,
  label,
  band,
}: {
  band?: [number, number];
  rows: BarRow[];
  log?: boolean;
  ref0?: number;
  tickFmt: (v: number) => string;
  label: string;
}) {
  const ax = buildAxis(rows, log, ref0, band);
  const span = ax.max - ax.min || 1;
  const x = (v: number) => ((ax.tr(v) - ax.min) / span) * 100;
  const zero = x(ref0);
  return (
    <div className={styles.wrap}>
      <ol className={styles.bars} aria-label={label}>
        {rows.map((r) => {
          const hasBar = !r.blank && !r.ref && r.est != null && r.lo != null && r.hi != null;
          const crosses = hasBar && r.lo! <= ref0 && r.hi! >= ref0;
          const c = hasBar ? x(r.est!) : zero;
          return (
            <li key={r.key} className={r.mark ? styles.rowMark : styles.row}>
              <span className={styles.lab}>
                <span className={styles.labMain}>
                  {r.href ? (
                    <a href={r.href} className={styles.labLink}>
                      {r.label}
                    </a>
                  ) : (
                    r.label
                  )}
                </span>
                {r.badge ? (
                  <span className={r.badgeStrong ? styles.badgeStrong : styles.badge}>{r.badge}</span>
                ) : null}
                {r.sub ? <span className={styles.labSub}>{r.sub}</span> : null}
              </span>
              <span className={styles.plot} aria-hidden="true">
                {band ? (
                  <span
                    className={styles.band}
                    style={{ left: `${x(band[0])}%`, width: `${x(band[1]) - x(band[0])}%` }}
                  />
                ) : null}
                {ax.ticks.map((t) => (
                  <span
                    key={t}
                    className={t === ref0 ? styles.zero : styles.grid}
                    style={{ left: `${x(t)}%` }}
                  />
                ))}
                {hasBar ? (
                  <>
                    <span
                      className={crosses ? styles.barMuted : r.est! > ref0 ? styles.barPos : styles.barNeg}
                      style={{
                        left: `${Math.min(zero, c)}%`,
                        width: `${Math.abs(c - zero)}%`,
                      }}
                    />
                    <span
                      className={styles.whisker}
                      style={{ left: `${x(r.lo!)}%`, width: `${x(r.hi!) - x(r.lo!)}%` }}
                    />
                    <span className={styles.cap} style={{ left: `${x(r.lo!)}%` }} />
                    <span className={styles.cap} style={{ left: `${x(r.hi!)}%` }} />
                  </>
                ) : r.ref ? (
                  <span className={styles.refDot} style={{ left: `${zero}%` }} />
                ) : (
                  <span className={styles.blankTxt}>{r.blank}</span>
                )}
              </span>
              <span className={styles.val}>
                {hasBar ? (
                  <>
                    <span className={styles.valMain}>{r.text}</span>
                    {r.ciText ? <span className={styles.valCi}>{r.ciText}</span> : null}
                  </>
                ) : r.ref ? (
                  <span className={styles.valCi}>{r.text ?? "reference"}</span>
                ) : (
                  <span className={styles.valCi}>n/a</span>
                )}
              </span>
              {r.extra ? <span className={styles.extra}>{r.extra}</span> : null}
            </li>
          );
        })}
      </ol>
      <div className={styles.axisRow} aria-hidden="true">
        <span />
        <span className={styles.axis}>
          {ax.ticks.map((t) => (
            <span key={t} className={styles.tickLab} style={{ left: `${x(t)}%` }}>
              {tickFmt(t)}
            </span>
          ))}
        </span>
        <span />
      </div>
    </div>
  );
}
