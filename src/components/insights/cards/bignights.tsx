import type { Outcome } from "@/lib/deepInsightsTypes";
import type { CardModel, ChartRow, ChartSpec, Ctx, SwitchSpec } from "@/lib/insights/types";
import {
  EARLY,
  deepCell,
  effRow,
  fmtN,
  isThinCell,
  kindOf,
  pctS,
  ppS,
  r1,
  scopeFor,
  sg,
  thinState,
  tsName,
  segName,
} from "@/lib/insights/util";
import { Chart } from "../Chart";
import { ASSOC, EARLY_NOTE, LG, SEG_NOTE, WHISKER, baseModel, chartBody, pick } from "./common";

type BN = "big5" | "big10" | "x125";
const BN_OPTS = [
  { id: "big10", label: "+10" },
  { id: "big5", label: "+5" },
  { id: "x125", label: "×1.25" },
];
const BN_LABEL: Record<BN, string> = { big5: "+5 over average", big10: "+10 over average", x125: "×1.25 average" };
const BN_PHRASE: Record<BN, string> = {
  big5: "scoring 5+ over his average",
  big10: "scoring 10+ over his average",
  x125: "scoring 1.25× his average or more",
};
const NIGHT: Record<BN, string> = { big5: "a +5 night", big10: "a +10 night", x125: "a ×1.25 night" };

/* ───────── situation (home / B2B big-night lines) ───────── */
export function situation(ctx: Ctx): CardModel {
  const { f, sel } = ctx;
  const cell = deepCell(ctx);
  const m = baseModel(ctx, "situation");
  const o = pick(sel.m, [BN_OPTS[0], BN_OPTS[2]]) as "big10" | "x125";
  const switches: SwitchSpec[] = [{ key: "m", value: o, options: [BN_OPTS[0], BN_OPTS[2]] }];
  if (isThinCell(cell) || !cell?.eff) return { ...m, switches, state: thinState(f, cell, "big-night rates by situation"), scope: scopeFor(f, cell) };
  const defs: [string, string][] = [
    ["venue:home", "Home vs away"],
    ["b2b_state:2nd", "B2B 2nd night"],
    ["b2b_state:1st", "B2B 1st night"],
  ];
  const rowFor = (k: string, l: string, out: Outcome): ChartRow => {
    const e = cell.eff?.[k]?.[out];
    const r = effRow(k, l, e && e.l != null && e.r != null ? `${pctS(e.l)} vs ${pctS(e.r)}` : undefined, e, out);
    return r;
  };
  const rows = defs.map(([k, l]) => rowFor(k, l, o));
  const head = rowFor("b2b_state:2nd", "B2B 2nd night", "x125");
  const verdict = head.thin ? "thin" : kindOf(head.lo!, head.hi!, 0);
  const headline = head.thin
    ? "Too few games to read big nights on a second night here."
    : verdict === "flat"
      ? "A ×1.25 night is no more or less likely on the second night of a back-to-back: can’t be told from zero."
      : `A ×1.25 night is about ${r1(head.est!)} points of chance ${verdict === "up" ? "more" : "less"} likely on a second night, and the gap is clear.`;
  const spec: ChartSpec = {
    rows,
    base: 0,
    mark: "bar",
    axisTitle: "Change in chance of a big night (percentage points)",
    endL: "← less likely",
    endR: "more likely →",
    label: `Big-night rates by situation, ${BN_LABEL[o]}`,
  };
  return {
    ...m,
    switches,
    verdict,
    headline,
    scan: { value: head.thin ? "n/a" : head.valText!, unit: "pp, B2B 2nd ×1.25" },
    scope: scopeFor(f, cell),
    how: `Each bar is the change in the chance of ${NIGHT[o]} in that situation versus the comparison games (left under each name: rate in the situation vs rate otherwise). ${WHISKER}`,
    body: chartBody(spec),
    legend: LG.diff,
    facts: [
      { label: "Players", value: fmtN(cell.n_players) },
      { label: "Games", value: fmtN(cell.n_games) },
      { label: "Min games per side", value: "30" },
    ],
    sample: `n = ${fmtN(cell.n_games)} games`,
    caveats: [
      `${ASSOC} A big night = ${BN_PHRASE[o]}; baseline is the player’s own prior average.`,
      `Sample per row — ${rows.filter((r) => r.n).map((r) => `${r.label}: ${r.n}`).join("; ")}.`,
      "Raw lifts like these shrink once other factors are held fixed; see “Tested, nothing there”.",
      "This card comes from the earlier deep-analysis study. The newer big-nights study (cards above) uses its own event definitions, eligibility and controls, so its figures differ.",
      ...(f.seg === "top25" || f.seg === "top10" ? [SEG_NOTE] : []),
      ...(EARLY(f.ts) || f.ts === "pooled_2023_27" ? [EARLY_NOTE] : []),
    ],
    method: "Rate of the event in the situation minus its rate in the other games (percentage points), 95% CI; contrasts with under 30 games on a side are blanked. The card verdict uses B2B 2nd night at ×1.25.",
  };
}

