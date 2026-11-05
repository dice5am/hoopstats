"use client";

import { useMemo, useState } from "react";
import {
  SEGMENT_LABELS,
  SEGMENT_ORDER,
  SEGMENT_TITLES,
  SCOPE_ORDER,
  formatCi,
  formatSigned,
  scopeHasMetric,
  type InsightsData,
  type MetricBlock,
  type MetricStats,
  type ScopeKey,
  type SegmentMap,
} from "@/lib/insightsTypes";
import { DotWhisker, type DotRow } from "./DotWhisker";
import { PlayerSplitsHome } from "./PlayerSplitsHome";
import type { PlayerSplitsInsights } from "@/lib/playerSplitsTypes";
import styles from "./InsightsHome.module.css";

type MetricKey = "pts" | "minutes" | "per36";

const METRIC_UNIT: Record<MetricKey, string> = {
  pts: "pts",
  minutes: "min",
  per36: "per 36",
};

function segmentRows(
  seg: SegmentMap | undefined,
  keys: readonly string[],
  metric: MetricKey,
): DotRow[] {
  if (!seg) return [];
  const out: DotRow[] = [];
  for (const key of keys) {
    const block = seg[key];
    if (!block || typeof block === "number") continue;
    const stats = block[metric];
    if (!stats || block.n_units <= 0) continue;
    out.push({
      key,
      label: SEGMENT_LABELS[key] ?? key,
      stats,
      n: block.n_units,
      small_n: block.small_n,
    });
  }
  return out;
}

function overallRow(block: MetricBlock, metric: MetricKey): DotRow | null {
  const stats = block[metric];
  if (!stats || block.n_units <= 0) return null;
  return {
    key: "overall",
    label: "Overall",
    stats,
    n: block.n_units,
    small_n: block.small_n,
  };
}

function ptsCaption(stats: MetricStats, n: number, scope: ScopeKey): string {
  const edge =
    Math.abs(stats.mean) < 0.15 &&
    stats.ci95[0] < 0 &&
    stats.ci95[1] > 0
      ? "essentially flat — no real home edge"
      : stats.mean > 0
        ? "slightly higher at home"
        : "slightly higher on the road";
  return `${formatSigned(stats.mean)} pts home vs away (${formatCi(stats.ci95)}; n = ${n}${scope === "combined" ? " player-seasons" : " players"}). ${edge.charAt(0).toUpperCase()}${edge.slice(1)}.`;
}

function b2bPtsCaption(stats: MetricStats, min: MetricStats | null, per36: MetricStats | null, n: number): string {
  let driven = "";
  if (min && per36) {
    const minMoves = Math.abs(min.mean) > 0.3 && (min.ci95[0] > 0 || min.ci95[1] < 0);
    const rateFlat = Math.abs(per36.mean) < 0.2 || (per36.ci95[0] < 0 && per36.ci95[1] > 0);
    if (minMoves && rateFlat) {
      driven = ` Driven by minutes (${formatSigned(min.mean)} min), not scoring rate (${formatSigned(per36.mean)} per 36).`;
    }
  }
  return `Second night of a back-to-back: ${formatSigned(stats.mean)} pts vs rested (${formatCi(stats.ci95)}; n = ${n}).${driven}`;
}

