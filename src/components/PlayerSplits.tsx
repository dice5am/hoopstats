"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CMP_LABELS,
  SCOPE_ORDER,
  TIMESPAN_SWITCH_LABEL,
  formatCi,
  formatSigned,
  gameInTimespan,
  gameRow,
  isWatchFlag,
  parseJsonAllowingNaN,
  type CmpKey,
  type PlayerSplits as PlayerSplitsData,
  type QualifyingCmp,
  type TimespanKey,
} from "@/lib/playerSplitsTypes";
import styles from "./PlayerSplits.module.css";

type Props = { playerId: string; playerName: string };

type LoadState =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "error"; message: string }
  | { status: "ready"; data: PlayerSplitsData };

const CMPS: CmpKey[] = [
  "home_away",
  "b2b_second_vs_rested",
  "b2b_first_vs_rested",
];

export function PlayerSplits({ playerId, playerName }: Props) {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    fetch(`/splits/${encodeURIComponent(playerId)}.json`)
      .then(async (res) => {
        if (res.status === 404) {
          if (!cancelled) setState({ status: "missing" });
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        const data = parseJsonAllowingNaN<PlayerSplitsData>(text);
        if (!cancelled) setState({ status: "ready", data });
      })
      .catch((e: Error) => {
        if (!cancelled)
          setState({ status: "error", message: e.message || "Failed to load" });
      });
    return () => {
      cancelled = true;
    };
  }, [playerId]);

  if (state.status === "loading") {
    return (
      <section className={styles.wrap} aria-busy>
        <h3 className={styles.h3}>Home / away &amp; B2B</h3>
        <p className={styles.muted}>Loading splits…</p>
      </section>
    );
  }
  if (state.status === "missing") {
    return (
      <section className={styles.wrap}>
        <h3 className={styles.h3}>Home / away &amp; B2B</h3>
        <p className={styles.muted}>
          No splits file for {playerName}. Too few games or not in the analysis
          set.
        </p>
      </section>
    );
  }
  if (state.status === "error") {
    return (
      <section className={styles.wrap}>
        <h3 className={styles.h3}>Home / away &amp; B2B</h3>
        <p className={styles.muted}>Couldn’t load splits ({state.message}).</p>
      </section>
    );
  }

  return <PlayerSplitsReady data={state.data} />;
}

