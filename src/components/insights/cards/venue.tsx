import {
  SECONDARY_LABELS,
  SECONDARY_ORDER,
  SECONDARY_TITLES,
  type ComparisonBlock,
  type MetricStats,
} from "@/lib/insightsTypes";
import type { CardModel, ChartRow, ChartSpec, Ctx, SwitchSpec } from "@/lib/insights/types";
import {
  ciTxt,
  deepCell,
  effRow,
  fixesFor,
  fmtN,
  isThinCell,
  kindOf,
  r1,
  scopeFor,
  sg,
  thinState,
  tsName,
  segName,
  EARLY,
} from "@/lib/insights/util";
import { ASSOC, EARLY_NOTE, LG, SEG_NOTE, WHISKER, baseModel, chartBody, pick } from "./common";

type Cmp = "home_away" | "b2b_2nd" | "b2b_1st";
type Metric = "pts" | "minutes" | "per36";
type Dir = "up" | "down" | "unclear";

const M_LABEL: Record<Metric, string> = { pts: "Points", minutes: "Minutes", per36: "Per 36" };
const M_UNIT: Record<Metric, string> = { pts: "pts", minutes: "min", per36: "pts per 36" };

const hasCi = (s: MetricStats | null | undefined): s is MetricStats & { ci95: [number, number] } =>
  !!s && Array.isArray(s.ci95) && s.ci95.length === 2;

function dir(s: MetricStats | null | undefined, block?: ComparisonBlock | null): Dir {
  if (!hasCi(s)) return "unclear";
  if (block && (block.small_n || block.n_units < 2)) return "unclear";
  const [lo, hi] = s.ci95;
  if (lo <= 0 && hi >= 0) return "unclear";
  return s.mean > 0 ? "up" : "down";
}

function unitsWord(pooled: boolean, n: number) {
  return `${fmtN(n)} ${pooled ? "player-seasons" : "players"}`;
}

function metricRow(key: string, label: string, block: ComparisonBlock | null | undefined, metric: Metric, pooled: boolean): ChartRow {
  const st = block?.[metric];
  if (!block || block.n_units <= 0 || !st) return { key, label, est: null, thin: true, thinTxt: "no qualifying players" };
  const n = unitsWord(pooled, block.n_units);
  if (!hasCi(st)) return { key, label, est: null, thin: true, thinTxt: "no interval", n };
  if (block.small_n || block.n_units < 2) {
    return { key, label, est: null, thin: true, thinTxt: `too few players to read (${ciTxt(st.ci95[0], st.ci95[1])})`, thinVal: sg(st.mean), n };
  }
  return {
    key,
    label,
    est: st.mean,
    lo: st.ci95[0],
    hi: st.ci95[1],
    valText: sg(st.mean),
    unit: M_UNIT[metric],
    ciText: ciTxt(st.ci95[0], st.ci95[1]),
    n,
  };
}

function peerNote(label: string, block: ComparisonBlock | null | undefined): string | null {
  if (!block?.pts || !hasCi(block.pts) || block.n_units < 2 || block.small_n) return null;
  const d = dir(block.pts, block);
  const ci = `(${ciTxt(block.pts.ci95[0], block.pts.ci95[1])})`;
  return d === "unclear"
    ? `${label}: ${sg(block.pts.mean)} pts ${ci}, no clear change.`
    : `${label}: ${sg(block.pts.mean)} pts ${ci}, clear ${d === "up" ? "rise" : "drop"}.`;
}

function b2bAttribution(ptsDir: Dir, minutes: MetricStats | null | undefined, per36: MetricStats | null | undefined, block: ComparisonBlock | null): string | null {
  const md = dir(minutes, block);
  const rd = dir(per36, block);
  if (ptsDir === "unclear") return md === "unclear" || !minutes ? null : `Minutes are ${md === "up" ? "up" : "down"} ${r1(minutes.mean)}.`;
  const more = ptsDir === "up";
  if (md === ptsDir && rd === "unclear") return `Players score ${more ? "more" : "less"} on the second night because they play ${more ? "more" : "fewer"} minutes, not because they score ${more ? "faster" : "slower"}.`;
  if (rd === ptsDir && md === "unclear") return `Players score ${more ? "more" : "less"} on the second night because they score ${more ? "faster" : "slower"} per minute; minutes barely change.`;
  if (md === ptsDir && rd === ptsDir) return `Players score ${more ? "more" : "less"} on the second night: minutes and scoring rate both move that way.`;
  return null;
}

