"use client";

import { useState, type ReactNode } from "react";
import { formatSigned } from "@/lib/insightsTypes";
import type {
  DeepCell,
  DeepInsightsData,
  Eff,
  FlagRow,
  ModLevel,
  Outcome,
} from "@/lib/deepInsightsTypes";
import {
  SEGMENT_SWITCH_LABEL,
  TIMESPAN_SWITCH_LABEL,
  type SegmentKey,
  type TimespanKey,
} from "@/lib/timespans";
import { EffectBars, type BarRow } from "./EffectBars";
import styles from "./DeepInsights.module.css";

type Sel = { data: DeepInsightsData; timespan: TimespanKey; segment: SegmentKey };

/* ---------- formatting ---------- */

const f2 = (n: number) => formatSigned(n, 2);
const pp = (n: number, d = 1) => formatSigned(n * 100, d);
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const fmtN = (n: number) => n.toLocaleString("en-US");
const tickFmt = (t: number) => (t === 0 ? "0" : `${t > 0 ? "" : "−"}${Math.abs(t)}`);
const orTick = (t: number) => `${t}`;
const pText = (p: number | null) =>
  p == null ? "n/a" : p < 0.001 ? "p < 0.001" : `p = ${p.toFixed(3)}`;

const MEASURE_LABEL: Record<Outcome, string> = {
  dev: "Points vs prior avg",
  big5: "Big night +5",
  big10: "Big night +10",
  x125: "×1.25 prior avg",
};
const MEASURE_PHRASE: Record<Outcome, string> = {
  dev: "points above his own prior average",
  big5: "chance of scoring at least 5 over his prior average",
  big10: "chance of scoring at least 10 over his prior average",
  x125: "chance of scoring at least 1.25× his prior average",
};

const SEGS: SegmentKey[] = ["all", "top100", "top50", "top25", "top10"];
const SEASONS: TimespanKey[] = ["2023_24", "2024_25", "2025_26", "2026_27"];

function cellOf(d: DeepInsightsData, ts: string, seg: string): DeepCell | undefined {
  return d.cells[ts]?.[seg];
}

/* ---------- shared pieces ---------- */

