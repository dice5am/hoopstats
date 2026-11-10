"use client";

import { useEffect, useMemo, useState } from "react";
import type { FlagRow, Outcome } from "@/lib/deepInsightsTypes";
import type { ChartRow, ChartSpec } from "@/lib/insights/types";
import { fmtN, kindOf, sg } from "@/lib/insights/util";
import type { SegmentKey, TimespanKey } from "@/lib/timespans";
import { Chart, Legend, useWidth } from "../Chart";
import styles from "../insights.module.css";

/* ───────── rankings: top 5 + show more ───────── */
export function RankList({ rows, base, axisTitle, endL, endR, label, total }: { rows: ChartRow[]; base: number; axisTitle: string; endL: string; endR: string; label: string; total: number }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, 5);
  const spec: ChartSpec = { rows: shown, base, mark: "dot", axisTitle, endL, endR, label, variant: shown.length <= 5 ? "detail" : "compact" };
  return (
    <>
      <Chart spec={spec} />
      {rows.length > 5 ? (
        <button type="button" className={`${styles.btn} ${styles.moreBtn}`} onClick={() => setAll(!all)} aria-expanded={all}>
          {all ? "Show top 5" : `Show all ${total}`}
        </button>
      ) : null}
    </>
  );
}

/* ───────── per-player splits (client-loaded) ───────── */
type Row = [string, number, number, number, number, number, number, number | null, number | null, string | null, number, number];
type PlayerFile = {
  timespan: string;
  floors: Record<string, [number, number]>;
  league: Record<string, Record<string, [number | null, number | null, number | null, number | null]>>;
  players: Record<string, [string, string, number]>;
  rows: Record<string, Record<string, Row[]>>;
};

const cache = new Map<string, Promise<PlayerFile>>();
function loadFile(ts: string): Promise<PlayerFile> {
  let p = cache.get(ts);
  if (!p) {
    p = fetch(`/deep-players/${encodeURIComponent(ts)}.json`).then((r) => {
      if (!r.ok) throw new Error(String(r.status));
      return r.json() as Promise<PlayerFile>;
    });
    p.catch(() => cache.delete(ts));
    cache.set(ts, p);
  }
  return p;
}

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const SEG_BIT: Partial<Record<SegmentKey, number>> = { top100: 8, top50: 4 };
const PAGE = 10;
/** Designer's proposal: under 10 games on either side is "too few games" for a player row. */
export const PLAYER_ROW_MIN_GAMES = 10;

export function PlayerSplitsSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading players">
      <div className={styles.chart}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={styles.skRow}>
            <div className={styles.sk} style={{ height: 10 }} />
            <div className={styles.sk} style={{ height: 14 }} />
            <div className={styles.sk} style={{ height: 10 }} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function PlayerSplitsBody({ ts, seg, cond, out, summary }: { ts: TimespanKey; seg: SegmentKey; cond: string; out: Outcome; summary?: FlagRow }) {
  const [state, setState] = useState<{ ts: string; file?: PlayerFile; err?: boolean; tick: number }>({ ts: "", tick: 0 });
  const [tick, setTick] = useState(0);
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE);

  useEffect(() => {
    let live = true;
    loadFile(ts)
      .then((file) => live && setState({ ts, file, tick }))
      .catch(() => live && setState({ ts, err: true, tick }));
    return () => {
      live = false;
    };
  }, [ts, tick]);

  const file = state.ts === ts ? state.file : undefined;
  const failed = state.ts === ts && state.err;

  const list = useMemo(() => {
    if (!file) return [];
    const bit = SEG_BIT[seg];
    const q = norm(query.trim());
    const all = (file.rows[cond]?.[out] ?? []).filter((r) => {
      if (bit && !(r[11] & bit)) return false;
      if (q && !norm(file.players[r[0]]?.[0] ?? "").includes(q)) return false;
      return true;
    });
    const rank = (r: Row) => (r[9]?.endsWith("strong") ? 0 : r[9] ? 1 : 2);
    return all.sort((a, b) => rank(a) - rank(b) || Math.abs(b[7] ?? 0) - Math.abs(a[7] ?? 0));
  }, [file, cond, out, seg, query]);

  if (failed) {
    return (
      <div className={`${styles.empty} ${styles.errBox}`} role="alert">
        <h5>Couldn’t load this card</h5>
        <p>The per-player file for this timespan didn’t load. Other cards are unaffected.</p>
        <div className={styles.cact}>
          <button type="button" className={`${styles.btn} ${styles.pri}`} onClick={() => setTick(tick + 1)}>
            Try again
          </button>
        </div>
      </div>
    );
  }
  if (!file) return <PlayerSplitsSkeleton />;

  const lg = file.league[cond]?.[out];
  const isDev = out === "dev";
  const sc = isDev ? 1 : 100;
  const t = (n: number) => sg(n * sc, isDev ? 2 : 1);
  const floors = file.floors[cond];
  const rows: ChartRow[] = list.slice(0, shown).map((r) => {
    const name = file.players[r[0]]?.[0] ?? r[0];
    const pos = file.players[r[0]]?.[1];
    const flag = r[9];
    const few = Math.min(r[1], r[2]) < PLAYER_ROW_MIN_GAMES;
    const n = `${r[1]} vs ${r[2]} games`;
    const row: ChartRow = {
      key: r[0],
      label: name,
      sub: pos,
      est: r[4] * sc,
      lo: r[5] * sc,
      hi: r[6] * sc,
      valText: t(r[4]),
      unit: isDev ? "pts" : "pp",
      ciText: `${t(r[5])} to ${t(r[6])}${flag ? ` · ${flag.replace("_", " ")}` : ""}`,
      n,
      ring: !!flag && !few,
      strong: !!flag?.endsWith("strong") && !few,
      href: `/players?player=${encodeURIComponent(r[0])}`,
    };
    if (few) return { ...row, thin: true, thinVal: t(r[4]), thinTxt: `under ${PLAYER_ROW_MIN_GAMES} games on a side · ${t(r[5])} to ${t(r[6])}` };
    return row;
  });
  const nStrong = list.filter((r) => r[9]?.endsWith("strong")).length;
  const nWatch = list.filter((r) => r[9]?.endsWith("watch")).length;
  const spec: ChartSpec = {
    rows,
    base: 0,
    mark: "dot",
    axisTitle: isDev ? "Shrunk estimate vs league (pts)" : "Shrunk estimate vs league (percentage points)",
    endL: isDev ? "← fewer" : "← less likely",
    endR: isDev ? "more →" : "more likely →",
    band: lg && lg[1] != null && lg[2] != null ? [lg[1] * sc, lg[2] * sc] : undefined,
    label: "Player shrunk effects",
    variant: rows.length <= 5 ? "detail" : "compact",
  };
  const none = !!summary && summary.n_above_league === 0 && summary.n_below_league === 0;
  return (
    <>
      <label className={styles.search}>
        <span className={styles.switchLab}>Find a player</span>
        <input type="search" className={styles.searchIn} value={query} placeholder="Name" onChange={(e) => { setQuery(e.target.value); setShown(PAGE); }} />
      </label>
      <p className={styles.cellNote}>
        {fmtN(list.length)} {list.length === 1 ? "player" : "players"}
        {query ? " match" : ""} · {nStrong} strong, {nWatch} watch · strong first, then watch, then largest |z|
        {floors ? ` · needs ${floors[0]}+ games under the condition and ${floors[1]}+ outside it` : ""}
      </p>
      {rows.length === 0 ? (
        <p className={styles.cellNote}>No players match.</p>
      ) : (
        <>
          <Chart spec={spec} />
          <Legend keys={["flat", "ring", "thin", "band", "whk"]} />
          {list.length > shown ? (
            <button type="button" className={`${styles.btn} ${styles.moreBtn}`} onClick={() => setShown(shown + PAGE)}>
              Show {Math.min(PAGE, list.length - shown)} more
            </button>
          ) : null}
        </>
      )}
      {none ? (
        <div className={styles.callout}>
          <p>No player has a credible effect of his own here: every shrunk estimate stays close to the league-wide band.</p>
        </div>
      ) : null}
    </>
  );
}

