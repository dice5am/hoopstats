import Link from "next/link";
import type { FlagRow, Outcome } from "@/lib/deepInsightsTypes";
import type { ChartRow, ChartSpec, CardModel, Ctx, Fix, SwitchSpec } from "@/lib/insights/types";
import { respondersFor, statusOf } from "@/lib/insights/responders";
import { CMP_LABELS, SEGMENT_ROW_LABELS, isStrongFlag, isWatchFlag, type CmpKey } from "@/lib/playerSplitsTypes";
import { TIMESPAN_SWITCH_LABEL } from "@/lib/timespans";
import {
  EARLY,
  deepCell,
  fixesFor,
  fmtN,
  isThinCell,
  scopeFor,
  sg,
  thinState,
  tsName,
  segName,
} from "@/lib/insights/util";
import { ASSOC, EARLY_NOTE, LG, WHISKER, baseModel, chartBody, pick } from "./common";
import { PLAYER_ROW_MIN_GAMES, PlayerSplitsBody, RankList } from "./bodies";
import { Tiles } from "./bnbodies";
import styles from "../insights.module.css";

const OUT3 = [
  { id: "big10", label: "Big night +10" },
  { id: "dev", label: "Points" },
  { id: "x125", label: "×1.25" },
];

/* ───────── flags vs chance ───────── */
const FLAG_CONDS: [string, string][] = [
  ["home_vs_away", "Home vs away"],
  ["b2b_2nd_vs_rested", "B2B 2nd night"],
  ["worst5", "Worst-5 defences"],
  ["worst10", "Worst-10 defences"],
];

export function flags(ctx: Ctx): CardModel {
  const { f, sel, data } = ctx;
  const m = baseModel(ctx, "flags");
  const out = pick(sel.m, [OUT3[1], OUT3[0], OUT3[2]]) as Outcome;
  const opts = [OUT3[1], OUT3[0], OUT3[2]];
  const switches: SwitchSpec[] = [{ key: "m", value: out, options: opts }];
  const fl = data.deep.flags[f.ts] ?? [];
  const rows = FLAG_CONDS.map(([c, l]) => ({ c, l, r: fl.find((x) => x.condition === c && x.outcome === out) }));
  const have = rows.filter((x): x is { c: string; l: string; r: FlagRow } => !!x.r);
  if (have.length === 0) {
    return { ...m, switches, scope: [tsName(f.ts)], state: { kind: "thin", title: EARLY(f.ts) ? "Not enough games yet" : "Too few games to read", text: `No flag summary exists for ${tsName(f.ts)}: too few players qualify. Nothing is drawn.`, fixes: fixesFor(f).filter((x) => !x.seg) } };
  }
  const watch = have.reduce((a, x) => a + x.r.n_flag_watch_z25, 0);
  const exp = have.reduce((a, x) => a + x.r.expected_watch_by_chance, 0);
  const strong = have.reduce((a, x) => a + x.r.n_flag_strong_q10, 0);
  const max = Math.max(...have.map((x) => Math.max(x.r.n_flag_watch_z25, x.r.expected_watch_by_chance)), 1);
  const verdict = strong > 0 ? "up" : "flat";
  const headline = `${watch} players are flagged across ${have.length} tests; chance alone would flag about ${Math.round(exp)}, and ${strong === 0 ? "none survive the correction" : `${strong} survive the correction`}.`;
  const body = (
    <div className={styles.chart}>
      {have.map(({ c, l, r }) => (
        <div className={styles.row} key={c}>
          <div className={styles.r1}>
            <div className={styles.nm}>
              {l}
              <i> n = {fmtN(r.n_players)}</i>
            </div>
            <div className={styles.v}>
              {r.n_flag_watch_z25}
              <small>vs {r.expected_watch_by_chance.toFixed(1)}</small>
            </div>
          </div>
          <div className={styles.flagBars} role="img" aria-label={`${l}: ${r.n_flag_watch_z25} flagged, ${r.expected_watch_by_chance.toFixed(1)} expected by chance`}>
            <div className={styles.flagBar} style={{ width: `${(r.n_flag_watch_z25 / max) * 100}%`, background: "var(--hw-ink)" }} />
            <div className={styles.flagBar} style={{ width: `${(r.expected_watch_by_chance / max) * 100}%`, background: "var(--d-noise)", outline: "1.5px solid var(--d-flat-ink)", outlineOffset: -1.5 }} />
          </div>
        </div>
      ))}
      <div className={styles.axt}>
        <b>Players flagged (watch) per test</b>
        <span>vs expected by chance · strong: {strong}</span>
      </div>
    </div>
  );
  return {
    ...m,
    switches,
    verdict,
    headline,
    scan: { value: `${watch}`, unit: `flagged vs ~${Math.round(exp)} by chance` },
    scope: [tsName(f.ts), TIMESPAN_SWITCH_LABEL[f.ts] ? OUT3.find((o) => o.id === out)!.label : ""].filter(Boolean),
    how: "Black = players flagged (a nominal 2.5+ standard errors out). Tan = how many pure noise would flag. If they match, it is chance.",
    body,
    legend: ["obs", "noise"],
    facts: [
      { label: "Flagged", value: String(watch) },
      { label: "By chance", value: exp.toFixed(1) },
      { label: "Strong", value: String(strong) },
    ],
    sample: `${strong} strong`,
    caveats: [
      `${ASSOC} “Watch” = a player’s gap is at least 2.5 standard errors out; “strong” = it survives a correction for testing hundreds of players.`,
      `Players per test — ${have.map((x) => `${x.l}: ${fmtN(x.r.n_players)}`).join("; ")}.`,
      "Counts close to the chance column are what noise looks like, so treat any named player as a lead, not a finding.",
      "Uses all players, so the PPG segment filter does not change it.",
      ...(have.some((x) => x.r.provisional) || EARLY(f.ts) ? [EARLY_NOTE] : []),
    ],
    method: "Per player, raw gap vs the comparison; z-scores and a Benjamini–Hochberg q across all players in the test. Expected-by-chance = players × the probability of |z| ≥ 2.5.",
  };
}