type Cfg = {
  id: string;
  cmp: Cmp;
  metrics: boolean;
  splits: boolean;
  setting: string; // "at home vs away"
  axis: (m: Metric) => string;
  ends: [string, string];
  how: string;
};

function comparison(ctx: Ctx, cfg: Cfg): CardModel {
  const { f, data, sel } = ctx;
  const ins = data.insights;
  const info = ins.timespan_info[f.ts];
  const pooled = info?.pooled ?? f.ts.startsWith("pooled");
  const block = ins.results[f.ts]?.[f.seg]?.[cfg.cmp] ?? null;
  const minGames = typeof ins.definitions.min_games_per_side === "number" ? ins.definitions.min_games_per_side : 3;
  const secondary = ins.secondary[f.ts];
  const m = baseModel(ctx, cfg.id);

  const havePts = !!block && block.n_units > 0 && !!block.pts;
  if (!havePts || !block) {
    return {
      ...m,
      verdict: "thin",
      state: {
        kind: "thin",
        title: EARLY(f.ts) ? "Not enough games yet" : "Too few games to read",
        text: `No qualifying players for ${tsName(f.ts)} · ${segName(f.seg)}: each needs ${minGames}+ games on each side of the split. Nothing is drawn; we won’t guess.`,
        fixes: fixesFor(f),
      },
      scope: scopeFor(f),
      caveats: [ASSOC, ...(EARLY(f.ts) ? [EARLY_NOTE] : [])],
      method: "Mean of each player’s paired difference (condition A − B), at least " + minGames + " games per side, regular season only; 95% CI from a percentile bootstrap.",
    };
  }

  // ── headline (always from the Overall points row) ──
  const pts = block.pts!;
  const pd = dir(pts, block);
  const mean = pts.mean;
  let headline: string;
  if (cfg.cmp === "home_away") {
    headline =
      pd === "unclear"
        ? "No clear change at home: players score about the same as away, within noise."
        : `Players score about ${r1(mean)} ${pd === "up" ? "more" : "fewer"} points at home than away, and the gap is clear.`;
  } else if (cfg.cmp === "b2b_2nd") {
    const attr = b2bAttribution(pd, block.minutes, block.per36, block);
    headline =
      pd === "unclear"
        ? `No clear change on the second night: scoring is about the same, within noise.${attr ? " " + attr : ""}`
        : (attr ?? `Players score about ${r1(mean)} ${pd === "up" ? "more" : "fewer"} points on the second night, and the gap is clear.`);
  } else {
    headline =
      pd === "unclear"
        ? "No clear change on the first night of a back-to-back: about the same, within noise."
        : `Players score about ${r1(mean)} ${pd === "up" ? "more" : "fewer"} points on the first night, and the gap is clear.`;
  }

  // ── switches ──
  const switches: SwitchSpec[] = [];
  const metricOpts = (["pts", "minutes", "per36"] as Metric[]).map((k) => ({ id: k, label: M_LABEL[k], disabled: !block[k] }));
  const metric = cfg.metrics ? (pick(sel.m, metricOpts) as Metric) : "pts";
  if (cfg.metrics) switches.push({ key: "m", value: metric, options: metricOpts });

  const splitKeys = ["position", "age", "experience"] as const;
  let split = "overall";
  if (cfg.splits) {
    const opts = [
      { id: "overall", label: "Overall" },
      ...splitKeys.map((k) => ({
        id: k,
        label: SECONDARY_TITLES[k].replace(/^By /, ""),
        disabled: f.seg !== "all" || metric === "per36" || (metric === "minutes" && k !== "experience"),
      })),
    ];
    split = pick(sel.s, opts);
    switches.push({ key: "s", label: "Split by", value: split, options: opts });
  }

  // ── chart ──
  const unit = M_UNIT[metric];
  let rows: ChartRow[];
  if (split === "overall") {
    rows = [metricRow("overall", M_LABEL[metric] === "Points" ? "Overall" : `Overall · ${M_LABEL[metric]}`, block, metric, pooled)];
  } else {
    const cut = secondary?.[split as keyof typeof secondary] as Record<string, { home_away: ComparisonBlock | null; b2b_2nd: ComparisonBlock | null; b2b_1st: ComparisonBlock | null } | number> | undefined;
    rows = SECONDARY_ORDER[split as keyof typeof SECONDARY_ORDER]
      .map((k) => {
        const e = cut?.[k];
        if (!e || typeof e === "number") return null;
        const b = e[cfg.cmp];
        if (!b || b.n_units <= 0) return null;
        return metricRow(k, SECONDARY_LABELS[k] ?? k, b, metric, pooled);
      })
      .filter((x): x is ChartRow => !!x);
  }
  const spec: ChartSpec = {
    rows,
    base: 0,
    mark: "bar",
    axisTitle: cfg.axis(metric),
    endL: cfg.ends[0],
    endR: cfg.ends[1],
    label: `${cfg.setting}, ${unit}`,
  };

  // ── verdict ──
  const overall = metricRow("o", "o", block, "pts", pooled);
  const verdict = overall.thin ? "thin" : kindOf(overall.lo!, overall.hi!, 0);

  // ── caveats ──
  const caveats = [`${ASSOC} Rest and travel are not randomised: coaches rest players around back-to-backs, and absent players are not in the data.`];
  const sizes = rows.filter((r) => r.n).map((r) => `${r.label}: ${r.n}`);
  if (sizes.length) caveats.push(`Sample per row — ${sizes.join("; ")}.`);
  if (cfg.cmp === "b2b_2nd" && f.seg === "all") {
    const t100 = peerNote("Top 100 scorers", ins.results[f.ts]?.top100?.b2b_2nd);
    const t10 = peerNote("Top 10", ins.results[f.ts]?.top10?.b2b_2nd);
    if (t100) caveats.push(t100);
    if (t10) caveats.push(`${t10} Top 10 is a very small group.`);
  }
  if (rows.some((r) => r.thin)) caveats.push(`Hatched rows have too few players to read; the dimmed value is the raw estimate, not a finding.`);
  if (f.seg === "top25" || f.seg === "top10") caveats.push(SEG_NOTE);
  caveats.push(`Many comparisons are reported across timespans, segments and measures, so expect a few to look clear by chance.`);
  if (EARLY(f.ts) || f.ts === "pooled_2023_27") caveats.push(EARLY_NOTE);

  const games = block.games_a + block.games_b;
  return {
    ...m,
    verdict,
    headline,
    scan: { value: sg(mean), unit: "pts" },
    scope: scopeFor(f, { n_players: block.n_players, n_games: games }),
    pills: [...m.pills, ...(cfg.splits && f.seg !== "all" ? [{ text: "splits need All" }] : [])],
    how: cfg.how,
    switches,
    body: chartBody(spec),
    legend: LG.diff,
    facts: [
      { label: "Players", value: fmtN(block.n_players) },
      { label: "Games", value: fmtN(games) },
      { label: "Min games per side", value: String(minGames) },
    ],
    sample: `n = ${fmtN(games)} games`,
    caveats,
    method: `Each player is compared with himself (condition A − B), at least ${minGames} games on each side, regular season only (game IDs starting 002; Cup group/knockout count; Cup final, playoffs and play-in excluded). Mean of per-player differences; 95% CI from a percentile bootstrap${pooled ? " (clustered by player in pooled spans)" : ""}.`,
  };
}