/* ───────── big-night odds ───────── */
const BN_DEF: [string, string, string][] = [
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

export function odds(ctx: Ctx): CardModel {
  const { f, sel, data } = ctx;
  const cell = deepCell(ctx);
  const m = baseModel(ctx, "odds");
  const o = pick(sel.m, BN_OPTS) as BN;
  const ladderOpts = [
    { id: "def", label: "Defence rank" },
    { id: "pace", label: "Opponent pace" },
  ];
  const dim = pick(sel.s, ladderOpts);
  const switches: SwitchSpec[] = [
    { key: "m", value: o, options: BN_OPTS },
    { key: "s", label: "Ladder", value: dim, options: ladderOpts },
  ];
  if (isThinCell(cell)) return { ...m, switches, state: thinState(f, cell, "big-night odds"), scope: scopeFor(f, cell) };
  const tail = cell!.tail?.[o];
  if (!tail) {
    return {
      ...m,
      switches,
      scope: scopeFor(f, cell),
      state: {
        kind: "thin",
        title: "Not fitted",
        text: `Not enough big nights in ${tsName(f.ts)} · ${segName(f.seg)} to fit the odds model for ${NIGHT[o]}. Nothing is drawn.`,
        fixes: f.seg !== "all" ? [{ label: "Show All", seg: "all" }] : [{ label: "Show 3 seasons", ts: "pooled_2023_26" }],
      },
    };
  }
  const terms = dim === "def" ? BN_DEF : BN_PACE;
  const rows: ChartRow[] = terms.map(([k, l, s]) => {
    if (k === "__ref") return { key: k, label: l, sub: s, est: null, ref: true, valText: "1" };
    const x = tail.terms[k];
    if (!x || x.or == null || x.lo == null || x.hi == null) return { key: k, label: l, sub: s, est: null, thin: true, thinTxt: "not fitted" };
    return { key: k, label: l, sub: s, est: x.or, lo: x.lo, hi: x.hi, valText: `×${x.or.toFixed(2)}`, ciText: `${x.lo.toFixed(2)} to ${x.hi.toFixed(2)}` };
  });
  const head = tail.terms.def_worst10;
  const headOk = head && head.or != null && head.lo != null && head.hi != null;
  const verdict = headOk ? kindOf(head.lo!, head.hi!, 1) : "thin";
  const headline = !headOk
    ? "The worst-10-defences term could not be fitted here."
    : verdict === "flat"
      ? `Against the 10 worst defences the odds of ${NIGHT[o]} can’t be told from the middle of the league (odds ratio ${head.or!.toFixed(2)}).`
      : `Against the 10 worst defences the odds of ${NIGHT[o]} are ${head.or!.toFixed(2)} times the middle teams’, and the ${verdict === "up" ? "rise" : "drop"} is clear.`;
  const spec: ChartSpec = {
    rows,
    base: 1,
    log: true,
    mark: "dot",
    axisTitle: "Odds ratio vs the middle ten (1 = no change)",
    endL: "← lower odds",
    endR: "higher odds →",
    label: `Odds ratios, ${BN_LABEL[o]}`,
  };
  const raw5 = cell!.eff?.["opp_defence_nested:worst5"]?.[o];
  const rawB10 = cell!.eff?.["opp_defence_nested:best10"]?.[o];
  const top50 = data.deep.cells[f.ts]?.top50?.tail?.big10?.terms.def_worst10;
  const ppLines = terms
    .filter(([k]) => k !== "__ref")
    .map(([k, l]) => {
      const x = tail.terms[k];
      return x && x.pp != null && x.pplo != null && x.pphi != null ? `${l}: ${ppS(x.pp)} pp (${ppS(x.pplo)} to ${ppS(x.pphi)})` : null;
    })
    .filter(Boolean);
  return {
    ...m,
    switches,
    verdict,
    headline,
    scan: { value: headOk ? `×${head.or!.toFixed(2)}` : "n/a", unit: "odds, worst 10" },
    scope: scopeFor(f, cell, tail.base != null ? [`base rate ${pctS(tail.base)}`] : []),
    how: `Each dot is how the odds of ${NIGHT[o]} change against that group of teams versus the ten middle teams, with other factors held fixed. 1 = no change. ${WHISKER}`,
    body: chartBody(spec),
    legend: ["up", "down", "flat", "thin", "whk", "bl"],
    facts: [
      { label: "Players", value: fmtN(cell!.n_players) },
      { label: "Games", value: fmtN(cell!.n_games) },
      { label: "Big nights", value: tail.events != null ? fmtN(tail.events) : "n/a" },
    ],
    sample: `n = ${fmtN(cell!.n_games)} games`,
    caveats: [
      `${ASSOC} Odds are adjusted for prior average, usage, minutes, role, position and how far into the season it is; home, back-to-back and the other tier terms sit in the same model.`,
      raw5 && raw5.l != null && raw5.r != null
        ? `Raw rates: ${BN_PHRASE[o]} happened in ${pctS(raw5.l)} of games against the 5 worst defences and ${pctS(raw5.r)} against the other 25${rawB10 && rawB10.l != null ? `, and ${pctS(rawB10.l)} against the 10 best` : ""}.`
        : "",
      ...(ppLines.length ? [`Change in the chance of ${NIGHT[o]} — ${ppLines.join("; ")}.`] : []),
      top50 && top50.or != null && top50.lo != null && top50.hi != null
        ? `Top 50, other conditions held fixed (+10): odds against the 10 worst defences are ${top50.or.toFixed(2)} times the middle (${top50.lo.toFixed(2)} to ${top50.hi.toFixed(2)})${top50.lo <= 1 && top50.hi >= 1 ? ", not clearly different from 1" : ""}.`
        : "",
      "This card comes from the earlier deep-analysis study. The newer big-nights study (cards above) uses its own event definitions, eligibility and controls, so its figures differ.",
      ...(f.seg === "top25" || f.seg === "top10" ? [SEG_NOTE] : []),
      ...(EARLY(f.ts) || f.ts === "pooled_2023_27" ? [EARLY_NOTE] : []),
    ].filter(Boolean),
    method: "Logistic model of the big-night event on the tier terms plus controls; odds ratios and the matching change in probability (pp) with 95% CIs from the fitted model.",
  };
}

/* ───────── how well the odds predict ───────── */
export function skill(ctx: Ctx): CardModel {
  const { f, sel, data } = ctx;
  const cell = deepCell(ctx);
  const m = baseModel(ctx, "skill");
  const o = pick(sel.m, BN_OPTS) as BN;
  const switches: SwitchSpec[] = [{ key: "m", value: o, options: BN_OPTS }];
  if (isThinCell(cell)) return { ...m, switches, state: thinState(f, cell, "model skill"), scope: scopeFor(f, cell) };
  const perf = cell!.perf?.[o];
  if (!perf || perf.auc == null) {
    return {
      ...m,
      switches,
      scope: scopeFor(f, cell),
      state: { kind: "thin", title: "Not fitted", text: `Too few big nights in ${tsName(f.ts)} · ${segName(f.seg)} to score the model on held-out games. Nothing is drawn.`, fixes: f.seg !== "all" ? [{ label: "Show All", seg: "all" }] : [{ label: "Show 3 seasons", ts: "pooled_2023_26" }] },
    };
  }
  const llOk = perf.ll != null && perf.llo != null && perf.lhi != null;
  const verdict = llOk ? kindOf(perf.llo!, perf.lhi!, 0) : "thin";
  const auc = data.deep.auc;
  const one = (key: string, label: string, est: number, base: number, lo: number | null, hi: number | null, val: string, ci: string | undefined, axisTitle: string, min?: number, max?: number): ChartSpec => ({
    rows: [{ key, label, est, lo, hi, valText: val, ciText: ci, neutral: lo == null }],
    base,
    mark: "dot",
    axisTitle,
    min,
    max,
    label,
  });
  const specs: ChartSpec[] = [
    one("auc", "AUC on held-out games", perf.auc, 0.5, null, null, perf.auc.toFixed(2), `${fmtN(perf.n_test)} test games`, "AUC (0.5 = coin flip, 1 = perfect)", 0.4, 0.7),
    ...(perf.slope != null ? [one("slope", "Calibration slope", perf.slope, 1, null, null, perf.slope.toFixed(2), "1.00 would be well calibrated", "Slope (1 = well calibrated)", 0, 1.5)] : []),
    ...(llOk ? [one("ll", "Log-loss gain vs base rate", perf.ll!, 0, perf.llo!, perf.lhi!, sg(perf.ll!, 4), `${sg(perf.llo!, 4)} to ${sg(perf.lhi!, 4)}`, "Gain over the base rate (0 = none)")] : []),
  ];
  const headline = `The odds are a weak predictor: AUC ${perf.auc.toFixed(2)} on held-out games, where 0.50 is a coin flip.`;
  return {
    ...m,
    switches,
    verdict,
    headline,
    scan: { value: perf.auc.toFixed(2), unit: "AUC" },
    scope: scopeFor(f, cell, [`${BN_LABEL[o]}`]),
    how: "Each gauge has its own baseline (dotted): 0.5 for AUC, 1 for the calibration slope, 0 for the log-loss gain. Only the log-loss gain carries a 95% range.",
    body: (
      <div className="gaugeStack" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {specs.map((s) => (
          <Chart key={s.label} spec={s} />
        ))}
      </div>
    ),
    legend: ["flat", "whk", "bl"],
    facts: [
      { label: "Test games", value: fmtN(perf.n_test) },
      { label: "AUC range, all fits", value: `${auc.min.toFixed(2)}–${auc.max.toFixed(2)}` },
      { label: "Model fits", value: String(auc.n) },
    ],
    sample: `${fmtN(perf.n_test)} held-out games`,
    caveats: [
      `Across all ${auc.n} model fits in non-thin cells AUC runs from ${auc.min.toFixed(2)} to ${auc.max.toFixed(2)}${auc.pooled_n > 0 ? `; in the 3-season pooled cells it is ${auc.pooled_min.toFixed(2)} to ${auc.pooled_max.toFixed(2)}` : ""}.`,
      perf.train != null && perf.test != null
        ? `The actual rate in the held-out window was ${pctS(perf.test)} against ${pctS(perf.train)} in training${perf.slope != null ? `, and the calibration slope is ${perf.slope.toFixed(2)}` : ""}: use the odds ratios to compare groups, not as forecasts of a night.`
        : "",
      "This card comes from the earlier deep-analysis study. The newer big-nights study (cards above) uses its own event definitions, eligibility and controls, so its figures differ.",
      llOk ? `Log-loss ${perf.ll! >= 0 ? "improves" : "worsens"} by ${Math.abs(perf.ll!).toFixed(4)} against the base rate (CI ${sg(perf.llo!, 4)} to ${sg(perf.lhi!, 4)})${perf.llo! <= 0 && perf.lhi! >= 0 ? ": no clear gain" : ""}.` : "",
      ...(EARLY(f.ts) || f.ts === "pooled_2023_27" ? [EARLY_NOTE] : []),
    ].filter(Boolean),
    method: "Model fitted on the earlier 80% of game dates and scored on the last 20%; AUC, calibration slope and log-loss against a base-rate-only forecast.",
  };
}