function PlayerSplitsReady({ data }: { data: PlayerSplitsData }) {
  const order = (data.timespans?.length ? data.timespans : SCOPE_ORDER) as TimespanKey[];
  const available = order.filter((s) => data.seasons[s] != null);
  const initial =
    (data.default_timespan && available.includes(data.default_timespan)
      ? data.default_timespan
      : available[0]) ?? "pooled_2023_26";
  const [scope, setScope] = useState<TimespanKey>(initial);
  const [showRawHome, setShowRawHome] = useState(false);

  const season = data.seasons[scope];
  const league = data.league[scope];

  const anyWatch = useMemo(() => {
    for (const s of SCOPE_ORDER) {
      const block = data.seasons[s];
      if (!block) continue;
      for (const cmp of CMPS) {
        const c = block.comparisons[cmp];
        if (c?.qualifies && isWatchFlag(c.pts.flag)) return true;
      }
    }
    return false;
  }, [data]);

  const watchHere = useMemo(() => {
    if (!season) return [] as string[];
    const out: string[] = [];
    for (const cmp of CMPS) {
      const c = season.comparisons[cmp];
      if (c?.qualifies && isWatchFlag(c.pts.flag)) out.push(CMP_LABELS[cmp]);
    }
    return out;
  }, [season]);

  return (
    <section className={styles.wrap}>
      <div className={styles.head}>
        <h3 className={styles.h3}>Home / away &amp; B2B</h3>
        {anyWatch ? (
          <span className={styles.badge} title="Nominal |z| ≥ 2.5 watch flag">
            Watch list
          </span>
        ) : null}
      </div>
      <p className={styles.caveat}>
        Individual gaps are mostly noise — no player passes the multiple-testing
        correction. Treat large raw swings as “worth a look,” not findings.
      </p>

      <div className={styles.switch} role="tablist" aria-label="Splits season">
        {available.map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={scope === s}
            className={scope === s ? styles.tabOn : styles.tab}
            onClick={() => setScope(s)}
          >
            {TIMESPAN_SWITCH_LABEL[s] ?? s}
            {s === "2026_27" ? (
              <span className={styles.pill}>early sample</span>
            ) : null}
          </button>
        ))}
      </div>

      {!season ? (
        <p className={styles.muted}>No games in this scope.</p>
      ) : (
        <>
          {watchHere.length > 0 ? (
            <p className={styles.watchLine}>
              Watch flag this scope: {watchHere.join(" · ")}
            </p>
          ) : null}

          {CMPS.map((cmp) => {
            const c = season.comparisons[cmp];
            if (!c) return null;
            if (!c.qualifies) {
              return (
                <div key={cmp} className={styles.block}>
                  <h4 className={styles.h4}>{CMP_LABELS[cmp]}</h4>
                  <p className={styles.muted}>
                    Needs ≥3 games on each side (has {c.n_a} / {c.n_b}).
                  </p>
                </div>
              );
            }
            const q = c as QualifyingCmp;
            const tau = league?.comparisons?.[cmp]?.tau ?? 0;
            const flat = cmp !== "home_away" && tau < 0.1;
            const useShrunk = cmp === "home_away" && !showRawHome;
            const value = useShrunk ? q.pts.shrunk : q.pts.raw;
            const leagueMean = league?.comparisons?.[cmp]?.pts_mean ?? 0;
            return (
              <div key={cmp} className={styles.block}>
                <div className={styles.blockHead}>
                  <h4 className={styles.h4}>{CMP_LABELS[cmp]}</h4>
                  {cmp === "home_away" ? (
                    <button
                      type="button"
                      className={styles.toggle}
                      onClick={() => setShowRawHome(!showRawHome)}
                    >
                      {showRawHome ? "Show shrunk" : "Show raw"}
                    </button>
                  ) : flat ? (
                    <span className={styles.pill}>raw (shrunk flat)</span>
                  ) : null}
                </div>
                <PlayerCmpChart
                  label={useShrunk ? "Shrunk" : "Raw"}
                  value={value}
                  ci={q.pts.ci95}
                  leagueMean={leagueMean}
                  nA={q.n_a}
                  nB={q.n_b}
                  flag={q.pts.flag}
                  percentile={q.pts.percentile}
                />
                <p className={styles.caption}>
                  {useShrunk
                    ? `Shrunk ${formatSigned(q.pts.shrunk)} pts (raw ${formatSigned(q.pts.raw)}, CI ${formatCi(q.pts.ci95)}; n = ${q.n_a}/${q.n_b}).`
                    : `Raw ${formatSigned(q.pts.raw)} pts (CI ${formatCi(q.pts.ci95)}; n = ${q.n_a}/${q.n_b}).`}{" "}
                  League mean {formatSigned(leagueMean)}.
                  {q.pts.flag
                    ? ` Flag: ${q.pts.flag.replace(/_/g, " ")}.`
                    : ""}
                </p>
              </div>
            );
          })}

          <GameStrip
            fields={data.game_fields}
            games={data.games}
            scope={scope}
          />
        </>
      )}
    </section>
  );
}