/* ───────── rankings ───────── */
const CMP_VIEW = [
  { id: "home_away", label: "Home/away" },
  { id: "b2b_second_vs_rested", label: "B2B 2nd" },
  { id: "b2b_first_vs_rested", label: "B2B 1st" },
];
const NLAB: Record<CmpKey, [string, string]> = {
  home_away: ["home", "away"],
  b2b_second_vs_rested: ["2nd night", "rested"],
  b2b_first_vs_rested: ["1st night", "rested"],
};

export function rankings(ctx: Ctx): CardModel {
  const { f, sel, data } = ctx;
  const m = baseModel(ctx, "rankings");
  const opts = CMP_VIEW.map((o) => ({ ...o, disabled: !data.splits.rankings[o.id]?.[f.ts] || data.splits.rankings[o.id][f.ts].n_ranked === 0 }));
  const cmp = pick(sel.m, opts) as CmpKey;
  const endOpts = [
    { id: "top", label: "Highest 25" },
    { id: "bottom", label: "Lowest 25" },
  ];
  const end = pick(sel.s, endOpts) as "top" | "bottom";
  const switches: SwitchSpec[] = [
    { key: "m", value: cmp, options: opts },
    { key: "s", label: "Show", value: end, options: endOpts },
  ];
  const block = data.splits.rankings[cmp]?.[f.ts];
  const responders = respondersFor("rankings", ctx, { cmp });
  if (!block || block.n_ranked === 0) {
    return {
      ...m,
      switches,
      scope: [tsName(f.ts)],
      responders,
      state: {
        kind: "thin",
        title: EARLY(f.ts) ? "Not enough games yet" : "Too few games to read",
        text: `No qualifying players for ${CMP_LABELS[cmp]} in ${tsName(f.ts)}. Nothing is drawn; we won’t guess.`,
        fixes: f.ts === "2026_27" ? [{ label: "Show 2025-26", ts: "2025_26" }] : [{ label: "Show 3 seasons", ts: "pooled_2023_26" }],
      },
    };
  }
  const entries = block.by_raw[end] ?? [];
  const [la, lb] = NLAB[cmp];
  const rows: ChartRow[] = entries.map((e) => {
    const few = Math.min(e.n_a, e.n_b) < PLAYER_ROW_MIN_GAMES;
    const flag = isWatchFlag(e.pts.flag);
    const row: ChartRow = {
      key: e.player_id,
      label: e.full_name,
      sub: e.team ?? undefined,
      est: e.pts.raw,
      lo: e.pts.ci95[0],
      hi: e.pts.ci95[1],
      valText: sg(e.pts.raw),
      unit: "pts",
      ciText: `${sg(e.pts.ci95[0])} to ${sg(e.pts.ci95[1])}${flag ? " · watch" : ""}`,
      n: `${e.n_a} ${la} · ${e.n_b} ${lb} games`,
      ring: flag && !few,
      strong: isStrongFlag(e.pts.flag) && !few,
      href: `/players?player=${encodeURIComponent(e.player_id)}`,
    };
    return few ? { ...row, thin: true, thinVal: sg(e.pts.raw), thinTxt: `under ${PLAYER_ROW_MIN_GAMES} games on a side · ${sg(e.pts.ci95[0])} to ${sg(e.pts.ci95[1])}` } : row;
  });
  const nStrong = entries.filter((e) => isStrongFlag(e.pts.flag)).length;
  const top5 = rows.slice(0, 5);
  const nFew = top5.filter((r) => r.thin).length;
  const title = CMP_VIEW.find((o) => o.id === cmp)!.label.toLowerCase();
  const headline = `${nFew > 0 ? `${nFew} of the five biggest ${end === "top" ? "" : "negative "}${title} gaps rest on under ${PLAYER_ROW_MIN_GAMES} games a side; ` : ""}${nStrong === 0 ? "no player passes the correction for testing hundreds of people" : `${nStrong} flagged player${nStrong === 1 ? "" : "s"} pass the correction`}.`.replace(/^./, (c) => c.toUpperCase());
  const axisTitle = `${CMP_LABELS[cmp]} (pts)`;
  return {
    ...m,
    switches,
    verdict: nStrong > 0 ? "up" : "flat",
    headline,
    scan: { value: String(nStrong), unit: "strong flags" },
    scope: [tsName(f.ts), `${fmtN(block.n_ranked)} ranked`, `${end === "top" ? "highest" : "lowest"} 25, top 5 shown`],
    how: "Each dot is one player’s own gap with its 95% range. A ring is a lead to check, not a proven gap; hatched rows have too few games.",
    body: <RankList rows={rows} base={0} axisTitle={axisTitle} endL={end === "top" ? "← smaller" : "← bigger drop"} endR={end === "top" ? "bigger gap →" : "smaller →"} label={`Player ranking, ${CMP_LABELS[cmp]}`} total={rows.length} />,
    legend: LG.rank,
    facts: [
      { label: "Ranked", value: fmtN(block.n_ranked) },
      { label: "Strong flags", value: String(nStrong) },
      { label: "Min games per side", value: String(PLAYER_ROW_MIN_GAMES) },
    ],
    sample: `${fmtN(block.n_ranked)} ranked · ${nStrong} strong flags`,
    caveats: [
      `${ASSOC} Mostly noise: “watch” = nominal |z| ≥ 2.5, about chance-level volume with 400–800 players per comparison.`,
      data.splits.ranking_note,
      block.shrunk_is_flat ? "Shrunk values are flat here (spread between players under 0.1 pt), so raw gaps with intervals are shown." : "",
      `Rows with under ${PLAYER_ROW_MIN_GAMES} games on either side are hatched: Data’s own floor is lower (3–10 per side by test), so this display rule is stricter than the data’s.`,
      ...data.splits.caveats.filter((c) => (EARLY(f.ts) ? true : !c.startsWith("2026-27") && !c.startsWith("flagged[]"))),
      "Uses all players, so the PPG segment filter does not change it.",
    ].filter(Boolean),
    method: "Raw per-player paired gap (condition A − B) with a 95% interval; ranked on the raw gap. Flags: z from the gap and its standard error; strong = FDR q < 0.1.",
    responders,
  };
}

