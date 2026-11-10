"use client";

import { useMemo, useState } from "react";
import {
  SECONDARY_LABELS,
  SECONDARY_ORDER,
  SECONDARY_TITLES,
  blockHasMetric,
  formatCi,
  formatSigned,
  type ComparisonBlock,
  type InsightsData,
  type MetricStats,
  type SegmentKey,
  type TimespanKey,
} from "@/lib/insightsTypes";
import {
  SEGMENT_ORDER,
  SEGMENT_SWITCH_LABEL,
  TIMESPAN_ORDER,
  TIMESPAN_SWITCH_LABEL,
} from "@/lib/timespans";
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

function withCi(stats: MetricStats | null | undefined): stats is MetricStats & {
  ci95: [number, number];
} {
  return !!stats && Array.isArray(stats.ci95) && stats.ci95.length === 2;
}

function overallRow(block: ComparisonBlock, metric: MetricKey): DotRow | null {
  const stats = block[metric];
  if (!withCi(stats) || block.n_units <= 0) return null;
  return {
    key: "overall",
    label: "Overall",
    stats: { mean: stats.mean, ci95: stats.ci95 },
    n: block.n_units,
    small_n: block.small_n,
  };
}

function secondaryRows(
  cut: Record<string, { home_away: ComparisonBlock | null; b2b_2nd: ComparisonBlock | null; b2b_1st: ComparisonBlock | null } | number> | undefined,
  keys: readonly string[],
  cmp: "home_away" | "b2b_2nd" | "b2b_1st",
  metric: MetricKey,
): DotRow[] {
  if (!cut) return [];
  const out: DotRow[] = [];
  for (const key of keys) {
    const entry = cut[key];
    if (!entry || typeof entry === "number") continue;
    const block = entry[cmp];
    if (!block || block.n_units <= 0) continue;
    const stats = block[metric];
    if (!withCi(stats)) continue;
    out.push({
      key,
      label: SECONDARY_LABELS[key] ?? key,
      stats: { mean: stats.mean, ci95: stats.ci95 },
      n: block.n_units,
      small_n: block.small_n,
    });
  }
  return out;
}

function unitsWord(pooled: boolean, nUnits: number, nPlayers: number): string {
  if (pooled) return `${nUnits} player-seasons, ${nPlayers} players`;
  return `${nPlayers} players`;
}

function ptsCaption(
  stats: MetricStats,
  block: ComparisonBlock,
  pooled: boolean,
): string {
  const n = unitsWord(pooled, block.n_units, block.n_players);
  const ci = withCi(stats) ? formatCi(stats.ci95) : "CI unavailable";
  const crosses =
    withCi(stats) && stats.ci95[0] < 0 && stats.ci95[1] > 0;
  const edge =
    Math.abs(stats.mean) < 0.15 && crosses
      ? "Essentially flat — no real home edge."
      : crosses
        ? "The interval includes zero — no clear home edge."
        : stats.mean > 0
          ? "Slightly higher at home."
          : "Slightly higher on the road.";
  return `${formatSigned(stats.mean)} pts home vs away (${ci}; n = ${n}). ${edge}`;
}

function b2bPtsCaption(
  stats: MetricStats,
  min: MetricStats | null,
  per36: MetricStats | null,
  block: ComparisonBlock,
  pooled: boolean,
): string {
  const n = unitsWord(pooled, block.n_units, block.n_players);
  const ci = withCi(stats) ? formatCi(stats.ci95) : "CI unavailable";
  let driven = "";
  if (min && per36) {
    const minMoves =
      Math.abs(min.mean) > 0.3 &&
      (!withCi(min) || min.ci95[0] > 0 || min.ci95[1] < 0);
    const rateFlat =
      Math.abs(per36.mean) < 0.2 ||
      (withCi(per36) && per36.ci95[0] < 0 && per36.ci95[1] > 0);
    if (minMoves && rateFlat) {
      driven = ` Driven by minutes (${formatSigned(min.mean)} min), not scoring rate (${formatSigned(per36.mean)} per 36).`;
    }
  }
  return `Second night of a back-to-back: ${formatSigned(stats.mean)} pts vs rested (${ci}; n = ${n}).${driven}`;
}