function PlayerCmpChart({
  label,
  value,
  ci,
  leagueMean,
  nA,
  nB,
  flag,
  percentile,
}: {
  label: string;
  value: number;
  ci: [number, number];
  leagueMean: number;
  nA: number;
  nB: number;
  flag: string | null;
  percentile: number;
}) {
  const padL = 56;
  const padR = 56;
  const width = 360;
  const height = 56;
  const plotW = width - padL - padR;
  let min = Math.min(0, ci[0], value, leagueMean);
  let max = Math.max(0, ci[1], value, leagueMean);
  const span = Math.max(max - min, 0.5);
  const pad = span * 0.12;
  min -= pad;
  max += pad;
  const xOf = (v: number) => padL + ((v - min) / (max - min)) * plotW;
  const watch = isWatchFlag(flag);

  return (
    <div className={styles.chart}>
      <svg viewBox={`0 0 ${width} ${height}`} className={styles.svg} role="img">
        <line
          x1={xOf(0)}
          x2={xOf(0)}
          y1={8}
          y2={height - 14}
          className={styles.zero}
        />
        <line
          x1={xOf(leagueMean)}
          x2={xOf(leagueMean)}
          y1={8}
          y2={height - 14}
          className={styles.league}
        />
        <line
          x1={xOf(ci[0])}
          x2={xOf(ci[1])}
          y1={height / 2 - 4}
          y2={height / 2 - 4}
          className={watch ? styles.ciHot : styles.ci}
        />
        <circle
          cx={xOf(value)}
          cy={height / 2 - 4}
          r={6}
          className={watch ? styles.dotHot : styles.dot}
        />
        <text
          x={padL - 6}
          y={height / 2}
          textAnchor="end"
          className={styles.lab}
        >
          {label}
        </text>
        <text
          x={padL + plotW + 6}
          y={height / 2}
          textAnchor="start"
          className={styles.val}
        >
          {formatSigned(value)}
        </text>
        <text
          x={xOf(0)}
          y={height - 2}
          textAnchor="middle"
          className={styles.tick}
        >
          0
        </text>
      </svg>
      <p className={styles.metaLine}>
        vs league · pctile {percentile.toFixed(0)} · games {nA}/{nB}
      </p>
    </div>
  );
}

function GameStrip({
  fields,
  games,
  scope,
}: {
  fields: string[];
  games: (string | number | null)[][];
  scope: TimespanKey;
}) {
  const rows = useMemo(() => {
    return games
      .map((g) => gameRow(fields, g))
      .filter((g) => gameInTimespan(String(g.season ?? ""), scope));
  }, [fields, games, scope]);

  if (rows.length === 0) {
    return <p className={styles.muted}>No game dots for this scope.</p>;
  }

  const groups: {
    key: string;
    label: string;
    filter: (g: Record<string, string | number | null>) => boolean;
  }[] = [
    { key: "home", label: "Home", filter: (g) => g.venue === "H" },
    { key: "away", label: "Away", filter: (g) => g.venue === "A" },
    { key: "2nd", label: "B2B 2nd", filter: (g) => g.rest === "2nd" },
    { key: "1st", label: "B2B 1st", filter: (g) => g.rest === "1st" },
    { key: "rested", label: "Rested", filter: (g) => g.rest === "rested" },
  ];

  const maxPts = Math.max(
    30,
    ...rows.map((g) => (typeof g.pts === "number" ? g.pts : 0)),
  );

  return (
    <div className={styles.strip}>
      <h4 className={styles.h4}>Game dots</h4>
      <p className={styles.muted}>One dot per game · height = points</p>
      {groups.map((grp) => {
        const list = rows.filter(grp.filter);
        if (list.length === 0) return null;
        const w = Math.max(200, list.length * 8 + 40);
        const h = 64;
        return (
          <div key={grp.key} className={styles.stripGroup}>
            <span className={styles.stripLab}>
              {grp.label} ({list.length})
            </span>
            <div className={styles.stripScroll}>
              <svg
                viewBox={`0 0 ${w} ${h}`}
                width={w}
                height={h}
                className={styles.stripSvg}
              >
                <line
                  x1={8}
                  x2={w - 8}
                  y1={h - 10}
                  y2={h - 10}
                  className={styles.stripBase}
                />
                {list.map((g, i) => {
                  const pts = typeof g.pts === "number" ? g.pts : 0;
                  const x =
                    16 + i * ((w - 32) / Math.max(list.length - 1, 1));
                  const y = h - 10 - (pts / maxPts) * (h - 22);
                  return (
                    <circle
                      key={i}
                      cx={x}
                      cy={y}
                      r={3.2}
                      className={styles.stripDot}
                    >
                      <title>
                        {String(g.date)} {String(g.opp)} · {pts} pts
                      </title>
                    </circle>
                  );
                })}
              </svg>
            </div>
          </div>
        );
      })}
    </div>
  );
}