/* ───────── heatmap ───────── */
const HEAT = [
  { id: "scorer_segment", label: "PPG segment" },
  { id: "position", label: "Position" },
  { id: "age", label: "Age" },
  { id: "experience", label: "Experience" },
];
const HEAT_MIN_PLAYERS = 10;

export function heatmap(ctx: Ctx): CardModel {
  const { f, sel, data } = ctx;
  const m = baseModel(ctx, "heatmap");
  const seg = pick(sel.m, HEAT) as "scorer_segment" | "position" | "age" | "experience";
  const switches: SwitchSpec[] = [{ key: "m", value: seg, options: HEAT, label: "Group by" }];
  const hm = data.splits.heatmaps.segment_x_condition[f.ts]?.[seg];
  if (!hm) {
    return { ...m, switches, scope: [tsName(f.ts)], state: { kind: "thin", title: EARLY(f.ts) ? "Not enough games yet" : "Too few games to read", text: `No heatmap exists for ${tsName(f.ts)}: too few players per cell. Nothing is drawn.`, fixes: f.ts === "2026_27" ? [{ label: "Show 2025-26", ts: "2025_26" }] : [{ label: "Show 3 seasons", ts: "pooled_2023_26" }] } };
  }
  const vals = hm.cmp_pts_mean;
  const ns = hm.cmp_n;
  const read = vals.flatMap((r, ri) => r.map((v, ci) => ({ v, n: ns[ri]?.[ci] ?? 0, ri, ci }))).filter((x): x is { v: number; n: number; ri: number; ci: number } => x.v != null && x.n >= HEAT_MIN_PLAYERS);
  const maxAbs = Math.max(0.5, ...read.map((x) => Math.abs(x.v)));
  const big = read.sort((a, b) => Math.abs(b.v) - Math.abs(a.v))[0];
  const COLS: Record<string, string> = { home_away: "H−A", b2b_second_vs_rested: "2nd−R", b2b_first_vs_rested: "1st−R" };
  const headline = big
    ? `The largest gap between groups is ${sg(big.v)} pts (${SEGMENT_ROW_LABELS[hm.rows[big.ri]] ?? hm.rows[big.ri]}, ${COLS[hm.cmp_cols[big.ci]]}); cells carry no intervals, so this is descriptive only.`
    : "Every cell has too few players to read; this grid is descriptive only.";
  const body = (
    <div className={styles.heatWrap}>
      <table className={styles.heat}>
        <thead>
          <tr>
            <th scope="col">Group</th>
            {hm.cmp_cols.map((c) => (
              <th key={c} scope="col">{COLS[c] ?? c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {hm.rows.map((row, ri) => (
            <tr key={row}>
              <th scope="row">{SEGMENT_ROW_LABELS[row] ?? row}</th>
              {hm.cmp_cols.map((c, ci) => {
                const v = vals[ri]?.[ci];
                const n = ns[ri]?.[ci] ?? 0;
                if (v == null) return <td key={c} className={styles.hatchCell}>—</td>;
                if (n < HEAT_MIN_PLAYERS) return <td key={c} className={styles.hatchCell}>{sg(v)}<small>n = {n}</small></td>;
                const k = Math.min(1, Math.abs(v) / maxAbs);
                const bg = v >= 0 ? `rgba(228,87,46,${0.12 + k * 0.5})` : `rgba(92,65,40,${0.1 + k * 0.4})`;
                return <td key={c} style={{ background: bg }}>{sg(v)}<small>n = {fmtN(n)}</small></td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className={styles.axt}><b>Mean paired gap in points (n = players in the cell)</b><span>orange above 0 · brown below 0</span></div>
    </div>
  );
  return {
    ...m,
    switches,
    verdict: "info",
    headline,
    scan: { value: big ? sg(big.v) : "n/a", unit: "pts, largest gap" },
    scope: [tsName(f.ts), HEAT.find((h) => h.id === seg)!.label],
    how: "Each cell is the average of the players’ own gaps in that group. Colour shows size and sign only; there is no interval per cell.",
    body,
    legend: ["thin"],
    facts: [
      { label: "Groups", value: String(hm.rows.length) },
      { label: "Cells read", value: String(read.length) },
      { label: "Min players per cell", value: String(HEAT_MIN_PLAYERS) },
    ],
    sample: `${read.length} of ${hm.rows.length * hm.cmp_cols.length} cells read`,
    caveats: [
      `${ASSOC} Descriptive: no per-cell interval exists, so no cell is called clear or not clear.`,
      `Cells with under ${HEAT_MIN_PLAYERS} players are hatched (display rule; Data publishes them).`,
      "H−A = home minus away; 2nd−R = second night minus rested; 1st−R = first night minus rested.",
      "Uses all players, so the PPG segment filter does not change it.",
      ...(EARLY(f.ts) ? [EARLY_NOTE] : []),
    ],
    method: "Per cell: the mean over players of each player’s paired points difference (condition A − B). n is the number of players in the cell.",
  };
}

/* ───────── watch list ───────── */
export function watchList(ctx: Ctx): CardModel {
  const { f, data } = ctx;
  const m = baseModel(ctx, "watch-list");
  const list = data.splits.flagged.filter((x) => x.scope === f.ts);
  const strong = list.filter((x) => isStrongFlag(x.pts.flag)).length;
  const headline = list.length === 0 ? "No player is on the watch list in this timespan." : `${list.length} flag${list.length === 1 ? "" : "s"} on the watch list; ${strong === 0 ? "none survives the correction for testing hundreds of players" : `${strong} survive${strong === 1 ? "s" : ""} the correction`}.`;
  const body = list.length === 0 ? (
    <p className={styles.cellNote}>No watch flags in {tsName(f.ts)}.</p>
  ) : (
    <ul className={styles.watchList}>
      {list.map((x) => (
        <li key={`${x.comparison}-${x.player_id}`}>
          <Link href={`/players?player=${encodeURIComponent(x.player_id)}`}>
            <b>{x.full_name}</b>
            <span>
              {x.team ?? "FA"} · {CMP_LABELS[x.comparison as CmpKey] ?? x.comparison} · {sg(x.pts.raw)} raw ({sg(x.pts.ci95[0])} to {sg(x.pts.ci95[1])}) · {x.n_a} vs {x.n_b} games · {isStrongFlag(x.pts.flag) ? "strong" : "watch"}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
  return {
    ...m,
    verdict: "info",
    headline,
    scan: { value: String(list.length), unit: "flags" },
    scope: [tsName(f.ts), `${list.length} flags`],
    how: "Players whose own gap is at least 2.5 standard errors out in one test. Tap a name to open his page.",
    body,
    legend: [],
    facts: [
      { label: "Flags", value: String(list.length) },
      { label: "Strong", value: String(strong) },
      { label: "Min |z|", value: "2.5" },
    ],
    sample: `${list.length} flags · ${strong} strong`,
    caveats: [
      `${ASSOC} “Watch” flags are nominal: with 400–800 players per comparison about 1.2% would reach |z| ≥ 2.5 by chance. Only “strong” (FDR q < 0.1) survives multiple testing.`,
      ...data.splits.caveats.filter((c) => !c.startsWith("flagged[]") && (EARLY(f.ts) || !c.startsWith("2026-27"))),
      ...(EARLY(f.ts) ? [EARLY_NOTE] : []),
    ],
    method: "Flags are exactly as labelled in the data (above/below league, watch or strong) from the per-player home/away and back-to-back tests; the list is every flag in the selected timespan.",
    responders: respondersFor("watch-list", ctx),
  };
}

/* ───────── any player-specific effect? ───────── */
export function playerEffect(ctx: Ctx): CardModel {
  const { f, sel, data } = ctx;
  const m = baseModel(ctx, "player-effect");
  const out = pick(sel.m, OUT3) as Outcome;
  const switches: SwitchSpec[] = [{ key: "m", value: out, options: OUT3 }];
  const fl = data.deep.flags[f.ts] ?? [];
  const rows = FLAG_CONDS.map(([c, l]) => ({ c, l, r: fl.find((x) => x.condition === c && x.outcome === out) })).filter((x): x is { c: string; l: string; r: FlagRow } => !!x.r);
  if (rows.length === 0) {
    return { ...m, switches, scope: [tsName(f.ts)], state: { kind: "thin", title: EARLY(f.ts) ? "Not enough games yet" : "Too few games to read", text: `No per-player summary exists for ${tsName(f.ts)}: too few players qualify. Nothing is drawn.`, fixes: f.ts === "2026_27" ? [{ label: "Show 2025-26", ts: "2025_26" }] : [{ label: "Show 3 seasons", ts: "pooled_2023_26" }] } };
  }
  const isDev = out === "dev";
  const sc = isDev ? 1 : 100;
  const chart: ChartRow[] = rows.map(({ c, l, r }) => {
    const credible = r.n_above_league + r.n_below_league;
    if (r.league_mean_diff == null || r.league_mean_ci_low == null || r.league_mean_ci_high == null) return { key: c, label: l, est: null, thin: true, thinTxt: "no league estimate" };
    return {
      key: c,
      label: l,
      sub: r.tau != null ? `spread τ ${isDev ? r.tau.toFixed(2) : (r.tau * 100).toFixed(1)}` : undefined,
      est: r.league_mean_diff * sc,
      lo: r.league_mean_ci_low * sc,
      hi: r.league_mean_ci_high * sc,
      valText: sg(r.league_mean_diff * sc, isDev ? 2 : 1),
      unit: isDev ? "pts" : "pp",
      ciText: `${sg(r.league_mean_ci_low * sc, isDev ? 2 : 1)} to ${sg(r.league_mean_ci_high * sc, isDev ? 2 : 1)}`,
      n: `${credible} of ${fmtN(r.n_players)} players clear of it`,
    };
  });
  const credible = rows.reduce((a, x) => a + x.r.n_above_league + x.r.n_below_league, 0);
  const none = credible === 0;
  const w = rows.find((x) => x.c === "worst5")?.r;
  const w10 = rows.find((x) => x.c === "worst10")?.r;
  const headline = none
    ? "No. No player has an effect of his own: everyone shares the league-wide figure, and none is credibly different from it."
    : `${credible} player estimate${credible === 1 ? "" : "s"} differ${credible === 1 ? "s" : ""} from the shared league effect; treat each as a lead.`;
  const spec: ChartSpec = {
    rows: chart,
    base: 0,
    mark: "dot",
    axisTitle: isDev ? "League-wide effect everyone shares (pts)" : "League-wide effect everyone shares (percentage points)",
    endL: isDev ? "← fewer" : "← less likely",
    endR: isDev ? "more →" : "more likely →",
    label: "League-wide effect and player spread",
  };
  return {
    ...m,
    switches,
    verdict: none ? "flat" : "info",
    headline,
    scan: { value: String(credible), unit: "players clear of league" },
    scope: [tsName(f.ts), `${fmtN(Math.max(...rows.map((x) => x.r.n_players)))} players`],
    how: `Each dot is the one effect the whole league shares for that condition (not a player). Under each name: how spread out players are (τ) and how many sit credibly away from it. ${WHISKER}`,
    body: chartBody(spec),
    legend: ["up", "down", "flat", "whk", "bl"],
    facts: [
      { label: "Players", value: fmtN(Math.max(...rows.map((x) => x.r.n_players))) },
      { label: "Clear of league", value: String(credible) },
      { label: "Strong flags", value: String(rows.reduce((a, x) => a + x.r.n_flag_strong_q10, 0)) },
    ],
    sample: `${credible} clear of league`,
    caveats: [
      `${ASSOC} A spread (τ) of zero means every player’s shrunk estimate is the league figure.`,
      w && w10
        ? `Top 50 players clear of the league effect — worst 5: ${w.n_above_league_top50 + w.n_below_league_top50} of ${w.n_stars_top50}; worst 10: ${w10.n_above_league_top50 + w10.n_below_league_top50} of ${w10.n_stars_top50}.`
        : "",
      `Watch flags vs chance — ${rows.map((x) => `${x.l}: ${x.r.n_flag_watch_z25} vs ${x.r.expected_watch_by_chance.toFixed(1)}`).join("; ")}.`,
      "Uses all players, so the PPG segment filter does not change it.",
      ...(EARLY(f.ts) ? [EARLY_NOTE] : []),
    ].filter(Boolean),
    method: "Hierarchical (shrunk) per-player estimates around a league-wide mean; τ is the estimated spread between players. “Clear of league” = the player’s shrunk interval excludes the league mean.",
  };
}

/* ───────── per-player splits ───────── */
const COND: [string, string, string][] = [
  ["worst5", "Worst 5", "against the 5 worst defences vs the rest"],
  ["worst10", "Worst 10", "against the 10 worst defences vs the rest"],
  ["home_vs_away", "Home/away", "at home vs away"],
  ["b2b_2nd_vs_rested", "B2B 2nd", "on the 2nd night of a back-to-back vs rested"],
];

export function playerSplits(ctx: Ctx): CardModel {
  const { f, sel, data } = ctx;
  const m = baseModel(ctx, "player-splits");
  const condOpts = COND.map(([id, label]) => ({ id, label }));
  const cond = pick(sel.m, condOpts);
  const out = pick(sel.s, OUT3) as Outcome;
  const switches: SwitchSpec[] = [
    { key: "m", label: "Condition", value: cond, options: condOpts },
    { key: "s", label: "Outcome", value: out, options: OUT3 },
  ];
  const cell = deepCell(ctx);
  const summary = (data.deep.flags[f.ts] ?? []).find((r) => r.condition === cond && r.outcome === out);
  const none = !!summary && summary.n_above_league === 0 && summary.n_below_league === 0;
  const word = out === "dev" ? "points effect" : "big-night effect";
  const base: Partial<CardModel> = { switches, async: true };
  if (EARLY(f.ts)) {
    return { ...m, ...base, async: false, scope: scopeFor(f, cell), state: { kind: "thin", title: "Not enough games yet", text: "2026-27 is early: players have too few games on each side of a split for a per-player estimate. Nothing is drawn.", fixes: ([{ label: "Show 2025-26", ts: "2025_26" as const }, ...(f.seg !== "all" ? [{ label: "Show All", seg: "all" as const }] : [])] as Fix[]).slice(0, 2) } };
  }
  if (isThinCell(cell)) return { ...m, ...base, async: false, state: thinState(f, cell, "per-player splits"), scope: scopeFor(f, cell) };
  const headline = none
    ? `No player has a credible ${word} of his own here.`
    : summary
      ? `${summary.n_above_league + summary.n_below_league} player estimates sit clear of the league effect here; treat each as a lead.`
      : "No league summary exists for this condition.";
  const tau = summary?.tau;
  const condText = COND.find((c) => c[0] === cond)![2];
  return {
    ...m,
    ...base,
    verdict: none ? "flat" : "info",
    headline,
    scan: { value: summary ? String(summary.n_above_league + summary.n_below_league) : "n/a", unit: "clear of league" },
    scope: scopeFor(f, cell, [condText]),
    how: "Each dot is a player’s own gap, shrunk toward the league band (tan) so a few games can’t set the picture. A ring is a lead, not a proven effect.",
    body: <PlayerSplitsBody ts={f.ts} seg={f.seg} cond={cond} out={out} summary={summary} />,
    legend: [],
    facts: [
      { label: "Players", value: summary ? fmtN(summary.n_players) : "n/a" },
      { label: "Watch", value: summary ? String(summary.n_flag_watch_z25) : "n/a" },
      { label: "By chance", value: summary ? summary.expected_watch_by_chance.toFixed(1) : "n/a" },
    ],
    sample: summary ? `${fmtN(summary.n_players)} players` : "",
    caveats: [
      `${ASSOC} Flags are labelled exactly as the data does: “watch” = raw gap at least 2.5 standard errors out but not through the multiple-testing correction; “strong” = it is (q < 0.10).`,
      summary
        ? `Across ${fmtN(summary.n_players)} players: ${summary.n_flag_watch_z25} watch flags against about ${summary.expected_watch_by_chance.toFixed(1)} expected by chance, and ${summary.n_flag_strong_q10} strong${tau != null ? `; estimated spread between players ${out === "dev" ? tau.toFixed(2) + " pts" : (tau * 100).toFixed(1) + " pp"}` : ""}.`
        : "",
      `Rows with under ${PLAYER_ROW_MIN_GAMES} games on either side are hatched (display rule; Data’s own floor is lower).`,
      "Segment filter: the list follows the Top 100 / Top 50 labels; All shows every ranked player. Top 25 and Top 10 are too small to read.",
      ...(f.ts === "pooled_2023_27" ? ["This pooled window includes early 2026-27 games; the per-player floors are applied to the pooled totals."] : []),
    ].filter(Boolean),
    method: "Per-player shrunk estimate of the condition gap (empirical-Bayes toward the league-wide gap) with a 95% interval; flags from the raw z and an FDR q.",
    responders: respondersFor("player-splits", ctx, { cond, out }),
  };
}


/* ───────── who responds when a scorer is out (Data's player × condition study) ───────── */
export function playersOut(ctx: Ctx): CardModel {
  const { f, data } = ctx;
  const pc = data.pc;
  const m = baseModel(ctx, "players-out");
  const key = "out_top1|dev";
  const cell = pc.cells[f.seg]?.[key];
  const where = `${tsName(f.ts)} · ${segName(f.seg)}`;
  if (f.ts === "2026_27") {
    return {
      ...m,
      scope: scopeFor(f),
      state: {
        kind: "thin",
        title: "Player rows hidden for 2026-27",
        text: "Players have at most a few games on each side of a condition this season, and the held-out check is empty. Per-player rows use 3 seasons pooled; nothing is drawn for 2026-27.",
        fixes: [{ label: "Show 3 seasons", ts: "pooled_2023_26" }],
      },
    };
  }
  if (f.seg === "top25" || f.seg === "top10" || !cell) {
    return {
      ...m,
      scope: scopeFor(f),
      state: { kind: "thin", title: `${segName(f.seg)} is always too small to read`, text: `${where}: top 25 and top 10 have 25 and 10 players, so no player ranking is read. Nothing is drawn.`, fixes: fixesFor(f) },
    };
  }
  const st = statusOf(cell.verdict);
  const few = st.id === "few";
  const expTot = (cell.expStrong ?? 0) + (cell.expWatch ?? 0);
  const lm = cell.lm != null ? sg(cell.lm, 2) : "n/a";
  const roleCaveat = pc.caveats.find((c) => c.includes("portable trait")) ?? "";
  const headline = few
    ? `Too few ${segName(f.seg)} players have 10+ games on each side of “top scorer out” to test whether players differ.`
    : `Players differ in how much they gain when their team’s top scorer is out: the league effect is ${lm} points against his own average, and ${cell.strong} strong + ${cell.watch} watch players differ from it, against ${expTot.toFixed(2)} expected by chance. ${st.id === "holds" ? "This is the one player pattern that holds across seasons." : st.copy}`;
  return {
    ...m,
    verdict: few ? "thin" : "info",
    badgeText: st.label,
    headline,
    scan: { value: few ? "n/a" : `${cell.strong + cell.watch}`, unit: `flagged vs ${expTot.toFixed(2)} by chance` },
    scope: [tsName("pooled_2023_26"), segName(f.seg), `${fmtN(cell.np)} players`],
    how: "Each list is a player’s shrunk gain when the condition holds, against his own prior average: shrunk toward the league so a big raw gap on few games doesn’t top the list. “vs league” is the gap to the league effect; the flag and the held-out mark say whether it repeated in a later season. Effects are associated with the condition, not caused by it.",
    body: few ? null : (
      <Tiles
        tiles={[
          { big: lm, label: "league effect (points)", sub: "every player, top scorer out vs not" },
          { big: cell.rel != null ? `${Math.round(cell.rel * 100)}%` : "n/a", label: "reliability", sub: "share of a player’s raw gap that is signal" },
          { big: `${cell.strong + cell.watch}`, label: "flagged vs the league", sub: `${expTot.toFixed(2)} expected by chance` },
          { big: cell.tr[0] != null ? sg(cell.tr[0] as number, 2) : "n/a", label: "across-season correlation", sub: cell.tr[3] != null ? `${cell.tr[3]} players, held-out season` : "not tested" },
        ]}
      />
    ),
    legend: [],
    facts: [
      { label: "Players in cell", value: fmtN(cell.np) },
      { label: "Min games per side", value: String(pc.min_n_both_sides) },
      { label: "Ranked from", value: `${pc.min_n_rank}+ games` },
    ],
    sample: `${fmtN(cell.np)} players`,
    caveats: [...pc.caveats.slice(0, 2), roleCaveat, "Effects are against each player’s own average, not against betting lines: this is context, not a betting edge."].filter(Boolean),
    method: "Per player: in-condition mean minus reference mean, with pooled variance, shrunk toward the league mean by empirical Bayes; flag vs league = shrunk 95% interval excludes the league mean (strong) or 90% (watch), with 15+ games per side. Persistence: correlation of 2023-25 effects with 2025-26 effects (held-out season).",
  };
}