export const homeAway = (ctx: Ctx) =>
  comparison(ctx, {
    id: "home-away",
    cmp: "home_away",
    metrics: false,
    splits: true,
    setting: "Home minus away",
    axis: () => "Home minus away (pts)",
    ends: ["← better away", "better home →"],
    how: `Each bar is the average of every player’s own home-minus-away points. ${WHISKER}`,
  });

export const b2bSecond = (ctx: Ctx) =>
  comparison(ctx, {
    id: "b2b-2nd",
    cmp: "b2b_2nd",
    metrics: true,
    splits: true,
    setting: "2nd night minus rested",
    axis: (m) => `2nd night minus rested (${M_UNIT[m]})`,
    ends: ["← fewer", "more →"],
    how: `Each bar is the average of every player’s own 2nd-night minus rested gap. ${WHISKER}`,
  });

export const b2bFirst = (ctx: Ctx) =>
  comparison(ctx, {
    id: "b2b-1st",
    cmp: "b2b_1st",
    metrics: false,
    splits: false,
    setting: "1st night minus rested",
    axis: () => "1st night minus rested (pts)",
    ends: ["← fewer", "more →"],
    how: `Each bar is the average of every player’s own 1st-night minus rested gap. ${WHISKER}`,
  });

/* ───────── deep-cell cards ───────── */

