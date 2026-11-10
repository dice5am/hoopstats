import type { Outcome } from "@/lib/deepInsightsTypes";
import type { CardModel, ChartRow, ChartSpec, Ctx, SwitchSpec } from "@/lib/insights/types";
import { SEGMENT_ORDER, TIMESPAN_SWITCH_LABEL, type SegmentKey, type TimespanKey } from "@/lib/timespans";
import {
  EARLY,
  OUT_LABEL,
  deepCell,
  effRow,
  fmtN,
  isThinCell,
  kindOf,
  r1,
  scopeFor,
  segName,
  sg,
  thinState,
  tsName,
  unitOf,
} from "@/lib/insights/util";
import { ASSOC, EARLY_NOTE, LG, SEG_NOTE, WHISKER, baseModel, chartBody, pick } from "./common";

const MEASURES: Outcome[] = ["dev", "big10", "x125"];
const MEASURE_OPTS = MEASURES.map((k) => ({ id: k, label: k === "dev" ? "Points" : k === "big10" ? "Big night +10" : "×1.25" }));

/** "about 0.6 more points" / "about 1.2 pp more likely a +10 night" */
function liftPhrase(o: Outcome, v: number, ctxWord: string): string {
  const more = v > 0;
  if (o === "dev") return `Players score about ${r1(v)} ${more ? "more" : "fewer"} points ${ctxWord}`;
  const what = o === "big10" ? "a +10 night" : o === "big5" ? "a +5 night" : "a ×1.25 night";
  return `${what[0].toUpperCase()}${what.slice(1)} is about ${r1(v)} points of chance ${more ? "more" : "less"} likely ${ctxWord}`;
}

function headlineFor(o: Outcome, row: ChartRow, ctxWord: string, unclearSubject: string): string {
  if (row.thin) return `Too few games to read ${unclearSubject}.`;
  const k = kindOf(row.lo!, row.hi!, 0);
  if (k === "flat") return `No clear change ${unclearSubject}: can’t be told from zero.`;
  return `${liftPhrase(o, row.est!, ctxWord)}, and the gap is clear.`;
}

const sampleLine = (rows: ChartRow[]) => `Sample per row — ${rows.filter((r) => r.n).map((r) => `${r.label}: ${r.n}`).join("; ")}.`;

/* ───────── defence tiers ───────── */
const NESTED: [string, string, string][] = [
  ["worst5", "Worst 5", "vs other 25"],
  ["worst10", "Worst 10", "vs other 20"],
  ["best10", "Best 10", "vs other 20"],
  ["best5", "Best 5", "vs other 25"],
];

export function defenceTiers(ctx: Ctx): CardModel {
  const { f, sel } = ctx;
  const cell = deepCell(ctx);
  const m = baseModel(ctx, "defence-tiers");
  const o = pick(sel.m, MEASURE_OPTS) as Outcome;
  const switches: SwitchSpec[] = [{ key: "m", value: o, options: MEASURE_OPTS }];
  if (isThinCell(cell) || !cell?.eff) return { ...m, switches, state: thinState(f, cell, "defence-tier contrasts"), scope: scopeFor(f, cell) };
  const rows = NESTED.map(([k, l, s]) => effRow(k, l, s, cell.eff?.[`opp_defence_nested:${k}`]?.[o], o));
  const head = rows[0];
  const verdict = head.thin ? "thin" : kindOf(head.lo!, head.hi!, 0);
  const u = unitOf(o);
  const spec: ChartSpec = {
    rows,
    base: 0,
    mark: "bar",
    axisTitle: u.axis,
    endL: o === "dev" ? "← fewer" : "← less likely",
    endR: o === "dev" ? "more →" : "more likely →",
    label: `Defence tier contrasts, ${OUT_LABEL[o]}`,
  };
  const b10 = rows[2];
  return {
    ...m,
    switches,
    verdict,
    headline: headlineFor(o, head, "against the 5 worst defences than against the other 25", "against the 5 worst defences"),
    scan: { value: head.thin ? "n/a" : head.valText!, unit: u.short },
    scope: scopeFor(f, cell),
    how: `Each bar compares games against a group of defences with games against everyone else. ${WHISKER}`,
    body: chartBody(spec),
    legend: LG.diff,
    facts: [
      { label: "Players", value: fmtN(cell.n_players) },
      { label: "Games", value: fmtN(cell.n_games) },
      { label: "Min games per side", value: "30" },
    ],
    sample: `n = ${fmtN(cell.n_games)} games`,
    caveats: [
      `${ASSOC} Defences are ranked on their season-to-date rating before tip-off, so everything is known pregame.`,
      sampleLine(rows),
      !b10.thin ? `Against the 10 best defences: ${b10.valText} ${u.short} (${b10.ciText}).` : "The best-10 contrast has too few games here.",
      "A contrast with under 30 games on either side is blanked, not shown.",
      ...(f.seg === "top25" || f.seg === "top10" ? [SEG_NOTE] : []),
      ...(EARLY(f.ts) || f.ts === "pooled_2023_27" ? [EARLY_NOTE] : []),
    ],
    method: "Contrast = mean (points above the player’s own prior average) in games against the tier minus all other games, or the change in the chance of a big night; 95% CI, rows under 30 games a side blanked.",
  };
}