export { kindOf };

/* ───────── fitted curve with 95% band ───────── */
function niceTick(span: number): number {
  const rough = span / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(Math.max(rough, 1e-6))));
  for (const m of [1, 2, 2.5, 5, 10]) if (rough <= m * mag * 1.0000001) return m * mag;
  return 10 * mag;
}

export function CurveChart({ title, pts, endLabels, axisTitle }: { title: string; pts: [number, number | null, number | null, number | null][]; endLabels: [string, string]; axisTitle: string }) {
  const [ref, W] = useWidth(324);
  const H = 150;
  const L = 40;
  const R = 10;
  const T = 8;
  const B = 26;
  const vals: number[] = [0];
  for (const p of pts) for (const v of [p[1], p[2], p[3]]) if (v != null) vals.push(v);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const pad = (hi - lo) * 0.06 || 0.1;
  const y0 = lo - pad;
  const y1 = hi + pad;
  const xs = (x: number) => L + ((x - pts[0][0]) / (pts[pts.length - 1][0] - pts[0][0])) * (W - L - R);
  const ys = (v: number) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
  const valid = pts.filter((p) => p[1] != null && p[2] != null && p[3] != null) as [number, number, number, number][];
  const band =
    valid.map((p, i) => `${i === 0 ? "M" : "L"}${xs(p[0]).toFixed(1)},${ys(p[3]).toFixed(1)}`).join(" ") +
    " " +
    [...valid].reverse().map((p) => `L${xs(p[0]).toFixed(1)},${ys(p[2]).toFixed(1)}`).join(" ") +
    " Z";
  const line = valid.map((p, i) => `${i === 0 ? "M" : "L"}${xs(p[0]).toFixed(1)},${ys(p[1]).toFixed(1)}`).join(" ");
  const step = niceTick(y1 - y0);
  const yt: number[] = [];
  for (let v = Math.ceil(y0 / step) * step; v <= y1; v += step) yt.push(Math.abs(v) < step * 1e-6 ? 0 : Number(v.toPrecision(6)));
  const dec = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  return (
    <figure style={{ margin: 0 }} ref={ref as React.Ref<HTMLElement>}>
      <figcaption className={styles.curveCap}>{title}</figcaption>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} style={{ display: "block" }}>
        {yt.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={ys(v)} y2={ys(v)} className={v === 0 ? styles.cZero : styles.cGrid} />
            <text x={L - 5} y={ys(v) + 4} textAnchor="end" className={styles.cTick} style={{ fontWeight: v === 0 ? 800 : 500 }}>
              {v === 0 ? "0" : `${v < 0 ? "−" : "+"}${Math.abs(v).toFixed(dec)}`}
            </text>
          </g>
        ))}
        <path d={band} className={styles.cBand} />
        <path d={line} className={styles.cLine} />
        <text x={L} y={H - 8} textAnchor="start" className={styles.cTick}>{endLabels[0]}</text>
        <text x={W - R} y={H - 8} textAnchor="end" className={styles.cTick}>{endLabels[1]}</text>
      </svg>
      <div className={styles.axt}><b>{axisTitle}</b></div>
    </figure>
  );
}