export function restDays(ctx: Ctx): CardModel {
  const { f } = ctx;
  const cell = deepCell(ctx);
  const m = baseModel(ctx, "rest-days");
  if (isThinCell(cell) || !cell?.eff) return { ...m, state: thinState(f, cell, "rest-day contrasts"), scope: scopeFor(f, cell) };
  const rows: ChartRow[] = (
    [
      ["rest_days:r0", "Back-to-back", "0 days off"],
      ["rest_days:r2", "2 days off", undefined],
      ["rest_days:r3plus", "3+ days off", undefined],
    ] as [string, string, string | undefined][]
  ).map(([k, l, s]) => effRow(k, l, s, cell.eff?.[k]?.dev, "dev"));
  const head = rows[2];
  const verdict = head.thin ? "thin" : kindOf(head.lo!, head.hi!, 0);
  const headline = head.thin
    ? "Too few games with 3+ days off to read the contrast here."
    : verdict === "flat"
      ? "With 3+ days off players score about the same as with one day off: no clear difference."
      : `With 3+ days off players score about ${r1(head.est!)} points ${verdict === "down" ? "less" : "more"} than usual, compared with one day off, and the gap is clear.`;
  const spec: ChartSpec = {
    rows,
    base: 0,
    mark: "bar",
    axisTitle: "Points vs his prior average, vs 1 day off (pts)",
    endL: "← fewer",
    endR: "more →",
    label: "Rest days, points vs prior average",
  };
  const r3 = cell.eff["rest_days:r3plus"]?.dev;
  return {
    ...m,
    verdict,
    headline,
    scan: { value: head.thin ? "n/a" : head.valText!, unit: "pts" },
    scope: scopeFor(f, cell),
    how: `Each bar compares games after that many days off with games after exactly one day off, in points above the player’s own prior average. ${WHISKER}`,
    body: chartBody(spec),
    legend: LG.diff,
    facts: [
      { label: "Players", value: fmtN(cell.n_players) },
      { label: "Games", value: fmtN(cell.n_games) },
      { label: "Min games per side", value: "30" },
    ],
    sample: `n = ${fmtN(cell.n_games)} games`,
    caveats: [
      `${ASSOC} Teams choose when to rest players, so long rests are not random.`,
      `Sample per row — ${rows.map((r) => `${r.label}: ${r.n ?? "n/a"}`).join("; ")}.`,
      ...(r3 && r3.nl < 300 ? [`Only ${fmtN(r3.nl)} games sit in the 3+ days group, so its interval is wide.`] : []),
      ...(f.seg === "top25" || f.seg === "top10" ? [SEG_NOTE] : []),
      ...(EARLY(f.ts) || f.ts === "pooled_2023_27" ? [EARLY_NOTE] : []),
    ],
    method: "Own-team rest from the schedule: 0 = back-to-back, 1 = one day off (the reference), 2, 3+. Contrast = mean points above the player’s own prior average (known before tip-off); contrasts with under 30 games on a side are blanked.",
  };
}