/* ───────── opponent tiers ───────── */
const DEF_LADDER: [string, string, string][] = [
  ["worst5", "Worst 5", "ranks 26–30"],
  ["worst6_10", "Worst 6–10", "ranks 21–25"],
  ["__ref", "Middle", "ranks 11–20"],
  ["best6_10", "Best 6–10", "ranks 6–10"],
  ["best5", "Best 5", "ranks 1–5"],
];
const PACE_LADDER: [string, string, string][] = [
  ["fastest5", "Fastest 5", "ranks 1–5"],
  ["fast6_10", "Fast 6–10", "ranks 6–10"],
  ["__ref", "Middle", "ranks 11–20"],
  ["slow6_10", "Slow 6–10", "ranks 21–25"],
  ["slowest5", "Slowest 5", "ranks 26–30"],
];

export function oppTiers(ctx: Ctx): CardModel {
  const { f, sel } = ctx;
  const cell = deepCell(ctx);
  const m = baseModel(ctx, "opp-tiers");
  const o = pick(sel.m, MEASURE_OPTS) as Outcome;
  const ladderOpts = [
    { id: "def", label: "Defence rank" },
    { id: "pace", label: "Opponent pace" },
  ];
  const dim = pick(sel.s, ladderOpts);
  const switches: SwitchSpec[] = [
    { key: "m", value: o, options: MEASURE_OPTS },
    { key: "s", label: "Ladder", value: dim, options: ladderOpts },
  ];
  if (isThinCell(cell) || !cell?.eff) return { ...m, switches, state: thinState(f, cell, "tier contrasts"), scope: scopeFor(f, cell) };
  const prefix = dim === "def" ? "opp_defence_tier" : "opp_pace_tier";
  const ladder = dim === "def" ? DEF_LADDER : PACE_LADDER;
  const u = unitOf(o);
  const rows: ChartRow[] = ladder.map(([k, l, s]) =>
    k === "__ref" ? { key: k, label: l, sub: s, est: null, ref: true, valText: "ref" } : effRow(k, l, s, cell.eff?.[`${prefix}:${k}`]?.[o], o),
  );
  const head = rows[dim === "def" ? 0 : 0];
  const verdict = head.thin ? "thin" : kindOf(head.lo!, head.hi!, 0);
  const subject = dim === "def" ? "against the 5 worst defences" : "against the 5 fastest teams";
  const spec: ChartSpec = {
    rows,
    base: 0,
    mark: "bar",
    axisTitle: `${u.axis.replace(/\)$/, "")}, vs the middle ten)`.replace("(pts, vs", "(pts vs").replace("points, vs", "points vs"),
    endL: o === "dev" ? "← fewer" : "← less likely",
    endR: o === "dev" ? "more →" : "more likely →",
    label: `${dim === "def" ? "Defence" : "Pace"} tiers, ${OUT_LABEL[o]}`,
  };
  const other = (k: string) => effRow(k, k, undefined, cell.eff?.[k]?.[o], o);
  const fast = other("opp_pace_tier:fastest5");
  const slow = other("opp_pace_tier:slowest5");
  return {
    ...m,
    switches,
    verdict,
    headline: headlineFor(o, head, dim === "def" ? "against the 5 worst defences than the middle of the league" : "against the 5 fastest teams than the middle of the league", subject),
    scan: { value: head.thin ? "n/a" : head.valText!, unit: u.short },
    scope: scopeFor(f, cell),
    how: `Five steps from one end of the league to the other, each compared with the middle ten teams (the reference). ${WHISKER}`,
    body: chartBody(spec),
    legend: LG.diff,
    facts: [
      { label: "Players", value: fmtN(cell.n_players) },
      { label: "Games", value: fmtN(cell.n_games) },
      { label: "Min games per side", value: "30" },
    ],
    sample: `n = ${fmtN(cell.n_games)} games`,
    caveats: [
      `${ASSOC} Bars are contrasts with the middle of the league, not levels.`,
      "Why contrasts: the prior average runs a little high or low for different kinds of players, so the level of any one tier is partly an artefact. The gap between tiers carries the information.",
      sampleLine(rows),
      !fast.thin && !slow.thin
        ? `Pace, same cell: against the 5 fastest teams ${fast.valText} ${u.short} (${fast.ciText}); against the 5 slowest ${slow.valText} ${u.short} (${slow.ciText}).`
        : "The pace tiers have too few games here to quote.",
      "A contrast with under 30 games on either side is blanked, not shown.",
      ...(f.seg === "top25" || f.seg === "top10" ? [SEG_NOTE] : []),
      ...(EARLY(f.ts) || f.ts === "pooled_2023_27" ? [EARLY_NOTE] : []),
    ],
    method: "Each tier vs the ten middle-ranked teams on season-to-date defensive rating (or pace) before tip-off; mean points above the player’s own prior average, or the change in the chance of a big night; 95% CI.",
  };
}