function Switch({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { key: string; label: string }[];
  value: string;
  onChange: (k: string) => void;
}) {
  return (
    <div className={styles.switch} role="tablist" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          role="tab"
          aria-selected={value === o.key}
          className={value === o.key ? styles.tabOn : styles.tab}
          onClick={() => onChange(o.key)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Thin({ cell, timespan, segment }: { cell: DeepCell | undefined; timespan: TimespanKey; segment: SegmentKey }) {
  const ts = TIMESPAN_SWITCH_LABEL[timespan];
  const seg = SEGMENT_SWITCH_LABEL[segment];
  return (
    <div className={styles.thin} role="status">
      <p className={styles.thinH}>{cell ? "Too few games to rank" : "Not enough games yet"}</p>
      <p className={styles.thinP}>
        {cell
          ? `${seg} in ${ts} has only ${cell.n_players} players (${fmtN(cell.n_games)} player-games). Cells under 30 players or 300 games are not ranked, because a handful of players would set the picture.`
          : `${ts} has no ${seg} cell yet: too few games so far.`}{" "}
        Try All, Top 100 or Top 50.
      </p>
    </div>
  );
}

function Provisional({ timespan, cell }: { timespan: TimespanKey; cell: DeepCell }) {
  if (timespan !== "2026_27") return null;
  return (
    <p className={styles.caveat}>
      2026-27 is provisional: only {fmtN(cell.n_games)} player-games so far, so
      the intervals are wide and several cells are blank.
    </p>
  );
}

function Header({ id, title, children }: { id: string; title: string; children?: ReactNode }) {
  return (
    <>
      <h2 id={id} className={styles.h2}>
        {title}
      </h2>
      {children}
    </>
  );
}

/** One bar row for a tier / venue / b2b contrast. */
function effRow(
  key: string,
  label: string,
  sub: string | undefined,
  e: Eff | undefined,
  o: Outcome,
  opts?: { mark?: boolean; showN?: boolean; thinReason?: string },
): BarRow {
  const base = { key, label, sub, mark: opts?.mark };
  if (opts?.thinReason) return { ...base, est: null, lo: null, hi: null, blank: opts.thinReason };
  if (!e) return { ...base, est: null, lo: null, hi: null, blank: "not available" };
  if (e.sup || e.d == null || e.lo == null || e.hi == null) {
    return { ...base, est: null, lo: null, hi: null, blank: "fewer than 30 games" };
  }
  const isDev = o === "dev";
  const sc = isDev ? 1 : 100;
  const t = (n: number) => (isDev ? f2(n) : pp(n / 100));
  let extra: string | undefined;
  if (opts?.showN !== false) {
    const rate =
      !isDev && e.l != null && e.r != null
        ? `${pct(e.l)} vs ${pct(e.r)}${e.rr != null ? ` · rate ×${e.rr.toFixed(2)}` : ""} · `
        : "";
    extra = `${rate}${fmtN(e.nl)} games vs ${fmtN(e.nr)}`;
  }
  return {
    ...base,
    est: e.d * sc,
    lo: e.lo * sc,
    hi: e.hi * sc,
    text: isDev ? f2(e.d) : `${pp(e.d)}`,
    ciText: `${t(e.lo * sc)} to ${t(e.hi * sc)}`,
    extra,
  };
}

const axisUnit = (o: Outcome) => (o === "dev" ? "PTS" : "percentage points");

/* ---------- 1. Matchups ---------- */

const NESTED: [string, string, string][] = [
  ["worst5", "Worst 5", "vs other 25"],
  ["worst10", "Worst 10", "vs other 20"],
  ["best10", "Best 10", "vs other 20"],
  ["best5", "Best 5", "vs other 25"],
];

export function MatchupsSection({ data, timespan, segment }: Sel) {
  const [measure, setMeasure] = useState<Outcome>("dev");
  const cell = cellOf(data, timespan, segment);
  const ok = cell && !cell.thin && cell.eff;
  const label = SEGMENT_SWITCH_LABEL[segment];

  const rows: BarRow[] = ok
    ? NESTED.map(([k, l, s]) => effRow(k, l, s, cell.eff?.[`opp_defence_nested:${k}`]?.[measure], measure))
    : [];

  const segRows = (key: string): BarRow[] =>
    SEGS.map((s) => {
      const c = cellOf(data, timespan, s);
      const lab = SEGMENT_SWITCH_LABEL[s];
      const mark = s === segment;
      if (!c || c.thin) return effRow(`${key}-${s}`, lab, undefined, undefined, measure, { mark, thinReason: "too few games to rank" });
      return effRow(`${key}-${s}`, lab, undefined, c.eff?.[`opp_defence_nested:${key}`]?.[measure], measure, { mark, showN: false });
    });

  // season stability (dev, worst 5 vs the other 25), selected segment and Top 50
  const seasonSegs: SegmentKey[] = segment === "top50" ? ["top50"] : [segment, "top50"];
  const seasonRows = (s: SegmentKey): BarRow[] =>
    SEASONS.flatMap((ts) => {
      const c = cellOf(data, ts, s);
      if (!c && ts === "2026_27") return [];
      const lab = TIMESPAN_SWITCH_LABEL[ts];
      if (!c || c.thin) return [effRow(`${s}-${ts}`, lab, undefined, undefined, measure, { thinReason: "too few games" })];
      return [effRow(`${s}-${ts}`, lab, undefined, c.eff?.["opp_defence_nested:worst5"]?.[measure], measure, { showN: false })];
    });

  const top50 = (ts: TimespanKey) => cellOf(data, ts, "top50")?.eff?.["opp_defence_nested:worst5"]?.dev;
  const s1 = top50("2023_24");
  const s2 = top50("2024_25");
  const s3 = top50("2025_26");
  const haveSeasons = !!(s1?.d != null && s2?.d != null && s3?.d != null && !s1.sup && !s2.sup && !s3.sup);
  const leansFirst = haveSeasons && s1!.d! > s2!.d! && s1!.d! > s3!.d!;
  const lastFlat = haveSeasons && s3!.lo! <= 0 && s3!.hi! >= 0;

  // player-specific big-night effect
  const fl = data.flags[timespan] ?? [];
  const flag = (c: string) => fl.find((r) => r.condition === c && r.outcome === "big10");
  const f5 = flag("worst5");
  const f10 = flag("worst10");
  const noOne = !!f5 && !!f10 && f5.n_above_league === 0 && f10.n_above_league === 0 && f5.n_below_league === 0 && f10.n_below_league === 0;

  const w5 = ok ? cell.eff?.["opp_defence_nested:worst5"]?.[measure] : undefined;
  const b10 = ok ? cell.eff?.["opp_defence_nested:best10"]?.[measure] : undefined;
  const star = cellOf(data, timespan, "top50")?.tail?.big10?.terms.def_worst10;
  const readTxt = (e: Eff | undefined) =>
    !e || e.sup || e.d == null || e.lo == null || e.hi == null
      ? null
      : measure === "dev"
        ? `${f2(e.d)} PTS (${f2(e.lo)} to ${f2(e.hi)})`
        : `${pp(e.d)} pp (${pp(e.lo)} to ${pp(e.hi)})`;

  return (
    <section className={styles.section} aria-labelledby="mu-h">
      <Header id="mu-h" title="Matchups: weak and strong defences">
        <p className={styles.story}>
          Do players score more against poor defences and less against good
          ones? Each bar compares games against a group of defences with games
          against everyone else, measured as <em>{MEASURE_PHRASE[measure]}</em>.
          Defences are ranked on their season-to-date rating before tip-off, so
          it is all known pregame. Associations only, not causes.
        </p>
      </Header>
      <Switch
        label="Measure"
        value={measure}
        onChange={(k) => setMeasure(k as Outcome)}
        options={(["dev", "big10", "x125"] as Outcome[]).map((k) => ({ key: k, label: MEASURE_LABEL[k] }))}
      />
      <p className={styles.cellNote}>
        {TIMESPAN_SWITCH_LABEL[timespan]} · {label}
        {cell ? ` · ${cell.n_players} players, ${fmtN(cell.n_games)} player-games` : ""}
      </p>

      {!ok ? (
        <Thin cell={cell} timespan={timespan} segment={segment} />
      ) : (
        <>
          <EffectBars
            rows={rows}
            tickFmt={tickFmt}
            label={`Defence tier contrasts, ${axisUnit(measure)}`}
          />
          <p className={styles.axisNote}>
            {axisUnit(measure)} · whiskers = 95% CI · grey = CI includes 0 · each
            group compared with all other defences
          </p>
          <p className={styles.read}>
            <strong>
              {readTxt(w5)
                ? `Against the 5 worst defences: ${readTxt(w5)}.`
                : "The 5-worst-defences contrast has too few games here."}
            </strong>{" "}
            {readTxt(b10)
              ? `Against the 10 best: ${readTxt(b10)}. `
              : ""}
            Grey bars: the interval includes 0, so no clear difference.
          </p>
          <Provisional timespan={timespan} cell={cell} />
        </>
      )}

      <h3 className={styles.h3}>By PPG segment</h3>
      <p className={styles.note}>
        Same contrasts for each segment ({TIMESPAN_SWITCH_LABEL[timespan]}).
        Your selected segment is marked.
      </p>
      <p className={styles.subH}>Worst 5 defences vs the other 25</p>
      <EffectBars rows={segRows("worst5")} tickFmt={tickFmt} label="Worst 5 defences by segment" />
      <p className={styles.subH}>Best 10 defences vs the other 20</p>
      <EffectBars rows={segRows("best10")} tickFmt={tickFmt} label="Best 10 defences by segment" />

      <h3 className={styles.h3}>Is it stable season to season?</h3>
      <p className={styles.note}>
        Worst 5 defences vs the other 25, {MEASURE_LABEL[measure].toLowerCase()},
        each season on its own.
      </p>
      {seasonSegs.map((s) => (
        <div key={s}>
          <p className={styles.subH}>{SEGMENT_SWITCH_LABEL[s]}</p>
          {s === segment && (!cellOf(data, "2025_26", s) || cellOf(data, "2025_26", s)?.thin) ? (
            <Thin cell={cellOf(data, "2025_26", s)} timespan="2025_26" segment={s} />
          ) : (
            <EffectBars rows={seasonRows(s)} tickFmt={tickFmt} label={`${SEGMENT_SWITCH_LABEL[s]} by season`} />
          )}
        </div>
      ))}
      {haveSeasons ? (
        <p className={styles.caveat}>
          <strong>Caveat.</strong> For the Top 50 the gain against the 5 worst
          defences was {f2(s1!.d!)} PTS in 2023-24, {f2(s2!.d!)} in 2024-25 and{" "}
          {f2(s3!.d!)} in 2025-26
          {lastFlat ? " (that last interval includes 0)" : ""}.
          {leansFirst
            ? " The pooled star number leans on 2023-24, so don't read it as a steady edge."
            : " The seasons do not agree closely, so don't read the pooled number as a steady edge."}
        </p>
      ) : null}

      <div className={styles.callout}>
        <p>
          <strong>Does any single player have a big-night effect of his own?</strong>{" "}
          {noOne ? (
            <>
              No. For big nights against the weakest defences the spread
              between players is estimated at {f5!.tau != null ? f5!.tau.toFixed(2) : "n/a"} and{" "}
              {f10!.tau != null ? f10!.tau.toFixed(2) : "n/a"} (worst 5 and worst 10), i.e. nothing beyond
              noise, and no player&apos;s own estimate is credibly different from
              the shared league effect. What the data show is one
              shared league-wide lift, not player-specific ones.
            </>
          ) : f5 && f10 ? (
            <>
              {f5.n_above_league + f10.n_above_league + f5.n_below_league + f10.n_below_league} player
              estimates differ from the shared league effect in this window
              (worst 5 / worst 10), against about {f5.expected_watch_by_chance.toFixed(1)} watch flags
              expected by chance. Treat any single player as unproven.
            </>
          ) : (
            "No per-player summary for this window."
          )}
        </p>
        {star && star.or != null && star.lo != null && star.hi != null ? (
          <p>
            Top 50, other conditions held fixed: the odds of a +10 night against
            the 10 worst defences are {star.or.toFixed(2)} times the odds
            against the middle ({star.lo.toFixed(2)} to {star.hi.toFixed(2)})
            {star.lo <= 1 && star.hi >= 1
              ? ", which is not clearly different from 1. See Big-night odds below."
              : ". See Big-night odds below."}
          </p>
        ) : null}
      </div>
    </section>
  );
}

/* ---------- 2. Opponent tiers ---------- */

const DEF_LADDER: [string, string, string, string?][] = [
  ["worst5", "Worst 5", "ranks 26–30"],
  ["worst6_10", "Worst 6–10", "ranks 21–25"],
  ["__ref", "Middle", "ranks 11–20"],
  ["best6_10", "Best 6–10", "ranks 6–10"],
  ["best5", "Best 5", "ranks 1–5"],
];
const PACE_LADDER: [string, string, string, string?][] = [
  ["fastest5", "Fastest 5", "ranks 1–5"],
  ["fast6_10", "Fast 6–10", "ranks 6–10"],
  ["__ref", "Middle", "ranks 11–20"],
  ["slow6_10", "Slow 6–10", "ranks 21–25"],
  ["slowest5", "Slowest 5", "ranks 26–30"],
];

export function OpponentTiersSection({ data, timespan, segment }: Sel) {
  const [dim, setDim] = useState<"def" | "pace">("def");
  const [measure, setMeasure] = useState<Outcome>("dev");
  const cell = cellOf(data, timespan, segment);
  const ok = cell && !cell.thin && cell.eff;
  const prefix = dim === "def" ? "opp_defence_tier" : "opp_pace_tier";
  const ladder = dim === "def" ? DEF_LADDER : PACE_LADDER;
  const rows: BarRow[] = ok
    ? ladder.map(([k, l, s]) =>
        k === "__ref"
          ? { key: k, label: l, sub: s, est: null, lo: null, hi: null, ref: true, text: "reference" }
          : effRow(k, l, s, cell.eff?.[`${prefix}:${k}`]?.[measure], measure),
      )
    : [];
  const fast = ok ? cell.eff?.["opp_pace_tier:fastest5"]?.[measure] : undefined;
  const slow = ok ? cell.eff?.["opp_pace_tier:slowest5"]?.[measure] : undefined;
  const t = (e: Eff | undefined) =>
    !e || e.sup || e.d == null || e.lo == null || e.hi == null
      ? null
      : measure === "dev"
        ? `${f2(e.d)} PTS (${f2(e.lo)} to ${f2(e.hi)})`
        : `${pp(e.d)} pp (${pp(e.lo)} to ${pp(e.hi)})`;

  return (
    <section className={styles.section} aria-labelledby="ot-h">
      <Header id="ot-h" title="Opponent tiers">
        <p className={styles.story}>
          The five-step ladder: bad defences and fast teams at one end, good
          defences and slow teams at the other, each step compared with the
          middle of the league. Bars are contrasts with the middle, not levels.
        </p>
      </Header>
      <Switch
        label="Ladder"
        value={dim}
        onChange={(k) => setDim(k as "def" | "pace")}
        options={[
          { key: "def", label: "Defence rank" },
          { key: "pace", label: "Opponent pace" },
        ]}
      />
      <Switch
        label="Measure"
        value={measure}
        onChange={(k) => setMeasure(k as Outcome)}
        options={(["dev", "big10", "x125"] as Outcome[]).map((k) => ({ key: k, label: MEASURE_LABEL[k] }))}
      />
      <p className={styles.cellNote}>
        {TIMESPAN_SWITCH_LABEL[timespan]} · {SEGMENT_SWITCH_LABEL[segment]}
        {cell ? ` · ${cell.n_players} players, ${fmtN(cell.n_games)} player-games` : ""}
      </p>
      {!ok ? (
        <Thin cell={cell} timespan={timespan} segment={segment} />
      ) : (
        <>
          <EffectBars rows={rows} tickFmt={tickFmt} label={`${dim === "def" ? "Defence" : "Pace"} tiers, ${axisUnit(measure)}`} />
          <p className={styles.axisNote}>
            {axisUnit(measure)} vs the middle ten teams · whiskers = 95% CI ·
            grey = CI includes 0 · a contrast with fewer than 30 games on either
            side is blanked
          </p>
          {t(fast) && t(slow) ? (
            <p className={styles.read}>
              <strong>Pace tiers, same cell.</strong> Against
              the 5 fastest teams: {t(fast)}; against the 5 slowest: {t(slow)}.
              Grey steps have an interval that includes 0, so they are not
              clearly different from the middle.
            </p>
          ) : null}
          <p className={styles.note}>
            Why contrasts: the prior average runs a little high or low for
            different kinds of players, so the level of any one tier is partly
            an artefact. The gap between tiers is what carries information.
          </p>
          <Provisional timespan={timespan} cell={cell} />
        </>
      )}
    </section>
  );
}

/* ---------- 3. Big-night odds ---------- */

const BN_DEF: [string, string, string, boolean?][] = [
  ["def_worst5", "Worst 5", "ranks 26–30"],
  ["def_worst6_10", "Worst 6–10", "ranks 21–25"],
  ["def_worst10", "Worst 10", "both groups"],
  ["__ref", "Middle 10", "ranks 11–20"],
  ["def_best6_10", "Best 6–10", "ranks 6–10"],
  ["def_best5", "Best 5", "ranks 1–5"],
  ["def_best10", "Best 10", "both groups"],
];
const BN_PACE: [string, string, string][] = [
  ["pace_fastest5", "Fastest 5", "ranks 1–5"],
  ["pace_fast6_10", "Fast 6–10", "ranks 6–10"],
  ["pace_fast10", "Fastest 10", "both groups"],
  ["__ref", "Middle 10", "ranks 11–20"],
  ["pace_slow6_10", "Slow 6–10", "ranks 21–25"],
  ["pace_slowest5", "Slowest 5", "ranks 26–30"],
  ["pace_slow10", "Slowest 10", "both groups"],
];
const BN_PHRASE: Record<"big5" | "big10" | "x125", string> = {
  big5: "scoring 5+ over his average",
  big10: "scoring 10+ over his average",
  x125: "scoring 1.25× his average or more",
};
const BN_LABEL: Record<"big5" | "big10" | "x125", string> = {
  big5: "+5 over average",
  big10: "+10 over average",
  x125: "×1.25 average",
};

export function BigNightSection({ data, timespan, segment }: Sel) {
  const [out, setOut] = useState<"big5" | "big10" | "x125">("big10");
  const [dim, setDim] = useState<"def" | "pace">("def");
  const cell = cellOf(data, timespan, segment);
  const ok = cell && !cell.thin;
  const tail = ok ? cell.tail?.[out] : undefined;
  const perf = ok ? cell.perf?.[out] : undefined;
  const terms = dim === "def" ? BN_DEF : BN_PACE;

  const rows: BarRow[] = tail
    ? terms.map(([k, l, s]) => {
        if (k === "__ref") {
          return { key: k, label: l, sub: s, est: null, lo: null, hi: null, ref: true, text: "OR = 1" };
        }
        const x = tail.terms[k];
        if (!x || x.or == null || x.lo == null || x.hi == null) {
          return { key: k, label: l, sub: s, est: null, lo: null, hi: null, blank: "not fitted" };
        }
        return {
          key: k,
          label: l,
          sub: s,
          est: x.or,
          lo: x.lo,
          hi: x.hi,
          text: x.or.toFixed(2),
          ciText: `${x.lo.toFixed(2)} to ${x.hi.toFixed(2)}`,
          extra:
            x.pp != null && x.pplo != null && x.pphi != null
              ? `${pp(x.pp)} pp in the chance of ${BN_PHRASE[out]} (${pp(x.pplo)} to ${pp(x.pphi)})`
              : undefined,
        };
      })
    : [];

  const worst10 = tail?.terms.def_worst10;
  const crossesOne = worst10 && worst10.lo != null && worst10.hi != null && worst10.lo <= 1 && worst10.hi >= 1;
  const raw5 = ok ? cell.eff?.["opp_defence_nested:worst5"]?.[out] : undefined;
  const rawBest10 = ok ? cell.eff?.["opp_defence_nested:best10"]?.[out] : undefined;

  const llCross = perf && perf.llo != null && perf.lhi != null && perf.llo <= 0 && perf.lhi >= 0;

  return (
    <section className={styles.section} aria-labelledby="bn-h">
      <Header id="bn-h" title="Big-night odds">
        <p className={styles.story}>
          How often does a player score at least 10 over his own prior average
          (or 5 over, or 1.25× it)? Odds ratio = how the odds of that night
          change against each group of teams, compared with the ten
          middle-of-the-league teams, holding fixed the player&apos;s prior
          average, usage, minutes, role, position and how far into the season
          it is (home, back-to-back and the other tier terms sit in the same
          model). 1 means no change.
        </p>
      </Header>
      <Switch
        label="Big-night definition"
        value={out}
        onChange={(k) => setOut(k as "big5" | "big10" | "x125")}
        options={(["big10", "big5", "x125"] as const).map((k) => ({ key: k, label: BN_LABEL[k] }))}
      />
      <Switch
        label="Ladder"
        value={dim}
        onChange={(k) => setDim(k as "def" | "pace")}
        options={[
          { key: "def", label: "Defence rank" },
          { key: "pace", label: "Opponent pace" },
        ]}
      />
      <p className={styles.cellNote}>
        {TIMESPAN_SWITCH_LABEL[timespan]} · {SEGMENT_SWITCH_LABEL[segment]}
        {cell ? ` · ${cell.n_players} players, ${fmtN(cell.n_games)} player-games` : ""}
        {tail?.base != null ? ` · base rate ${pct(tail.base)}` : ""}
      </p>

      {!ok ? (
        <Thin cell={cell} timespan={timespan} segment={segment} />
      ) : !tail ? (
        <div className={styles.thin} role="status">
          <p className={styles.thinH}>Not fitted</p>
          <p className={styles.thinP}>
            Not enough big nights in {TIMESPAN_SWITCH_LABEL[timespan]} {SEGMENT_SWITCH_LABEL[segment]} to
            fit the odds model for this definition. Try a longer timespan or
            a wider segment.
          </p>
        </div>
      ) : (
        <>
          <EffectBars rows={rows} log tickFmt={orTick} label={`Odds ratios, ${BN_LABEL[out]}`} />
          <p className={styles.axisNote}>
            Odds ratio (log scale) vs the middle ten · whiskers = 95% CI · grey
            = CI includes 1 · adjusted for the controls above
          </p>
          <p className={styles.read}>
            {raw5 && raw5.l != null && raw5.r != null ? (
              <>
                <strong>Raw rates:</strong> {BN_PHRASE[out]} happened in{" "}
                {pct(raw5.l)} of games against the 5 worst defences and {pct(raw5.r)} against the other 25
                {rawBest10 && rawBest10.l != null ? `, and in ${pct(rawBest10.l)} against the 10 best` : ""}.{" "}
              </>
            ) : null}
            {worst10 && crossesOne ? (
              <>
                Once the other conditions are held fixed, the odds against the
                10 worst defences are not clearly different from the middle in
                this cell (OR {worst10.or!.toFixed(2)}, interval includes 1).
              </>
            ) : worst10 && worst10.or != null ? (
              <>
                Against the 10 worst defences the adjusted odds ratio is{" "}
                {worst10.or.toFixed(2)} (interval excludes 1): a small rise
                for this group.
              </>
            ) : null}
          </p>

          <div className={styles.callout}>
            <p>
              <strong>These odds are weak predictors.</strong>{" "}
              {perf && perf.auc != null ? (
                <>
                  On held-out games ({fmtN(perf.n_test)} in this cell) the
                  model&apos;s AUC for {BN_PHRASE[out]} is {perf.auc.toFixed(2)} (0.50 is a
                  coin flip).{" "}
                </>
              ) : null}
              Across all {data.auc.n} model fits in non-thin cells AUC runs from{" "}
              {data.auc.min.toFixed(2)} to {data.auc.max.toFixed(2)}
              {data.auc.pooled_n > 0
                ? `; in the 3-season pooled cells it is ${data.auc.pooled_min.toFixed(2)} to ${data.auc.pooled_max.toFixed(2)}`
                : ""}
              .
            </p>
            {perf && perf.train != null && perf.test != null && perf.slope != null ? (
              <p>
                <strong>The probabilities are poorly calibrated.</strong> The
                actual rate in the held-out window was {pct(perf.test)} against{" "}
                {pct(perf.train)} in training, and the calibration slope is{" "}
                {perf.slope.toFixed(2)} (1.00 would be well calibrated). Use the
                odds ratios to compare groups, not as forecasts of a night.
              </p>
            ) : null}
            {perf && perf.ll != null && perf.llo != null && perf.lhi != null ? (
              <p>
                Against simply using the base rate, log-loss{" "}
                {perf.ll >= 0 ? "improves" : "worsens"} by{" "}
                {Math.abs(perf.ll).toFixed(4)} (CI {formatSigned(perf.llo, 4)} to{" "}
                {formatSigned(perf.lhi, 4)})
                {llCross ? ": no clear gain." : "."}
              </p>
            ) : null}
          </div>
          <Provisional timespan={timespan} cell={cell} />
        </>
      )}
    </section>
  );
}

/* ---------- 4. Role and position ---------- */

const MOD_LABEL: Record<string, string> = {
  C: "Centers",
  F: "Forwards",
  G: "Guards",
  starter: "Starters",
  bench: "Bench",
};

export function RolePositionSection({
  data,
  timespan,
}: {
  data: DeepInsightsData;
  timespan: TimespanKey;
}) {
  const inter = data.interactions[timespan];
  const pos = inter?.position;
  const role = inter?.role;
  const mk = (
    mod: Partial<Record<"dev" | "big10" | "x125", Record<string, ModLevel>>> | undefined,
    o: "dev" | "x125",
    keys: string[],
  ): BarRow[] =>
    keys.map((k) => {
      const x = mod?.[o]?.[k];
      if (!x || x.e == null || x.lo == null || x.hi == null) {
        return { key: `${o}-${k}`, label: MOD_LABEL[k], est: null, lo: null, hi: null, blank: "not available" };
      }
      return {
        key: `${o}-${k}`,
        label: MOD_LABEL[k],
        sub: `${fmtN(x.n)} players`,
        est: x.e,
        lo: x.lo,
        hi: x.hi,
        text: o === "dev" ? f2(x.e) : x.e.toFixed(2),
        ciText: o === "dev" ? `${f2(x.lo)} to ${f2(x.hi)}` : `${x.lo.toFixed(2)} to ${x.hi.toFixed(2)}`,
      };
    });
  const devRows = [...mk(pos, "dev", ["C", "F", "G"]), ...mk(role, "dev", ["starter", "bench"])];
  const orRows = [...mk(pos, "x125", ["C", "F", "G"]), ...mk(role, "x125", ["starter", "bench"])];
  const pPos = pos?.dev?.C?.p ?? null;
  const pRole = role?.dev?.starter?.p ?? null;
  const posX = pos?.x125?.C?.p ?? null;
  const cs = pos?.dev?.C;
  const gs = pos?.dev?.G;
  const st = role?.dev?.starter;
  const be = role?.dev?.bench;
  const hasData = !!pos && !!role;

  return (
    <section className={styles.section} aria-labelledby="rp-h">
      <Header id="rp-h" title="Role and position">
        <p className={styles.story}>
          Does the lift against the 10 weakest defences differ by who is
          playing? Bars show points above the player&apos;s own prior average
          against the 10 worst defences vs the other defences, split by
          position and by role. This uses all players, so the PPG segment
          selector does not change it. Starter = started at least half of his
          prior games this season (tonight&apos;s lineup isn&apos;t known
          pregame).
        </p>
      </Header>
      {!hasData ? (
        <p className={styles.note}>No position or role split for this timespan.</p>
      ) : (
        <>
          <p className={styles.subH}>Points above prior average</p>
          <EffectBars rows={devRows} tickFmt={tickFmt} label="Lift vs 10 worst defences by position and role, PTS" />
          <p className={styles.axisNote}>
            PTS · whiskers = 95% CI · grey = CI includes 0 · {TIMESPAN_SWITCH_LABEL[timespan]}
          </p>
          <p className={styles.subH}>Odds of scoring ×1.25 his average</p>
          <EffectBars rows={orRows} log tickFmt={orTick} label="Odds ratio vs 10 worst defences by position and role" />
          <p className={styles.axisNote}>Odds ratio (log scale) · 1 = no change · whiskers = 95% CI</p>
          <p className={styles.read}>
            {cs?.e != null && gs?.e != null ? (
              <>
                <strong>
                  Centers: {f2(cs.e)} PTS vs guards: {f2(gs.e)}.
                </strong>{" "}
                The position gap {pPos != null && pPos < 0.05 ? "is statistically clear" : "is not statistically clear"} ({pText(pPos)}
                {posX != null ? `; for the ×1.25 odds ${pText(posX)}` : ""}).{" "}
              </>
            ) : null}
            {st?.e != null && be?.e != null ? (
              <>
                Starters: {f2(st.e)} PTS vs bench: {f2(be.e)}; the role gap{" "}
                {pRole != null && pRole < 0.05 ? "is statistically clear" : "is not statistically clear"} ({pText(pRole)}).
              </>
            ) : null}
          </p>
          <p className={styles.note}>
            These are associations after adjusting for the usual controls, not
            reasons. A player&apos;s minutes and role go together, so the two
            splits overlap.
          </p>
          {timespan === "2026_27" ? (
            <p className={styles.caveat}>2026-27 is provisional: very few games so far, so these intervals are wide.</p>
          ) : null}
        </>
      )}
    </section>
  );
}

/* ---------- 5a. Big-night and spread lines for Home / B2B ---------- */

const LINE_KIND = {
  home: { eff: "venue:home", sd: "home", on: "at home", off: "away", spread: "at home" },
  b2b2: { eff: "b2b_state:2nd", sd: "b2b_2nd", on: "on the second night", off: "rested", spread: "on the second night of a back-to-back" },
  b2b1: { eff: "b2b_state:1st", sd: "b2b_1st", on: "on the first night", off: "rested", spread: "on the first night of a back-to-back" },
} as const;

export function BigNightLines({
  data,
  timespan,
  segment,
  kind,
}: Sel & { kind: keyof typeof LINE_KIND }) {
  const cell = cellOf(data, timespan, segment);
  if (!cell || cell.thin || !cell.eff) return null;
  const k = LINE_KIND[kind];
  const eff = cell.eff[k.eff];
  const sd = cell.sd?.[k.sd];
  const rest3 = kind === "b2b2" ? cell.eff["rest_days:r3plus"]?.dev : undefined;
  const line = (o: "big10" | "x125", name: string) => {
    const e = eff?.[o];
    if (!e || e.sup || e.d == null || e.lo == null || e.hi == null || e.l == null || e.r == null) return null;
    const verdict = e.lo <= 0 && e.hi >= 0 ? "no clear difference" : e.d > 0 ? "higher" : "lower";
    return (
      <li key={o}>
        {name}: {pct(e.l)} {k.on} vs {pct(e.r)} {k.off} ({pp(e.d)} pp, {pp(e.lo)} to {pp(e.hi)}) · {verdict}
      </li>
    );
  };
  const l1 = line("big10", "Scores +10 over his average");
  const l2 = line("x125", "Scores ×1.25 his average");
  const sdVerdict =
    sd && sd.r != null && sd.lo != null && sd.hi != null
      ? sd.lo <= 1 && sd.hi >= 1
        ? "no clear change in spread"
        : sd.r > 1
          ? "more spread out"
          : "less spread out"
      : null;
  if (!l1 && !l2 && !sd && !rest3) return null;
  return (
    <div className={styles.lines}>
      {l1 || l2 ? (
        <>
          <p className={styles.linesH}>Big nights ({SEGMENT_SWITCH_LABEL[segment]})</p>
          <ul className={styles.linesList}>
            {l1}
            {l2}
          </ul>
        </>
      ) : null}
      {sd && sd.r != null && sd.lo != null && sd.hi != null ? (
        <>
          <p className={styles.linesH}>Spread</p>
          <ul className={styles.linesList}>
            <li>
              Game-to-game swing (SD of points vs prior average) {k.spread} is{" "}
              {sd.r.toFixed(2)}× the swing {k.off} ({sd.lo.toFixed(2)} to {sd.hi.toFixed(2)}) · {sdVerdict}
            </li>
          </ul>
        </>
      ) : null}
      {rest3 && !rest3.sup && rest3.d != null && rest3.lo != null && rest3.hi != null ? (
        <>
          <p className={styles.linesH}>Longer rest</p>
          <ul className={styles.linesList}>
            <li>
              With 3+ days off: {f2(rest3.d)} PTS vs prior average, compared
              with one day off ({f2(rest3.lo)} to {f2(rest3.hi)})
              {rest3.lo <= 0 && rest3.hi >= 0 ? " · no clear difference" : rest3.d < 0 ? " · slightly lower than usual" : " · higher"}
            </li>
          </ul>
        </>
      ) : null}
    </div>
  );
}

/* ---------- 5b. Player flags vs chance ---------- */

const FLAG_CONDS: [string, string][] = [
  ["home_vs_away", "Home vs away"],
  ["b2b_2nd_vs_rested", "B2B 2nd night"],
  ["worst5", "Worst-5 defences"],
  ["worst10", "Worst-10 defences"],
];

export function PlayerFlagsVsChance({
  data,
  timespan,
}: {
  data: DeepInsightsData;
  timespan: TimespanKey;
}) {
  const [out, setOut] = useState<"dev" | "big10" | "x125">("big10");
  const rows: (FlagRow | undefined)[] = FLAG_CONDS.map(([c]) =>
    (data.flags[timespan] ?? []).find((r) => r.condition === c && r.outcome === out),
  );
  const have = rows.filter((r): r is FlagRow => !!r);
  const anyUp = have.some((r) => r.n_flag_watch_z25 > r.expected_watch_by_chance);
  return (
    <section className={styles.sectionLite} aria-labelledby="pf-h">
      <h3 id="pf-h" className={styles.h3}>
        Player flags vs chance
      </h3>
      <p className={styles.note}>
        Every flag count next to the count you would get from pure noise.{" "}
        <em>Watch</em> = a player&apos;s gap is at least 2.5 standard errors
        out; <em>strong</em> = it survives a correction for testing hundreds of
        players. {TIMESPAN_SWITCH_LABEL[timespan]}.
      </p>
      <Switch
        label="Outcome"
        value={out}
        onChange={(k) => setOut(k as "dev" | "big10" | "x125")}
        options={[
          { key: "dev", label: "Points" },
          { key: "big10", label: "Big night +10" },
          { key: "x125", label: "×1.25 avg" },
        ]}
      />
      {have.length === 0 ? (
        <p className={styles.note}>No flag summary for this timespan.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Test</th>
                <th scope="col">Players</th>
                <th scope="col">Watch</th>
                <th scope="col">By chance</th>
                <th scope="col">Strong</th>
              </tr>
            </thead>
            <tbody>
              {FLAG_CONDS.map(([c, l], i) => {
                const r = rows[i];
                return (
                  <tr key={c}>
                    <th scope="row">{l}</th>
                    {r ? (
                      <>
                        <td>{fmtN(r.n_players)}</td>
                        <td className={r.n_flag_watch_z25 > r.expected_watch_by_chance ? styles.hot : undefined}>
                          {r.n_flag_watch_z25}
                        </td>
                        <td>{r.expected_watch_by_chance.toFixed(1)}</td>
                        <td>{r.n_flag_strong_q10}</td>
                      </>
                    ) : (
                      <td colSpan={4} className={styles.na}>
                        not enough games
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {have.length > 0 ? (
        <p className={styles.read}>
          <strong>
            {anyUp
              ? "Some watch counts are above chance, most are at or below it."
              : "Watch flags are at or below what chance alone gives."}
          </strong>{" "}
          Counts close to the chance column are what noise looks like, so treat any
          named player as a lead, not a finding.
          {have.some((r) => r.provisional) ? " 2026-27 is provisional." : ""}
        </p>
      ) : null}
    </section>
  );
}

/* ---------- 6. Points-drivers caveat ---------- */

function CurveChart({
  title,
  pts,
  endLabels,
}: {
  title: string;
  pts: [number, number | null, number | null, number | null][];
  endLabels: [string, string];
}) {
  const W = 300;
  const H = 120;
  const L = 30;
  const R = 8;
  const T = 8;
  const B = 24;
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
    [...valid]
      .reverse()
      .map((p) => `L${xs(p[0]).toFixed(1)},${ys(p[2]).toFixed(1)}`)
      .join(" ") +
    " Z";
  const line = valid.map((p, i) => `${i === 0 ? "M" : "L"}${xs(p[0]).toFixed(1)},${ys(p[1]).toFixed(1)}`).join(" ");
  const step = niceTick(y1 - y0);
  const yt: number[] = [];
  for (let v = Math.ceil(y0 / step) * step; v <= y1; v += step) yt.push(Math.abs(v) < step * 1e-6 ? 0 : Number(v.toPrecision(6)));
  return (
    <figure className={styles.curve}>
      <figcaption className={styles.curveCap}>{title}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className={styles.curveSvg} role="img" aria-label={title}>
        {yt.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={ys(v)} y2={ys(v)} className={v === 0 ? styles.cZero : styles.cGrid} />
            <text x={L - 4} y={ys(v) + 3} textAnchor="end" className={styles.cTick}>
              {tickFmt(v)}
            </text>
          </g>
        ))}
        <path d={band} className={styles.cBand} />
        <path d={line} className={styles.cLine} />
        <text x={L} y={H - 6} textAnchor="start" className={styles.cTick}>
          {endLabels[0]}
        </text>
        <text x={W - R} y={H - 6} textAnchor="end" className={styles.cTick}>
          {endLabels[1]}
        </text>
      </svg>
    </figure>
  );
}

function niceTick(span: number): number {
  const rough = span / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(Math.max(rough, 1e-6))));
  for (const m of [1, 2, 2.5, 5, 10]) if (rough <= m * mag) return m * mag;
  return 10 * mag;
}

export function NonLinearNote({ data, timespan, segment }: Sel) {
  const cell = cellOf(data, timespan, segment);
  const sp = cell && !cell.thin ? cell.spline : undefined;
  const def = sp?.def;
  const pace = sp?.pace;
  const at = (c: typeof def, x: number) => c?.pts.find((p) => p[0] === x)?.[1] ?? null;
  const first = def?.pts[0]?.[0];
  const last = def?.pts[def.pts.length - 1]?.[0];
  const mid = def ? def.pts[Math.floor(def.pts.length / 2)]?.[0] : undefined;
  return (
    <div className={styles.caveatBox}>
      <p>
        <strong>These effects are straight-line averages.</strong> For the top
        scorers, opponent defence and pace are not straight lines: a small bump
        over the few worst defences, about nothing through the middle, and a
        clear drop against the best ones (and similarly for pace).{" "}
        <strong>The pregame model above has no opponent inputs</strong>, so it
        says nothing about matchups; those are covered in Matchups and Opponent
        tiers above.
      </p>
      {def && first != null && last != null && mid != null ? (
        <>
          <div className={styles.curves}>
            <CurveChart
              title={`Points vs prior avg by opponent defence rank · ${SEGMENT_SWITCH_LABEL[segment]}`}
              pts={def.pts}
              endLabels={["worst defence", "best defence"]}
            />
            {pace ? (
              <CurveChart
                title={`… by opponent pace rank · ${SEGMENT_SWITCH_LABEL[segment]}`}
                pts={pace.pts}
                endLabels={["fastest", "slowest"]}
              />
            ) : null}
          </div>
          <p className={styles.note}>
            Fitted curve with 95% band, other measures held at their average.{" "}
            {SEGMENT_SWITCH_LABEL[segment]} defence curve: {f2(at(def, first) ?? 0)} PTS at the weakest defence,{" "}
            {f2(at(def, mid) ?? 0)} in the middle, {f2(at(def, last) ?? 0)} at the strongest. Test that it is not a
            straight line: {pText(def.p)}
            {def.p != null
              ? def.p < 0.05
                ? " (clearly curved)."
                : " (can't tell it from a straight line here)."
              : "."}{" "}
            Curved models did not beat the straight-line one on held-out games
            in most cells, so this is a reading of the shape, not a better
            forecast.
          </p>
        </>
      ) : (
        <p className={styles.note}>
          No curve is shown for {SEGMENT_SWITCH_LABEL[segment]} in{" "}
          {TIMESPAN_SWITCH_LABEL[timespan]} (too few games). Pick All, Top 100
          or Top 50 to see it.
        </p>
      )}
    </div>
  );
}
