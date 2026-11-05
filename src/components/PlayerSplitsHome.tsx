"use client";

import Link from "next/link";
import { useState } from "react";
import {
  CMP_LABELS,
  SEGMENT_ROW_LABELS,
  formatSigned,
  isWatchFlag,
  type CmpKey,
  type FlaggedEntry,
  type PlayerSplitsInsights,
  type RankEntry,
  type ScopeKey,
} from "@/lib/playerSplitsTypes";
import styles from "./PlayerSplitsHome.module.css";

const CMPS: CmpKey[] = [
  "home_away",
  "b2b_second_vs_rested",
  "b2b_first_vs_rested",
];

const SEGMENTS = ["position", "age", "experience", "scorer_tier"] as const;

export function PlayerSplitsHome({
  data,
  scope,
}: {
  data: PlayerSplitsInsights;
  scope: ScopeKey;
}) {
  const [cmp, setCmp] = useState<CmpKey>("home_away");
  const [end, setEnd] = useState<"top" | "bottom">("top");
  const [seg, setSeg] = useState<(typeof SEGMENTS)[number]>("position");

  const ranking = data.rankings[cmp]?.[scope];
  // Prefer by_raw with ci95; by_shrunk only meaningful when shrunk_is_flat is false
  const entries: RankEntry[] = ranking
    ? ranking.by_raw[end] ?? []
    : [];

  const heatmap = data.heatmaps.segment_x_condition[scope]?.[seg];

  const watchList: FlaggedEntry[] =
    scope === "combined"
      ? data.flagged.filter((f) => f.scope === "combined").length
        ? data.flagged.filter((f) => f.scope === "combined")
        : data.flagged
      : data.flagged.filter((f) => f.scope === scope);

  const flatNote = ranking?.shrunk_is_flat
    ? "Shrunk values are flat here (τ < 0.1) — showing raw gaps with intervals."
    : null;

  const nStrong = data.flagged.filter(
    (f) => typeof f.pts.flag === "string" && f.pts.flag.includes("strong"),
  ).length;

  return (
    <section className={styles.section} aria-labelledby="player-splits-h">
      <h2 id="player-splits-h" className={styles.h2}>
        Player rankings &amp; heatmaps
      </h2>
      <p className={styles.noise}>
        Mostly noise: no player passes the multiple-testing correction
        {nStrong === 0 ? " (0 “strong” flags)" : ` (${nStrong} strong)`}. Watch
        list = nominal |z| ≥ 2.5 — about chance-level volume.
      </p>
      <p className={styles.note}>{data.ranking_note}</p>

      {/* Rankings */}
      <div className={styles.toolbar}>
        <div className={styles.switch} role="tablist" aria-label="Comparison">
          {CMPS.map((c) => {
            const block = data.rankings[c]?.[scope];
            const empty = !block || block.n_ranked === 0;
            return (
              <button
                key={c}
                type="button"
                role="tab"
                aria-selected={cmp === c}
                disabled={empty}
                className={cmp === c ? styles.tabOn : styles.tab}
                onClick={() => !empty && setCmp(c)}
              >
                {c === "home_away"
                  ? "Home/away"
                  : c === "b2b_second_vs_rested"
                    ? "B2B 2nd"
                    : "B2B 1st"}
              </button>
            );
          })}
        </div>
        <div className={styles.switch} role="tablist" aria-label="Top or bottom">
          {(["top", "bottom"] as const).map((e) => (
            <button
              key={e}
              type="button"
              role="tab"
              aria-selected={end === e}
              className={end === e ? styles.tabOn : styles.tab}
              onClick={() => setEnd(e)}
            >
              {e === "top" ? "Top 25" : "Bottom 25"}
            </button>
          ))}
        </div>
      </div>

      {!ranking || ranking.n_ranked === 0 ? (
        <p className={styles.empty}>
          No qualifying players for this comparison in {scope}.
        </p>
      ) : (
        <>
          {flatNote ? <p className={styles.flat}>{flatNote}</p> : null}
          <p className={styles.meta}>
            {CMP_LABELS[cmp]} · {end === "top" ? "highest" : "lowest"} raw gaps ·
            n ranked = {ranking.n_ranked}
          </p>
          <div className={styles.rankScroll}>
            <RankBars entries={entries} />
          </div>
        </>
      )}

      {/* Heatmap */}
      <h3 className={styles.h3}>Segment heatmap</h3>
      <div className={styles.switch} role="tablist" aria-label="Segment">
        {SEGMENTS.map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={seg === s}
            className={seg === s ? styles.tabOn : styles.tab}
            onClick={() => setSeg(s)}
          >
            {s === "scorer_tier" ? "Scorer" : s[0].toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>
      {heatmap ? (
        <HeatmapTable hm={heatmap} />
      ) : (
        <p className={styles.empty}>No heatmap for this scope/segment.</p>
      )}

      {/* Watch list */}
      <h3 className={styles.h3}>Watch list</h3>
      <p className={styles.meta}>
        {watchList.length} flag{watchList.length === 1 ? "" : "s"}
        {scope === "combined" ? " (all scopes shown if combined empty)" : ` in ${scope}`}
        . Tap a name to open Betting.
      </p>
      {watchList.length === 0 ? (
        <p className={styles.empty}>No watch flags in this scope.</p>
      ) : (
        <ul className={styles.watch}>
          {watchList.map((f) => (
            <li key={`${f.scope}-${f.comparison}-${f.player_id}`}>
              <Link
                href={`/betting?player=${encodeURIComponent(f.player_id)}`}
                className={styles.watchLink}
              >
                <span className={styles.watchName}>{f.full_name}</span>
                <span className={styles.watchMeta}>
                  {f.team ?? "FA"} · {f.scope} ·{" "}
                  {CMP_LABELS[f.comparison as CmpKey] ?? f.comparison} ·{" "}
                  {formatSigned(f.pts.raw)} raw
                  {isWatchFlag(f.pts.flag) ? " · watch" : ""}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className={styles.caveats}>
        {data.caveats.map((c, i) => (
          <p key={i}>{c}</p>
        ))}
      </div>
    </section>
  );
}

function RankBars({ entries }: { entries: RankEntry[] }) {
  if (entries.length === 0) return null;
  let min = 0;
  let max = 0;
  for (const e of entries) {
    min = Math.min(min, e.pts.ci95[0], e.pts.raw);
    max = Math.max(max, e.pts.ci95[1], e.pts.raw);
  }
  const span = Math.max(max - min, 0.5);
  const pad = span * 0.08;
  min -= pad;
  max += pad;

  return (
    <ol className={styles.bars}>
      {entries.map((e, i) => {
        const left = ((e.pts.ci95[0] - min) / (max - min)) * 100;
        const right = ((e.pts.ci95[1] - min) / (max - min)) * 100;
        const mid = ((e.pts.raw - min) / (max - min)) * 100;
        const zero = ((0 - min) / (max - min)) * 100;
        const watch = isWatchFlag(e.pts.flag);
        return (
          <li key={e.player_id} className={styles.barRow}>
            <Link
              href={`/betting?player=${encodeURIComponent(e.player_id)}`}
              className={styles.barName}
            >
              <span className={styles.rankNum}>{i + 1}</span>
              {e.full_name}
              {watch ? <span className={styles.miniBadge}>watch</span> : null}
            </Link>
            <div className={styles.barTrack} aria-hidden>
              <span
                className={styles.zeroMark}
                style={{ left: `${zero}%` }}
              />
              <span
                className={watch ? styles.ciHot : styles.ci}
                style={{
                  left: `${left}%`,
                  width: `${Math.max(right - left, 0.8)}%`,
                }}
              />
              <span
                className={watch ? styles.dotHot : styles.dot}
                style={{ left: `${mid}%` }}
              />
            </div>
            <span className={styles.barVal}>{formatSigned(e.pts.raw)}</span>
          </li>
        );
      })}
    </ol>
  );
}

function HeatmapTable({
  hm,
}: {
  hm: {
    rows: string[];
    cond_cols: string[];
    pts: (number | null)[][];
    n: number[][];
    cmp_cols: string[];
    cmp_pts_mean: (number | null)[][];
  };
}) {
  // Show comparison means (paired diffs) — more chart-relevant than raw PPG
  const cols = hm.cmp_cols;
  const vals = hm.cmp_pts_mean;
  const flat = vals.flat().filter((v): v is number => v != null);
  const maxAbs = Math.max(0.5, ...flat.map((v) => Math.abs(v)));

  return (
    <div className={styles.heatScroll}>
      <table className={styles.heat}>
        <thead>
          <tr>
            <th scope="col">Segment</th>
            {cols.map((c) => (
              <th key={c} scope="col">
                {c === "home_away"
                  ? "H−A"
                  : c === "b2b_second_vs_rested"
                    ? "2nd−R"
                    : "1st−R"}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {hm.rows.map((row, ri) => (
            <tr key={row}>
              <th scope="row">{SEGMENT_ROW_LABELS[row] ?? row}</th>
              {cols.map((_, ci) => {
                const v = vals[ri]?.[ci];
                if (v == null) {
                  return (
                    <td key={ci} className={styles.heatEmpty}>
                      —
                    </td>
                  );
                }
                const intensity = Math.min(1, Math.abs(v) / maxAbs);
                const bg =
                  v >= 0
                    ? `rgba(228, 87, 46, ${0.12 + intensity * 0.55})`
                    : `rgba(92, 65, 40, ${0.08 + intensity * 0.35})`;
                return (
                  <td key={ci} style={{ background: bg }}>
                    {formatSigned(v)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className={styles.heatCap}>
        Cells = mean paired pts difference (from league analysis). Cond PPG
        grid available in JSON.
      </p>
    </div>
  );
}