/* ───────── stars vs everyone (by segment) ───────── */
export function stars(ctx: Ctx): CardModel {
  const { f, sel } = ctx;
  const m = baseModel(ctx, "stars");
  const o = pick(sel.m, MEASURE_OPTS) as Outcome;
  const grpOpts = [
    { id: "worst5", label: "Worst 5 defences" },
    { id: "best10", label: "Best 10 defences" },
  ];
  const g = pick(sel.s, grpOpts);
  const switches: SwitchSpec[] = [
    { key: "m", value: o, options: MEASURE_OPTS },
    { key: "s", label: "Defences", value: g, options: grpOpts },
  ];
  const u = unitOf(o);
  const rows: ChartRow[] = SEGMENT_ORDER.map((s) => {
    const c = ctx.data.deep.cells[f.ts]?.[s];
    const mark = s === f.seg;
    if (!c || c.thin || !c.eff) {
      return { key: s, label: segName(s), est: null, thin: true, thinTxt: c ? `too few games to rank (${fmtN(c.n_games)} player-games)` : "no cell: too few players", mark };
    }
    return effRow(s, segName(s), undefined, c.eff[`opp_defence_nested:${g}`]?.[o], o, { n: true, mark });
  });
  const top50 = rows.find((r) => r.key === "top50")!;
  const verdict = top50.thin ? "thin" : kindOf(top50.lo!, top50.hi!, 0);
  const vs = g === "worst5" ? "the 5 worst defences" : "the 10 best defences";
  const headline = top50.thin
    ? `Top 50 has too few games to read against ${vs} here.`
    : verdict === "flat"
      ? `Top 50 scorers show no clear change against ${vs}: can’t be told from zero.`
      : `${liftPhrase(o, top50.est!, `for the Top 50 against ${vs}`)}, and the gap is clear.`;
  const spec: ChartSpec = {
    rows,
    base: 0,
    mark: "bar",
    axisTitle: u.axis,
    endL: o === "dev" ? "← fewer" : "← less likely",
    endR: o === "dev" ? "more →" : "more likely →",
    label: `${g === "worst5" ? "Worst 5" : "Best 10"} defences by PPG segment, ${OUT_LABEL[o]}`,
  };
  return {
    ...m,
    switches,
    verdict,
    headline,
    scan: { value: top50.thin ? "n/a" : top50.valText!, unit: `${u.short}, Top 50` },
    scope: [tsName(f.ts), "every segment shown", `${segName(f.seg)} marked`],
    how: `Same contrast for each PPG segment, so you can see whether the biggest scorers behave differently. ${WHISKER}`,
    body: chartBody(spec),
    legend: LG.diff,
    facts: [
      { label: "Segments", value: String(rows.filter((r) => !r.thin).length) + " read" },
      { label: "Hatched", value: String(rows.filter((r) => r.thin).length) },
      { label: "Min games per side", value: "30" },
    ],
    sample: `${rows.filter((r) => !r.thin).length} of ${rows.length} segments read`,
    caveats: [
      `${ASSOC} Each segment is its own set of players, so rows overlap (Top 10 sits inside Top 50).`,
      sampleLine(rows),
      "Top 25 and Top 10 are never read: too few players. In 2026-27 the Top 50 is also too small so far.",
      SEG_NOTE,
      ...(EARLY(f.ts) || f.ts === "pooled_2023_27" ? [EARLY_NOTE] : []),
    ],
    method: "Worst 5 (or best 10) defences vs all other games, computed separately inside each PPG segment; 95% CI, rows under 30 games a side or cells under 30 players blanked.",
  };
}