export function InsightsHome({
  data,
  playerSplits,
}: {
  data: InsightsData;
  playerSplits: PlayerSplitsInsights;
}) {
  const timespans = (data.timespans?.length ? data.timespans : TIMESPAN_ORDER) as TimespanKey[];
  const segments = (data.segments?.length ? data.segments : SEGMENT_ORDER) as SegmentKey[];
  const [timespan, setTimespan] = useState<TimespanKey>(
    data.default?.timespan ?? "pooled_2023_26",
  );
  const [segment, setSegment] = useState<SegmentKey>(
    data.default?.segment ?? "all",
  );

  const info = data.timespan_info[timespan];
  const pooled = info?.pooled ?? timespan.startsWith("pooled");
  const block = data.results[timespan]?.[segment];
  const secondary = data.secondary[timespan];

  const ha = block?.home_away ?? null;
  const b2b2 = block?.b2b_2nd ?? null;
  const b2b1 = block?.b2b_1st ?? null;
  const showHa = blockHasMetric(ha, "pts");
  const showB2b = blockHasMetric(b2b2, "pts");
  const showB2b1 = blockHasMetric(b2b1, "pts");

  const top100B2b = data.results[timespan]?.top100?.b2b_2nd;
  const top10B2b = data.results[timespan]?.top10?.b2b_2nd;

  const asOf = useMemo(() => {
    if (!info) return "";
    if (info.data_as_of) return `${info.label} · through ${info.data_as_of}`;
    return info.label;
  }, [info]);

  const minGames =
    typeof data.definitions.min_games_per_side === "number"
      ? data.definitions.min_games_per_side
      : 3;

  const haStory = ha?.pts
    ? `${formatSigned(ha.pts.mean)} pts home vs away` +
      (withCi(ha.pts) ? ` (${formatCi(ha.pts.ci95)})` : "") +
      " — about zero. No real home edge."
    : "No real home edge in points. Venue barely moves the needle.";

  const b2bStory = (() => {
    if (!b2b2?.pts) return null;
    const parts = [
      `Players score a bit more on the second night (${formatSigned(b2b2.pts.mean)} pts)`,
    ];
    if (b2b2.minutes && b2b2.per36) {
      const rateFlat =
        Math.abs(b2b2.per36.mean) < 0.2 ||
        (withCi(b2b2.per36) &&
          b2b2.per36.ci95[0] < 0 &&
          b2b2.per36.ci95[1] > 0);
      if (rateFlat) {
        parts.push(
          `because they play more minutes (${formatSigned(b2b2.minutes.mean)} min), not because they score faster (${formatSigned(b2b2.per36.mean)} per 36)`,
        );
      }
    }
    let extra = "";
    if (segment === "all" && top100B2b?.pts) {
      extra = ` Top 100 scorers ${formatSigned(top100B2b.pts.mean)} pts`;
      if (withCi(top100B2b.pts)) extra += ` (${formatCi(top100B2b.pts.ci95)})`;
      extra += " — they don’t gain.";
      if (top10B2b?.pts) {
        extra += ` Top 10: ${formatSigned(top10B2b.pts.mean)}`;
        if (withCi(top10B2b.pts)) extra += ` (${formatCi(top10B2b.pts.ci95)})`;
        extra += ".";
      }
    } else if (segment !== "all" && b2b2.pts) {
      const crosses =
        withCi(b2b2.pts) && b2b2.pts.ci95[0] < 0 && b2b2.pts.ci95[1] > 0;
      if (crosses || b2b2.pts.mean <= 0) {
        extra = " Top scorers don’t gain.";
      }
    }
    return parts.join(" — ") + "." + extra;
  })();

  return (
    <main className={styles.main}>
      <header className={styles.hero}>
        <h1 className={styles.title}>Points: home / away &amp; B2Bs</h1>
        <p className={styles.lede}>
          Do players score more at home? Do back-to-backs hurt? Each player is
          compared against himself — regular season only.
        </p>
        <div className={styles.switch} role="tablist" aria-label="Timespan">
          {timespans.map((s) => {
            const selected = timespan === s;
            const tip = data.timespan_info[s]?.label ?? TIMESPAN_SWITCH_LABEL[s];
            return (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-label={tip}
                title={tip}
                className={selected ? styles.tabOn : styles.tab}
                onClick={() => setTimespan(s)}
              >
                {TIMESPAN_SWITCH_LABEL[s] ?? s}
                {s === "2026_27" ? (
                  <span className={styles.pill}>early sample</span>
                ) : null}
              </button>
            );
          })}
        </div>
        <div className={styles.switch} role="tablist" aria-label="PPG segment">
          {segments.map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={segment === s}
              className={segment === s ? styles.tabOn : styles.tab}
              onClick={() => setSegment(s)}
            >
              {SEGMENT_SWITCH_LABEL[s] ?? s}
            </button>
          ))}
        </div>
        <p className={styles.asOf}>
          {asOf}
          {block?.ppg_range
            ? ` · ${SEGMENT_SWITCH_LABEL[segment]} PPG ${block.ppg_range[0].toFixed(2)}–${block.ppg_range[1].toFixed(2)}`
            : segment !== "all"
              ? ` · ${SEGMENT_SWITCH_LABEL[segment]}`
              : ""}
        </p>
      </header>

      <section className={styles.section} aria-labelledby="ha-h">
        <h2 id="ha-h" className={styles.h2}>
          Home vs away
        </h2>
        <p className={styles.story}>{haStory}</p>
        {showHa && ha?.pts ? (
          <>
            <div className={styles.statRow}>
              <div className={styles.stat}>
                <span className={styles.statLab}>Mean diff</span>
                <span className={styles.statVal}>
                  {formatSigned(ha.pts.mean)}
                </span>
                <span className={styles.statUnit}>pts</span>
              </div>
              <div className={styles.stat}>
                <span className={styles.statLab}>95% CI</span>
                <span className={styles.statValSm}>
                  {withCi(ha.pts) ? formatCi(ha.pts.ci95) : "n/a"}
                </span>
              </div>
              <div className={styles.stat}>
                <span className={styles.statLab}>
                  {pooled ? "Units" : "Players"}
                </span>
                <span className={styles.statValSm}>
                  {pooled ? ha.n_units : ha.n_players}
                </span>
              </div>
            </div>
            {overallRow(ha, "pts") ? (
              <figure className={styles.figure}>
                <DotWhisker rows={[overallRow(ha, "pts")!]} unitLabel="pts" />
                <figcaption className={styles.caption}>
                  {ptsCaption(ha.pts, ha, pooled)}
                </figcaption>
              </figure>
            ) : null}
          </>
        ) : (
          <p className={styles.empty}>
            No qualifying players for this timespan and segment.
          </p>
        )}

        {segment === "all" &&
          (Object.keys(SECONDARY_ORDER) as (keyof typeof SECONDARY_ORDER)[]).map(
            (segKey) => {
              const rows = secondaryRows(
                secondary?.[segKey],
                SECONDARY_ORDER[segKey],
                "home_away",
                "pts",
              );
              if (rows.length === 0) return null;
              return (
                <figure key={segKey} className={styles.figure}>
                  <h3 className={styles.h3}>{SECONDARY_TITLES[segKey]}</h3>
                  <DotWhisker rows={rows} unitLabel="pts" />
                  <figcaption className={styles.caption}>
                    Points difference (home − away) by{" "}
                    {SECONDARY_TITLES[segKey].replace(/^By /, "").toLowerCase()}
                    . CIs that cross zero mean no clear edge.
                  </figcaption>
                </figure>
              );
            },
          )}
      </section>

      <section className={styles.section} aria-labelledby="b2b2-h">
        <h2 id="b2b2-h" className={styles.h2}>
          Back-to-backs · 2nd night
        </h2>
        {!showB2b ? (
          <p className={styles.empty}>
            {timespan === "2026_27"
              ? "Too few qualifying back-to-back units in this 2026-27 cut (need ≥3 games on each side)."
              : "No qualifying back-to-back data for this timespan and segment."}
          </p>
        ) : b2b2 ? (
          <>
            {b2bStory ? <p className={styles.story}>{b2bStory}</p> : null}
            {b2b2.pts ? (
              <div className={styles.statRow}>
                <div className={styles.stat}>
                  <span className={styles.statLab}>Points</span>
                  <span className={styles.statVal}>
                    {formatSigned(b2b2.pts.mean)}
                  </span>
                </div>
                {b2b2.minutes ? (
                  <div className={styles.stat}>
                    <span className={styles.statLab}>Minutes</span>
                    <span className={styles.statVal}>
                      {formatSigned(b2b2.minutes.mean)}
                    </span>
                  </div>
                ) : null}
                {b2b2.per36 ? (
                  <div className={styles.stat}>
                    <span className={styles.statLab}>Per 36</span>
                    <span className={styles.statVal}>
                      {formatSigned(b2b2.per36.mean)}
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
              const row = overallRow(b2b2, metric);
              if (!row) return null;
              return (
                <figure key={metric} className={styles.figure}>
                  <h3 className={styles.h3}>Overall · {title}</h3>
                  <DotWhisker rows={[row]} unitLabel={METRIC_UNIT[metric]} />
                  <figcaption className={styles.caption}>
                    {metric === "pts" && b2b2.pts
                      ? b2bPtsCaption(
                          b2b2.pts,
                          b2b2.minutes,
                          b2b2.per36,
                          b2b2,
                          pooled,
                        )
                      : withCi(row.stats as MetricStats)
                        ? `${title} on 2nd night minus rested (${formatSigned(row.stats.mean)}; ${formatCi(row.stats.ci95)}).`
                        : `${title} on 2nd night minus rested (${formatSigned(row.stats.mean)}).`}
                  </figcaption>
                </figure>
              );
            })}

            {segment === "all" &&
              (Object.keys(SECONDARY_ORDER) as (keyof typeof SECONDARY_ORDER)[]).map(
                (segKey) => {
                  const metrics: MetricKey[] =
                    segKey === "experience" ? ["pts", "minutes"] : ["pts"];
                  return metrics.map((metric) => {
                    const rows = secondaryRows(
                      secondary?.[segKey],
                      SECONDARY_ORDER[segKey],
                      "b2b_2nd",
                      metric,
                    );
                    if (rows.length === 0) return null;
                    return (
                      <figure
                        key={`b2b2-${segKey}-${metric}`}
                        className={styles.figure}
                      >
                        <h3 className={styles.h3}>
                          {SECONDARY_TITLES[segKey]} · {METRIC_UNIT[metric]}
                        </h3>
                        <DotWhisker
                          rows={rows}
                          unitLabel={METRIC_UNIT[metric]}
                        />
                        <figcaption className={styles.caption}>
                          {segKey === "experience" && metric === "minutes"
                            ? "Younger players and rookies gain the most minutes on second nights."
                            : `2nd night − rested (${METRIC_UNIT[metric]}) by ${SECONDARY_TITLES[segKey]
                                .replace(/^By /, "")
                                .toLowerCase()}.`}
                        </figcaption>
                      </figure>
                    );
                  });
                },
              )}
          </>
        ) : null}
      </section>

      <section className={styles.section} aria-labelledby="b2b1-h">
        <h2 id="b2b1-h" className={styles.h2}>
          Back-to-backs · 1st night
        </h2>
        {!showB2b1 ? (
          <p className={styles.empty}>
            {timespan === "2026_27"
              ? "Too few qualifying first-night units in this 2026-27 cut."
              : "No qualifying first-night data for this timespan and segment."}
          </p>
        ) : b2b1?.pts && overallRow(b2b1, "pts") ? (
          <figure className={styles.figure}>
            <DotWhisker rows={[overallRow(b2b1, "pts")!]} unitLabel="pts" />
            <figcaption className={styles.caption}>
              First night vs rested: {formatSigned(b2b1.pts.mean)} pts (
              {withCi(b2b1.pts) ? `${formatCi(b2b1.pts.ci95)}; ` : ""}
              n = {unitsWord(pooled, b2b1.n_units, b2b1.n_players)}). Close to
              a normal game for points
              {b2b1.minutes
                ? `, with minutes ${formatSigned(b2b1.minutes.mean)}`
                : ""}
              .
            </figcaption>
          </figure>
        ) : (
          <p className={styles.empty}>
            Not enough units for a confidence interval.
          </p>
        )}
      </section>

      <PlayerSplitsHome data={playerSplits} timespan={timespan} />

      <footer className={styles.method}>
        <p>
          Method: each player is compared against himself (condition A − B),
          with at least {minGames} games on each side, regular-season games only
          (game IDs starting 002; Cup group/knockout count; Cup final, playoffs
          and play-in excluded). Mean of per-player differences; 95% CI from a
          percentile bootstrap
          {pooled ? " (clustered by player in pooled spans)" : ""}.
        </p>
      </footer>
    </main>
  );
}