export function InsightsHome({ data, playerSplits }: { data: InsightsData; playerSplits: PlayerSplitsInsights }) {
  const [scope, setScope] = useState<ScopeKey>("2025-26");

  const ha = data.results.home_away.by_scope[scope];
  const b2b2 = data.results.b2b_second_vs_rested.by_scope[scope];
  const b2b1 = data.results.b2b_first_vs_rested.by_scope[scope];

  const b2bAvailable = useMemo(() => {
    const map: Record<ScopeKey, boolean> = {
      "2025-26": false,
      "2026-27": false,
      combined: false,
    };
    for (const s of SCOPE_ORDER) {
      map[s] = scopeHasMetric(
        data.results.b2b_second_vs_rested.by_scope[s]?.overall,
        "pts",
      );
    }
    return map;
  }, [data]);

  const haOverall = ha?.overall;
  const haPts = haOverall?.pts ?? null;

  const b2b2Overall = b2b2?.overall;
  const showB2b = scopeHasMetric(b2b2Overall, "pts");
  const showB2b1 = scopeHasMetric(b2b1?.overall, "pts");

  const asOf =
    scope === "combined"
      ? Object.entries(data.data_as_of)
          .map(([k, v]) => `${k}: ${v}`)
          .join(" · ")
      : data.data_as_of[scope] ?? data.data_as_of["2026-27"];

  const minGames =
    typeof data.definitions.min_games_per_side === "number"
      ? data.definitions.min_games_per_side
      : 3;

  return (
    <main className={styles.main}>
      <header className={styles.hero}>
        <h1 className={styles.title}>Points: home / away &amp; B2Bs</h1>
        <p className={styles.lede}>
          Do players score more at home? Do back-to-backs hurt? Each player is
          compared against himself — regular season only.
        </p>
        <div className={styles.switch} role="tablist" aria-label="Season">
          {SCOPE_ORDER.map((s) => {
            const isB2bEmpty = !b2bAvailable[s] && s === "2026-27";
            const selected = scope === s;
            return (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={selected}
                className={selected ? styles.tabOn : styles.tab}
                onClick={() => setScope(s)}
              >
                {s === "combined" ? "Combined" : s}
                {s === "2026-27" ? (
                  <span className={styles.pill}>small sample</span>
                ) : null}
                {isB2bEmpty && selected ? null : null}
              </button>
            );
          })}
        </div>
        <p className={styles.asOf}>Data as of {asOf}</p>
      </header>

      {/* HOME VS AWAY */}
      <section className={styles.section} aria-labelledby="ha-h">
        <h2 id="ha-h" className={styles.h2}>
          Home vs away
        </h2>
        <p className={styles.story}>
          No real home edge in points. Venue barely moves the needle.
        </p>
        {haPts && haOverall ? (
          <>
            <div className={styles.statRow}>
              <div className={styles.stat}>
                <span className={styles.statLab}>Mean diff</span>
                <span className={styles.statVal}>
                  {formatSigned(haPts.mean)}
                </span>
                <span className={styles.statUnit}>pts</span>
              </div>
              <div className={styles.stat}>
                <span className={styles.statLab}>95% CI</span>
                <span className={styles.statValSm}>
                  {formatCi(haPts.ci95)}
                </span>
              </div>
              <div className={styles.stat}>
                <span className={styles.statLab}>
                  {scope === "combined" ? "Units" : "Players"}
                </span>
                <span className={styles.statValSm}>{haOverall.n_units}</span>
              </div>
            </div>
            <figure className={styles.figure}>
              <DotWhisker
                rows={[overallRow(haOverall, "pts")!].filter(Boolean)}
                unitLabel="pts"
              />
              <figcaption className={styles.caption}>
                {ptsCaption(haPts, haOverall.n_units, scope)}
              </figcaption>
            </figure>
          </>
        ) : (
          <p className={styles.empty}>No qualifying players for this scope.</p>
        )}

        {(
          Object.keys(SEGMENT_ORDER) as (keyof typeof SEGMENT_ORDER)[]
        ).map((segKey) => {
          const rows = segmentRows(
            ha?.segments?.[segKey],
            SEGMENT_ORDER[segKey],
            "pts",
          );
          if (rows.length === 0) return null;
          return (
            <figure key={segKey} className={styles.figure}>
              <h3 className={styles.h3}>{SEGMENT_TITLES[segKey]}</h3>
              <DotWhisker rows={rows} unitLabel="pts" />
              <figcaption className={styles.caption}>
                Points difference (home − away) by {SEGMENT_TITLES[segKey]
                  .replace(/^By /, "")
                  .toLowerCase()}
                . CIs that cross zero mean no clear edge.
              </figcaption>
            </figure>
          );
        })}
      </section>

      {/* B2B SECOND */}
      <section className={styles.section} aria-labelledby="b2b2-h">
        <h2 id="b2b2-h" className={styles.h2}>
          Back-to-backs · 2nd night
        </h2>
        {!showB2b ? (
          <p className={styles.empty}>
            {scope === "2026-27"
              ? "No qualifying players yet for 2026-27 back-to-backs (need ≥3 games on each side). Teams have only played about one B2B each so far."
              : "No qualifying back-to-back data for this scope."}
          </p>
        ) : (
          <>
            <p className={styles.story}>
              Players score a bit <em>more</em> on the second night — because
              they play more minutes, not because they score faster.
            </p>
            {b2b2Overall?.pts ? (
              <div className={styles.statRow}>
                <div className={styles.stat}>
                  <span className={styles.statLab}>Points</span>
                  <span className={styles.statVal}>
                    {formatSigned(b2b2Overall.pts.mean)}
                  </span>
                </div>
                {b2b2Overall.minutes ? (
                  <div className={styles.stat}>
                    <span className={styles.statLab}>Minutes</span>
                    <span className={styles.statVal}>
                      {formatSigned(b2b2Overall.minutes.mean)}
                    </span>
                  </div>
                ) : null}
                {b2b2Overall.per36 ? (
                  <div className={styles.stat}>
                    <span className={styles.statLab}>Per 36</span>
                    <span className={styles.statVal}>
                      {formatSigned(b2b2Overall.per36.mean)}
                    </span>
                  </div>
                ) : null}
              </div>
            ) : null}

            {(
              [
                ["pts", "Points"],
                ["minutes", "Minutes"],
                ["per36", "Points per 36"],
              ] as [MetricKey, string][]
            ).map(([metric, title]) => {
              const row = overallRow(b2b2Overall!, metric);
              if (!row) return null;
              return (
                <figure key={metric} className={styles.figure}>
                  <h3 className={styles.h3}>Overall · {title}</h3>
                  <DotWhisker rows={[row]} unitLabel={METRIC_UNIT[metric]} />
                  <figcaption className={styles.caption}>
                    {metric === "pts" && b2b2Overall?.pts
                      ? b2bPtsCaption(
                          b2b2Overall.pts,
                          b2b2Overall.minutes,
                          b2b2Overall.per36,
                          b2b2Overall.n_units,
                        )
                      : `${title} on 2nd night minus rested (${formatSigned(row.stats.mean)}; ${formatCi(row.stats.ci95)}).`}
                  </figcaption>
                </figure>
              );
            })}

            {(
              Object.keys(SEGMENT_ORDER) as (keyof typeof SEGMENT_ORDER)[]
            ).map((segKey) => {
              // Show pts + minutes for scorer_tier (story about top 10 vs bench)
              // For others show pts primarily; also minutes for experience (rookies)
              const metrics: MetricKey[] =
                segKey === "scorer_tier" || segKey === "experience"
                  ? ["pts", "minutes"]
                  : ["pts"];
              return metrics.map((metric) => {
                const rows = segmentRows(
                  b2b2?.segments?.[segKey],
                  SEGMENT_ORDER[segKey],
                  metric,
                );
                if (rows.length === 0) return null;
                return (
                  <figure
                    key={`b2b2-${segKey}-${metric}`}
                    className={styles.figure}
                  >
                    <h3 className={styles.h3}>
                      {SEGMENT_TITLES[segKey]} · {METRIC_UNIT[metric]}
                    </h3>
                    <DotWhisker rows={rows} unitLabel={METRIC_UNIT[metric]} />
                    <figcaption className={styles.caption}>
                      {segKey === "scorer_tier" && metric === "minutes"
                        ? "Top scorers lose minutes on second nights; the bench and role players pick them up."
                        : segKey === "experience" && metric === "minutes"
                          ? "Younger players and rookies gain the most minutes on second nights."
                          : `2nd night − rested (${METRIC_UNIT[metric]}) by ${SEGMENT_TITLES[segKey]
                              .replace(/^By /, "")
                              .toLowerCase()}.`}
                    </figcaption>
                  </figure>
                );
              });
            })}
          </>
        )}
      </section>

      {/* B2B FIRST — small */}
      <section className={styles.section} aria-labelledby="b2b1-h">
        <h2 id="b2b1-h" className={styles.h2}>
          Back-to-backs · 1st night
        </h2>
        {!showB2b1 ? (
          <p className={styles.empty}>
            {scope === "2026-27"
              ? "No qualifying players yet for 2026-27 first-night back-to-backs."
              : "No qualifying first-night data for this scope."}
          </p>
        ) : b2b1?.overall?.pts ? (
          <figure className={styles.figure}>
            <DotWhisker
              rows={[overallRow(b2b1.overall, "pts")!]}
              unitLabel="pts"
            />
            <figcaption className={styles.caption}>
              First night vs rested: {formatSigned(b2b1.overall.pts.mean)} pts (
              {formatCi(b2b1.overall.pts.ci95)}; n = {b2b1.overall.n_units}).
              Close to a normal game for points
              {b2b1.overall.minutes
                ? `, with minutes ${formatSigned(b2b1.overall.minutes.mean)}`
                : ""}
              .
            </figcaption>
          </figure>
        ) : null}
      </section>

      <PlayerSplitsHome data={playerSplits} scope={scope} />

      <footer className={styles.method}>
        <p>
          Method: each player is compared against himself (condition A − B),
          with at least {minGames} games on each side, regular-season games only
          (game IDs starting 002; Cup group/knockout count; Cup final, playoffs
          and play-in excluded). Mean of per-player differences; 95% CI from a
          percentile bootstrap.
        </p>
      </footer>
    </main>
  );
}