/* ───────── season to season ───────── */
const SEASONS: TimespanKey[] = ["2023_24", "2024_25", "2025_26", "2026_27"];

export function stability(ctx: Ctx): CardModel {
  const { sel } = ctx;
  const m = baseModel(ctx, "stability");
  const grpOpts = [
    { id: "top50", label: "Top 50" },
    { id: "all", label: "All" },
  ];
  const grp = pick(sel.m, grpOpts) as SegmentKey;
  const o = pick(sel.s, MEASURE_OPTS) as Outcome;
  const switches: SwitchSpec[] = [
    { key: "m", value: grp, options: grpOpts },
    { key: "s", label: "Measure", value: o, options: MEASURE_OPTS },
  ];
  const u = unitOf(o);
  const rows: ChartRow[] = SEASONS.flatMap((ts) => {
    const c = ctx.data.deep.cells[ts]?.[grp];
    if (!c && ts === "2026_27") return [];
    const label = TIMESPAN_SWITCH_LABEL[ts];
    if (!c || c.thin || !c.eff) {
      return [{ key: ts, label, sub: ts === "2026_27" ? "early sample" : undefined, est: null, thin: true, thinTxt: c ? `too few games (${fmtN(c.n_games)} player-games)` : "no cell" } as ChartRow];
    }
    return [effRow(ts, label, ts === "2026_27" ? "early sample" : undefined, c.eff["opp_defence_nested:worst5"]?.[o], o)];
  });
  const full = rows.filter((r) => r.key !== "2026_27");
  const latest = rows.find((r) => r.key === "2025_26");
  const verdict = !latest || latest.thin ? "thin" : kindOf(latest.lo!, latest.hi!, 0);
  const nClear = full.filter((r) => !r.thin && kindOf(r.lo!, r.hi!, 0) === "up").length;
  const nRead = full.filter((r) => !r.thin).length;
  const first = full[0];
  const leansFirst = nRead === 3 && !first.thin && full.every((r) => r === first || r.thin || r.est! < first.est!);
  const headline =
    nRead === 0
      ? "No full season has enough games to read here."
      : `The gain against the 5 worst defences is clear in ${nClear} of ${nRead} full seasons${nClear > 0 && nClear < nRead ? ", so it isn’t steady" : nClear === 0 ? ": it never clears zero" : ": a steady edge"}.`;
  const spec: ChartSpec = {
    rows,
    base: 0,
    mark: "bar",
    axisTitle: `${u.axis.replace(/\)$/, "")}, 5 worst defences vs other 25)`,
    endL: o === "dev" ? "← fewer" : "← less likely",
    endR: o === "dev" ? "more →" : "more likely →",
    label: `${segName(grp)} by season, worst 5 defences, ${OUT_LABEL[o]}`,
  };
  const n3 = full.filter((r) => !r.thin).map((r) => `${r.label} ${r.valText}`);
  return {
    ...m,
    switches,
    verdict,
    headline,
    scan: { value: `${nClear}/${nRead}`, unit: "seasons clear" },
    scope: ["each season on its own", segName(grp), "worst 5 defences vs other 25"],
    pills: [{ text: "timespan n/a" }, ...(rows.some((r) => r.key === "2026_27") ? [{ text: "2026-27 early sample", hot: true }] : [])],
    how: `One bar per season, same contrast each time. If the sign or size keeps changing, the pooled number is not a steady edge. ${WHISKER}`,
    body: chartBody(spec),
    legend: LG.diff,
    facts: [
      { label: "Seasons read", value: String(nRead) },
      { label: "Clear", value: String(nClear) },
      { label: "Min games per side", value: "30" },
    ],
    sample: `${nRead} full seasons`,
    caveats: [
      `${ASSOC} Selected timespan is ignored: the rows are seasons.`,
      sampleLine(rows),
      nRead === 3 && o === "dev"
        ? `${segName(grp)}, worst 5 defences: ${n3.join(", ")} pts.${leansFirst ? " The pooled number leans on 2023-24, so don’t read it as a steady edge." : ""}`
        : "",
      ...(rows.some((r) => r.key === "2026_27") ? [EARLY_NOTE] : []),
    ].filter(Boolean),
    method: "Worst 5 defences vs the other 25 within each single season, same segment; 95% CI. The latest full season (2025-26) sets the card verdict.",
  };
}