export function swing(ctx: Ctx): CardModel {
  const { f } = ctx;
  const cell = deepCell(ctx);
  const m = baseModel(ctx, "swing");
  if (isThinCell(cell) || !cell?.sd) return { ...m, state: thinState(f, cell, "spread ratios"), scope: scopeFor(f, cell) };
  const defs: [string, string, string][] = [
    ["home", "Home", "at home"],
    ["b2b_2nd", "B2B 2nd night", "on a second night"],
    ["b2b_1st", "B2B 1st night", "on a first night"],
  ];
  const rows: ChartRow[] = defs.map(([k, l]) => {
    const s = cell.sd?.[k];
    if (!s || s.r == null || s.lo == null || s.hi == null) return { key: k, label: l, est: null, thin: true, thinTxt: "not available" };
    return { key: k, label: l, est: s.r, lo: s.lo, hi: s.hi, valText: `${s.r.toFixed(2)}×`, ciText: `${s.lo.toFixed(2)} to ${s.hi.toFixed(2)}` };
  });
  const cls = (r: ChartRow) => (r.thin ? null : r.lo! > 1 ? "wider" : r.hi! < 1 ? "narrower" : "same");
  const groups: Record<string, string[]> = { same: [], wider: [], narrower: [] };
  rows.forEach((r, i) => {
    const c = cls(r);
    if (c) groups[c].push(defs[i][2]);
  });
  const list = (a: string[]) => (a.length > 1 ? `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}` : a[0]);
  const slight = (r: ChartRow) => (r.est != null && Math.abs(r.est - 1) < 0.05 ? "slightly " : "");
  const parts: string[] = [];
  if (groups.same.length) parts.push(`the same ${list(groups.same)}`);
  for (const w of ["wider", "narrower"] as const) {
    const idx = rows.map((r, i) => (cls(r) === w ? i : -1)).filter((i) => i >= 0);
    if (idx.length) parts.push(`${slight(rows[idx[0]])}${w} ${list(idx.map((i) => defs[i][2]))}`);
  }
  const headline = parts.length ? `Game-to-game spread is ${parts.join(", ")}.` : "Too few games to compare spread here.";
  const head = rows[1];
  const verdict = head.thin ? "thin" : kindOf(head.lo!, head.hi!, 1);
  const spec: ChartSpec = {
    rows,
    base: 1,
    log: true,
    mark: "dot",
    axisTitle: "Spread vs rested games (ratio)",
    endL: "← steadier",
    endR: "more swing →",
    label: "Spread ratios vs rested",
  };
  return {
    ...m,
    verdict,
    headline,
    scan: { value: head.thin ? "n/a" : head.valText!, unit: "2nd night" },
    scope: scopeFor(f, cell),
    how: `Each dot is how much a player’s points swing around his own prior average in that setting, divided by the swing when rested. 1× = the same. ${WHISKER}`,
    body: chartBody(spec),
    legend: ["up", "down", "flat", "whk", "bl"],
    facts: [
      { label: "Players", value: fmtN(cell.n_players) },
      { label: "Games", value: fmtN(cell.n_games) },
      { label: "Measure", value: "SD ratio" },
    ],
    sample: `n = ${fmtN(cell.n_games)} games`,
    caveats: [
      `${ASSOC} Swing = standard deviation of points minus the player’s prior average; a ratio above 1 means more game-to-game spread than when rested.`,
      "Ratios sit close to 1, so even a clear difference is small in practice.",
      ...(f.seg === "top25" || f.seg === "top10" ? [SEG_NOTE] : []),
      ...(EARLY(f.ts) || f.ts === "pooled_2023_27" ? [EARLY_NOTE] : []),
    ],
    method: "Ratio of the SD of (points − prior average) in the setting to the SD in rested games, with a 95% interval; dotted line = 1 (log scale).",
  };
}