/* ───────── role & position ───────── */
const MOD_LABEL: Record<string, string> = { C: "Centers", F: "Forwards", G: "Guards", starter: "Starters", bench: "Bench" };

export function rolePosition(ctx: Ctx): CardModel {
  const { f, sel } = ctx;
  const m = baseModel(ctx, "role-position");
  const mOpts = [
    { id: "dev", label: "Points" },
    { id: "x125", label: "×1.25 odds" },
  ];
  const o = pick(sel.m, mOpts) as "dev" | "x125";
  const switches: SwitchSpec[] = [{ key: "m", value: o, options: mOpts }];
  const inter = ctx.data.deep.interactions[f.ts];
  const pos = inter?.position;
  const role = inter?.role;
  if (!pos || !role) {
    return {
      ...m,
      switches,
      scope: scopeFor({ ...f, seg: "all" }).slice(0, 1),
      state: {
        kind: "thin",
        title: EARLY(f.ts) ? "Not enough games yet" : "Too few games to read",
        text: `No position or role split exists for ${tsName(f.ts)}: too few games. Nothing is drawn; we won’t guess.`,
        fixes: f.ts === "2026_27" ? [{ label: "Show 2025-26", ts: "2025_26" }] : [{ label: "Show 3 seasons", ts: "pooled_2023_26" }],
      },
    };
  }
  const mk = (mod: typeof pos | typeof role, k: string): ChartRow => {
    const x = (mod as Record<string, Record<string, { e: number | null; lo: number | null; hi: number | null; p: number | null; n: number }> | undefined>)[o]?.[k];
    if (!x || x.e == null || x.lo == null || x.hi == null) return { key: k, label: MOD_LABEL[k], est: null, thin: true, thinTxt: "not available" };
    return {
      key: k,
      label: MOD_LABEL[k],
      est: x.e,
      lo: x.lo,
      hi: x.hi,
      valText: o === "dev" ? sg(x.e) : `×${x.e.toFixed(2)}`,
      unit: o === "dev" ? "pts" : undefined,
      ciText: o === "dev" ? `${sg(x.lo)} to ${sg(x.hi)}` : `${x.lo.toFixed(2)} to ${x.hi.toFixed(2)}`,
      n: `${fmtN(x.n)} players`,
    };
  };
  const rows = [...["C", "F", "G"].map((k) => mk(pos, k)), ...["starter", "bench"].map((k) => mk(role, k))];
  const head = rows[0];
  const base = o === "dev" ? 0 : 1;
  const verdict = head.thin ? "thin" : kindOf(head.lo!, head.hi!, base);
  const pPos = pos.dev?.C?.p ?? null;
  const pRole = role.dev?.starter?.p ?? null;
  const pT = (p: number | null) => (p == null ? "n/a" : p < 0.001 ? "p < 0.001" : `p = ${p.toFixed(3)}`);
  const cE = pos.dev?.C?.e;
  const gE = pos.dev?.G?.e;
  const headline = head.thin
    ? "Too few centers to read the lift here."
    : verdict === "flat"
      ? "Centers’ lift against the 10 worst defences can’t be told from zero."
      : o === "dev"
        ? `Centers gain about ${r1(head.est!)} ${verdict === "up" ? "more" : "fewer"} points against the 10 worst defences, and the lift is clear.`
        : `Centers’ odds of a ×1.25 night against the 10 worst defences are ${head.est!.toFixed(2)} times the usual, and the rise is clear.`;
  const spec: ChartSpec = {
    rows,
    base,
    log: o === "x125",
    mark: o === "dev" ? "bar" : "dot",
    axisTitle: o === "dev" ? "Lift vs 10 worst defences (pts above prior avg)" : "Odds ratio of a ×1.25 night vs 10 worst defences",
    endL: o === "dev" ? "← less lift" : "← lower odds",
    endR: o === "dev" ? "more lift →" : "higher odds →",
    label: `Lift against the 10 worst defences by position and role, ${o === "dev" ? "points" : "odds ratio"}`,
  };
  const nPlayers = ["C", "F", "G"].reduce((a, k) => a + (pos.dev?.[k]?.n ?? 0), 0);
  return {
    ...m,
    switches,
    verdict,
    headline,
    scan: { value: head.thin ? "n/a" : head.valText!, unit: o === "dev" ? "pts, centers" : "odds, centers" },
    scope: [tsName(f.ts), "all players", `${fmtN(nPlayers)} players`],
    how: `Each bar is the lift against the 10 worst defences for one group of players, after the usual controls. ${WHISKER}`,
    body: chartBody(spec),
    legend: LG.diff,
    facts: [
      { label: "Players", value: fmtN(nPlayers) },
      { label: "Groups", value: "3 positions, 2 roles" },
    ],
    sample: `${fmtN(nPlayers)} players`,
    caveats: [
      `${ASSOC} These are adjusted associations, not reasons. Minutes and role go together, so the two splits overlap.`,
      cE != null && gE != null
        ? `Centers ${sg(cE)} pts vs guards ${sg(gE)}: the position gap ${pPos != null && pPos < 0.05 ? "is statistically clear" : "is not statistically clear"} (${pT(pPos)}${pos.x125?.C?.p != null ? `; ×1.25 odds ${pT(pos.x125.C.p)}` : ""}).`
        : "",
      role.dev?.starter?.e != null && role.dev?.bench?.e != null
        ? `Starters ${sg(role.dev.starter.e)} pts vs bench ${sg(role.dev.bench.e)}: the role gap ${pRole != null && pRole < 0.05 ? "is statistically clear" : "is not statistically clear"} (${pT(pRole)}).`
        : "",
      "Starter = started at least half of his prior games this season (tonight’s lineup isn’t known pregame).",
      sampleLine(rows),
      "Uses all players, so the PPG segment filter does not change it.",
      ...(EARLY(f.ts) || f.ts === "pooled_2023_27" ? [EARLY_NOTE] : []),
    ].filter(Boolean),
    method: "Interaction terms in the matchup model: the extra lift against the 10 worst defences for each position and role; 95% CI, p-value for the gap between levels.",
  };
}

