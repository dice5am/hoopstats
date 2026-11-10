import type { BnCredible, BnEvent, BnStars } from "@/lib/bigNightsTypes";
import {
  BASELINE_OPTS,
  BASELINE_WORD,
  BN_EVENT_OPTS,
  BN_PROV,
  bnGate,
  ci2,
  countOf,
  evOf,
  factorLabel,
  liftOf,
  ppRow,
  ratioRow,
  ratioTxt,
  rates,
  rowVerdict,
} from "@/lib/insights/bn";
import { buildResponders, type PlayerConditionRow, type ResponderSource } from "@/lib/insights/responders";
import type { CardModel, ChartRow, ChartSpec, Ctx, SwitchSpec, Verdict } from "@/lib/insights/types";
import { EARLY, fixesFor, fmtN, kindOf, pctS, scopeFor, segName, sg, tsName } from "@/lib/insights/util";
import { Chart } from "../Chart";
import { ASSOC, LG, WHISKER, baseModel, chartBody, pick } from "./common";
import { CompareTable, ContextTable, Note, ShareBar, Sub, Tiles } from "./bnbodies";

const MEAS_OPTS = [
  { id: "or", label: "Odds, adjusted" },
  { id: "rr", label: "Risk, raw" },
];
const EV2 = BN_EVENT_OPTS.filter((e) => e.id === "x150" || e.id === "p10");
const early = (ctx: Ctx) => EARLY(ctx.f.ts) || ctx.f.ts === "pooled_2023_27";
const eventSwitch = (key: "m" | "s", value: string, opts = BN_EVENT_OPTS): SwitchSpec => ({ key, label: "Event", value, options: opts });
const MODEL_NOTE =
  "Adjusted = logistic regression with player-clustered standard errors, holding fixed log prior average, prior volatility, usage, minutes, season progress, start rate and position, plus the other pregame terms.";
const FLOOR_NOTE = "Players need a prior average of 8+ PPG, at least 5 prior games and at least 5 minutes played.";

const prov = (ctx: Ctx) => (early(ctx) ? [BN_PROV] : []);
const caveat = (ctx: Ctx, i: number) => ctx.data.bn.caveats[i];

/** Standard facts tiles from the event count. */
const countFacts = (ctx: Ctx, ev: BnEvent) => {
  const c = countOf(ctx.data.bn, ctx.f.ts, ctx.f.seg, ev)!;
  return [
    { label: "Players", value: fmtN(c.n_players) },
    { label: "Player-games", value: fmtN(c.n_games) },
    { label: `${evOf(ev).label} nights`, value: fmtN(c.n_events) },
  ];
};

const flagOf = (f: string | null): "watch" | "strong" | null => (f?.includes("strong") ? "strong" : f?.includes("watch") ? "watch" : null);

function credibleToRows(list: BnCredible[]): PlayerConditionRow[] {
  return list.map((c) => ({
    player_id: c.id,
    name: c.name,
    est: c.sh,
    lo: c.lo,
    hi: c.hi,
    unit: "pp" as const,
    n_cond: c.nc,
    n_ref: c.nr,
    flag: flagOf(c.flag),
    held_out: null,
  }));
}

/** Credible players for an analysis + outcome. Hidden (empty) for 2026-27: Data's rule. */
const credFor = (ctx: Ctx, an: BnCredible["an"], out: string) => (ctx.data.bn.credible[ctx.f.ts] ?? []).filter((c) => c.an === an && c.out === out);

function hiddenResponders(ctx: Ctx, cond: string): ResponderSource | null {
  if (ctx.f.ts !== "2026_27") return null;
  return { kind: "ready", set: { condition: cond, positive: [], negative: [], note: "Per-player flags are hidden for 2026-27: too few games per player yet." } };
}

/* ───────── 1. teammates out ───────── */
const VAC_ROWS: [string, string][] = [
  ["vac_large", "Regulars out: 20+ PPG combined"],
  ["vac_med", "Regulars out: 10–20 PPG"],
  ["vac_small", "Regulars out: under 10 PPG"],
  ["out_top1", "Top scorer out"],
];

export function teammatesOut(ctx: Ctx): CardModel {
  const { f, sel, data } = ctx;
  const bn = data.bn;
  const m = baseModel(ctx, "teammates-out");
  const meas = pick(sel.m, MEAS_OPTS) as "or" | "rr";
  const ev = evOf(pick(sel.s, BN_EVENT_OPTS));
  const switches: SwitchSpec[] = [{ key: "m", label: "Measure", value: meas, options: MEAS_OPTS }, eventSwitch("s", ev.id)];
  const g = bnGate(ctx, ev.id, "teammates-out");
  if (g.state) return { ...m, switches, state: g.state, scope: scopeFor(f, g.count) };
  const L = (k: string) => liftOf(bn, f.ts, f.seg, "std", ev.id, k);
  const rows: ChartRow[] = VAC_ROWS.map(([k, l]) => ratioRow(k, l, L(k), meas, { sub: rates(L(k)) }));
  const lead = L("vac_large");
  const lr = ratioRow("vac_large", "", lead, "or");
  const verdict: Verdict = rowVerdict(lr, 1);
  const headline =
    verdict === "thin" || !lead || lead.or == null
      ? "Too few games with regulars out to read this here."
      : verdict === "flat"
        ? `With regulars averaging 20+ PPG combined out, ${ev.night} is associated with odds that can’t be told from usual once other factors are held fixed (odds ratio ${lead.or.toFixed(2)}).`
        : `With regulars averaging 20+ PPG combined out, ${ev.night} is associated with ${lead.or.toFixed(2)} times the odds (${ci2(lead.orl!, lead.orh!)}) once other factors are held fixed. Raw risk ratio ${lead.rr!.toFixed(2)}.`;
  const spec: ChartSpec = {
    rows,
    base: 1,
    log: true,
    mark: "dot",
    axisTitle: meas === "or" ? "Odds ratio, adjusted (1 = no change)" : "Risk ratio, raw (1 = no change)",
    endL: "← less likely",
    endR: "more likely →",
    label: `Teammates out, ${meas === "or" ? "adjusted odds ratio" : "risk ratio"}, ${ev.label}`,
  };
  const ppTxt = lead && lead.pp != null ? `Adjusted change in the chance of ${ev.night} with 20+ PPG out: ${sg(lead.pp, 1)} pp (${sg(lead.ppl!, 1)} to ${sg(lead.pph!, 1)}).` : "";
  return {
    ...m,
    switches,
    verdict,
    headline,
    scan: { value: lead?.or != null && verdict !== "thin" ? ratioTxt(lead.or) : "n/a", unit: "adj. odds, 20+ PPG out" },
    scope: scopeFor(f, g.count, [BASELINE_WORD.std.replace("his ", "")]),
    how: `Each dot compares games with that teammate group out to games without (left under each name: rate with vs without). 1 = no change; the whisker is the 95% range. Wording is “associated with”: ${ASSOC.toLowerCase()}`,
    body: chartBody(spec),
    legend: ["up", "down", "flat", "thin", "whk", "bl"],
    facts: countFacts(ctx, ev.id),
    sample: `n = ${fmtN(g.count!.n_games)} player-games`,
    caveats: [caveat(ctx, 0), caveat(ctx, 2), ppTxt, ...prov(ctx)].filter(Boolean),
    method: `Risk ratio = rate of the event with the condition ÷ rate without (raw, 95% CI, clustered by player). ${MODEL_NOTE} Baseline: season-to-date average (std). ${FLOOR_NOTE}`,
  };
}

/* ───────── 2. no bounce-back ───────── */
export function bounceBack(ctx: Ctx): CardModel {
  const { f, sel, data } = ctx;
  const bn = data.bn;
  const m = baseModel(ctx, "bounce-back");
  const meas = pick(sel.m, MEAS_OPTS) as "or" | "rr";
  const ev = evOf(pick(sel.s, BN_EVENT_OPTS));
  const switches: SwitchSpec[] = [{ key: "m", label: "Measure", value: meas, options: MEAS_OPTS }, eventSwitch("s", ev.id)];
  const g = bnGate(ctx, ev.id, "bounce-back");
  if (g.state) return { ...m, switches, state: g.state, scope: scopeFor(f, g.count) };
  const L = (k: string) => liftOf(bn, f.ts, f.seg, "std", ev.id, k);
  const defs: [string, string][] = [
    ["bb_last1", "Last game weak"],
    ["bb_last2", "Last 2 games weak"],
    ["bb_l3mean", "Last-3 average weak"],
  ];
  const rows = defs.map(([k, l]) => ratioRow(k, l, L(k), meas, { sub: rates(L(k)) }));
  const lead = L("bb_last1");
  const ar = ratioRow("bb_last1", "", lead, "or");
  const verdict = rowVerdict(ar, 1);
  const rawTxt = lead && lead.rr != null ? ` Raw risk ratio ${lead.rr.toFixed(2)} (${ci2(lead.rrl!, lead.rrh!)}).` : "";
  const headline =
    verdict === "thin" || !lead || lead.or == null
      ? "Too few games after a weak game to read this here."
      : verdict === "flat"
        ? `There is no bounce-back: after a weak game, ${ev.night} is not more likely. Adjusted odds ratio ${lead.or.toFixed(2)} (${ci2(lead.orl!, lead.orh!)}), not clearly different from 1.${rawTxt}`
        : verdict === "down"
          ? `There is no bounce-back: after a weak game, ${ev.night} is less likely, not more (adjusted odds ratio ${lead.or.toFixed(2)}, ${ci2(lead.orl!, lead.orh!)}).`
          : `After a weak game, ${ev.night} is more likely here (adjusted odds ratio ${lead.or.toFixed(2)}, ${ci2(lead.orl!, lead.orh!)}). This view shows a bounce-back.`;
  const spec: ChartSpec = {
    rows,
    base: 1,
    log: true,
    mark: "dot",
    axisTitle: meas === "or" ? "Odds ratio, adjusted (1 = no change)" : "Risk ratio, raw (1 = no change)",
    endL: "← less likely",
    endR: "more likely →",
    label: `After a weak game, ${meas === "or" ? "adjusted odds ratio" : "risk ratio"}, ${ev.label}`,
  };
  const ps = data.bn.players[f.ts]?.bounce_back_last1?.[`${ev.id === "p10" ? "p10" : ev.id === "z15" ? "z15" : "x150"}_std`];
  return {
    ...m,
    switches,
    verdict,
    headline,
    scan: { value: lead?.or != null && verdict !== "thin" ? ratioTxt(lead.or) : "n/a", unit: "adj. odds after a weak game" },
    scope: scopeFor(f, g.count, ["season average"]),
    how: `A weak game is one below 0.75× his average (two in a row, or last-3 average, in the other rows). Each dot is how ${ev.night} changes in the next game versus all other games. 1 = no change. ${WHISKER}`,
    body: chartBody(spec),
    legend: ["up", "down", "flat", "thin", "whk", "bl"],
    facts: countFacts(ctx, ev.id),
    sample: `n = ${fmtN(g.count!.n_games)} player-games`,
    caveats: [
      `${ASSOC} Raw rates fall after a weak game (the weak game itself signals a lower role or form); adjusted, the change is small or absent.`,
      ps ? `Per player: ${ps.n_credible_above_league} players credibly bounce back and ${ps.n_credible_below_league} credibly fall; ${ps.n_abs_z_ge_2_5} flagged at |z| ≥ 2.5 against ${ps.expected_abs_z_ge_2_5_by_chance.toFixed(1)} expected by chance.` : "",
      ...prov(ctx),
    ].filter(Boolean),
    method: `Weak game: points below 0.75× his season-to-date average in the previous game (std baseline). ${MODEL_NOTE} ${FLOOR_NOTE}`,
  };
}

/* ───────── 3. hot game: a stale average ───────── */
const STALE: [string, string][] = [
  ["hot_last1", "Hot last game"],
  ["min_up3", "Minutes up 3+"],
  ["role_promoted", "Promoted role"],
];

export function staleAverage(ctx: Ctx): CardModel {
  const { f, sel, data } = ctx;
  const bn = data.bn;
  const m = baseModel(ctx, "stale-average");
  const bl = pick(sel.m, BASELINE_OPTS) as "std" | "l10";
  const ev = evOf(pick(sel.s, BN_EVENT_OPTS));
  const switches: SwitchSpec[] = [{ key: "m", label: "Average", value: bl, options: BASELINE_OPTS }, eventSwitch("s", ev.id)];
  const g = bnGate(ctx, ev.id, "the stale-average signal");
  if (g.state) return { ...m, switches, state: g.state, scope: scopeFor(f, g.count) };
  const Ls = (k: string) => liftOf(bn, f.ts, f.seg, "std", ev.id, k);
  const Ll = (k: string) => liftOf(bn, f.ts, f.seg, "l10", ev.id, k);
  const L = bl === "std" ? Ls : Ll;
  const rows = STALE.map(([k, l]) => ratioRow(k, l, L(k), "rr", { sub: rates(L(k)) }));
  const a = ratioRow("hot_last1", "", Ls("hot_last1"), "rr");
  const b = ratioRow("hot_last1", "", Ll("hot_last1"), "rr");
  const cur = bl === "std" ? a : b;
  const ok = !a.thin && !b.thin && a.est != null && b.est != null;
  const lost = ok && a.est! > 1 ? Math.round((1 - (b.est! - 1) / (a.est! - 1)) * 100) : null;
  const headline = !ok
    ? "Too few games after a hot game to compare the two averages here."
    : `A hot last game goes with a ×${a.est!.toFixed(2)} risk of ${ev.night} against his season average, but ×${b.est!.toFixed(2)} against his last-10 average${lost != null && lost > 0 ? `: about ${lost}% of the lift is a stale average, not new information` : ""}.`;
  const spec: ChartSpec = {
    rows,
    base: 1,
    log: true,
    mark: "dot",
    axisTitle: `Risk ratio vs ${bl === "std" ? "season" : "last-10"} average (1 = no change)`,
    endL: "← less likely",
    endR: "more likely →",
    label: `Stale-average signals, risk ratio, ${BASELINE_WORD[bl]}, ${ev.label}`,
  };
  const cmpRows: [string, string, string][] = STALE.map(([k, l]) => {
    const x = ratioRow(k, l, Ls(k), "rr");
    const y = ratioRow(k, l, Ll(k), "rr");
    return [l, x.thin ? "too few" : `${x.valText} (${x.ciText})`, y.thin ? "too few" : `${y.valText} (${y.ciText})`];
  });
  return {
    ...m,
    switches,
    verdict: "info",
    badgeText: "Stale average",
    headline,
    scan: { value: ok ? `×${a.est!.toFixed(2)} → ×${b.est!.toFixed(2)}` : "n/a", unit: "hot game: season → last 10" },
    scope: scopeFor(f, g.count, [BASELINE_WORD[bl].replace("his ", "")]),
    how: `Same games, two yardsticks for “a big night”. Against the season-to-date average a hot or promoted player looks likelier to explode; against his own last 10 the lift mostly goes. Flip “Average” to see it. ${WHISKER}`,
    body: (
      <>
        <Chart spec={spec} />
        <Sub>Both averages side by side · risk ratio (95% range)</Sub>
        <CompareTable head={["", "Season average", "Last 10 games"]} rows={cmpRows} />
      </>
    ),
    legend: ["up", "down", "flat", "thin", "whk", "bl"],
    facts: countFacts(ctx, ev.id),
    sample: `n = ${fmtN(g.count!.n_games)} player-games`,
    caveats: [
      caveat(ctx, 1),
      cur.thin ? "" : `Current view: risk ratio ${cur.valText} (${cur.ciText}) for a hot last game against ${BASELINE_WORD[bl]}. A small residual can remain after the toggle; do not read it as a streak.`,
      ASSOC,
      ...prov(ctx),
    ].filter(Boolean),
    method: `Risk ratio = rate of the event after the condition ÷ rate otherwise (raw, 95% CI, clustered by player). The event is relative to the chosen average: season-to-date (std) or last up-to-10 prior games (l10). Hot = last game ≥ 1.25× average. ${FLOOR_NOTE}`,
  };
}

/* ───────── 4. role change in progress ───────── */
const ROLE: [string, string][] = [
  ["role_promoted", "Promoted to starter"],
  ["min_up3", "Minutes up 3+"],
  ["role_demoted", "Moved out of the five"],
  ["min_dn3", "Minutes down 3+"],
];

export function roleChange(ctx: Ctx): CardModel {
  const { f, sel, data } = ctx;
  const bn = data.bn;
  const m = baseModel(ctx, "role-change");
  const bl = pick(sel.m, BASELINE_OPTS) as "std" | "l10";
  const ev = evOf(pick(sel.s, BN_EVENT_OPTS));
  const switches: SwitchSpec[] = [{ key: "m", label: "Average", value: bl, options: BASELINE_OPTS }, eventSwitch("s", ev.id)];
  const g = bnGate(ctx, ev.id, "role-change flags");
  if (g.state) return { ...m, switches, state: g.state, scope: scopeFor(f, g.count) };
  const L = (k: string, b: "std" | "l10" = bl) => liftOf(bn, f.ts, f.seg, b, ev.id, k);
  const rows = ROLE.map(([k, l]) => ppRow(k, l, L(k), { sub: rates(L(k)) }));
  const lead = ppRow("role_promoted", "", L("role_promoted"));
  const verdict = rowVerdict(lead, 0);
  const sd = ppRow("role_promoted", "", L("role_promoted", "std"));
  const ld = ppRow("role_promoted", "", L("role_promoted", "l10"));
  const headline =
    verdict === "thin"
      ? "Too few promoted players in this view to read the role-change flag."
      : `A player just promoted to the starting five has ${lead.est! >= 0 ? "a" : "a"} ${sg(lead.est!, 1)} pp ${lead.est! >= 0 ? "higher" : "lower"} chance of ${ev.night} against ${BASELINE_WORD[bl]}, ${verdict === "flat" ? "but the range includes zero" : "and the range excludes zero"}.`;
  const spec: ChartSpec = {
    rows,
    base: 0,
    mark: "bar",
    axisTitle: "Adjusted change in chance of a big night (percentage points)",
    endL: "← less likely",
    endR: "more likely →",
    label: `Role-change flags, adjusted change, ${BASELINE_WORD[bl]}, ${ev.label}`,
  };
  return {
    ...m,
    switches,
    verdict,
    badgeText: verdict === "up" ? "▲ Context flag" : undefined,
    headline,
    scan: { value: verdict === "thin" ? "n/a" : lead.valText!, unit: "pp, promoted" },
    scope: scopeFor(f, g.count, [BASELINE_WORD[bl].replace("his ", "")]),
    how: `Recent promotion to the starting five, or last-5 minutes 3+ above the season average, goes with a higher big-night rate when the average is out of date. Context for a player whose average lags, not a forecast. Bars are adjusted percentage points. ${WHISKER}`,
    body: (
      <>
        <Chart spec={spec} />
        <Sub>Promoted to starter · both averages, adjusted pp</Sub>
        <CompareTable head={["", "Season average", "Last 10 games"]} rows={[["Adjusted change", sd.thin ? "too few" : `${sd.valText} pp (${sd.ciText})`, ld.thin ? "too few" : `${ld.valText} pp (${ld.ciText})`]]} />
      </>
    ),
    legend: LG.diff,
    facts: countFacts(ctx, ev.id),
    sample: `n = ${fmtN(g.count!.n_games)} player-games`,
    caveats: [
      sd.thin || ld.thin ? "" : `Promoted: ${sd.valText} pp against the season-to-date average, ${ld.valText} pp against the last-10 average. The last-10 average already includes much of the new role, so the lift shrinks.`,
      `${ASSOC} A role flag is context for a stale average, not a pregame forecast.`,
      ...prov(ctx),
    ].filter(Boolean),
    method: `${MODEL_NOTE} Promoted = moved into the starting five recently; minutes up/down = last-5 minutes ≥ 3 above/below the season average. ${FLOOR_NOTE}`,
  };
}

/* ───────── 5. defence & pace: small ───────── */
const TIER: [string, string][] = [
  ["def_worst10", "Opponent: worst-10 defence"],
  ["def_best10", "Opponent: best-10 defence"],
  ["pace_fast10", "Opponent: fastest-10 pace"],
  ["pace_slow10", "Opponent: slowest-10 pace"],
];

export function tiers(ctx: Ctx): CardModel {
  const { f, sel, data } = ctx;
  const bn = data.bn;
  const m = baseModel(ctx, "tiers");
  const ev = evOf(pick(sel.m, BN_EVENT_OPTS));
  const switches: SwitchSpec[] = [eventSwitch("m", ev.id)];
  const g = bnGate(ctx, ev.id, "defence and pace effects");
  if (g.state) return { ...m, switches, state: g.state, scope: scopeFor(f, g.count) };
  const L = (k: string) => liftOf(bn, f.ts, f.seg, "std", ev.id, k);
  const rows = TIER.map(([k, l]) => ppRow(k, l, L(k), { sub: rates(L(k)) }));
  const lead = rows[0];
  const verdict = rowVerdict(lead, 0);
  const top50 = liftOf(bn, f.ts, "top50", "std", ev.id, "def_worst10");
  const t50 = top50 && !top50.thin && top50.or != null ? ratioRow("t50", "", top50, "or") : null;
  const headline =
    verdict === "thin"
      ? "Too few games to read defence and pace here."
      : verdict === "flat"
        ? `Against the 10 worst defences the chance of ${ev.night} is ${sg(lead.est!, 1)} pp, which can’t be told from zero.`
        : `Against the 10 worst defences the chance of ${ev.night} is ${sg(lead.est!, 1)} pp ${lead.est! > 0 ? "higher" : "lower"}: clear, but small.`;
  const spec: ChartSpec = {
    rows,
    base: 0,
    mark: "bar",
    axisTitle: "Adjusted change in chance of a big night (percentage points)",
    endL: "← less likely",
    endR: "more likely →",
    label: `Defence and pace, adjusted change, ${ev.label}`,
  };
  return {
    ...m,
    switches,
    verdict,
    headline,
    scan: { value: verdict === "thin" ? "n/a" : lead.valText!, unit: "pp, worst-10 defence" },
    scope: scopeFor(f, g.count, ["season average"]),
    how: `Adjusted change in the chance of ${ev.night} against that group of teams versus the other 20. The effects are small: read the size next to the whisker. ${WHISKER}`,
    body: chartBody(spec),
    legend: LG.diff,
    facts: countFacts(ctx, ev.id),
    sample: `n = ${fmtN(g.count!.n_games)} player-games`,
    caveats: [
      "Not “stars feast on bad defences”: the effects are about one percentage point. Elite defences are the more reliable signal (fewer big nights).",
      t50 && t50.est != null ? `Top 50 (same event, other factors held fixed): worst-10 defences odds ratio ${t50.est.toFixed(2)} (${t50.ciText})${t50.lo! <= 1 && t50.hi! >= 1 ? ", not credible, and unstable by season" : ""}.` : "",
      ASSOC,
      ...prov(ctx),
    ].filter(Boolean),
    method: `${MODEL_NOTE} Defence and pace tiers are the opponent’s ranks before the game (best/worst 10 of 30 teams). ${FLOOR_NOTE}`,
  };
}

/* ───────── 6. tested, nothing there ───────── */
const NOSIG: [string, string][] = [
  ["home", "Home vs away"],
  ["b2b_2nd", "2nd night of a back-to-back"],
  ["b2b_1st", "1st night of a back-to-back"],
  ["opp_leaky_l5", "Opponent’s recent defence (last 5)"],
  ["opp_vac_ge10", "Opponent missing 10+ PPG"],
  ["cup_game", "NBA Cup game"],
  ["phase_late", "Late season"],
];

export function noSignal(ctx: Ctx): CardModel {
  const { f, sel, data } = ctx;
  const bn = data.bn;
  const m = baseModel(ctx, "no-signal");
  const ev = evOf(pick(sel.m, BN_EVENT_OPTS));
  const switches: SwitchSpec[] = [eventSwitch("m", ev.id)];
  const g = bnGate(ctx, ev.id, "the nothing-there list");
  if (g.state) return { ...m, switches, state: g.state, scope: scopeFor(f, g.count) };
  const L = (k: string) => liftOf(bn, f.ts, f.seg, "std", ev.id, k);
  const rows = NOSIG.map(([k, l]) => ratioRow(k, l, L(k), "or", { sub: rates(L(k)) }));
  const read = rows.filter((r) => !r.thin);
  const clear = read.filter((r) => kindOf(r.lo!, r.hi!, 1) !== "flat");
  const verdict: Verdict = read.length === 0 ? "thin" : clear.length === 0 ? "flat" : "info";
  const rest = (["rest_r0", "rest_r2", "rest_r3plus"] as const).map((k) => ({ k, r: ratioRow(k, k, L(k), "rr") })).filter((x) => !x.r.thin);
  const lateRaw = L("phase_late");
  const b2bRaw = L("b2b_2nd");
  const headline =
    verdict === "thin"
      ? "Too few games to read these conditions here."
      : clear.length === 0
        ? `Once other factors are held fixed, none of these ${read.length} conditions has a clear effect on ${ev.night}: every range includes 1.`
        : `${clear.length} of ${read.length} conditions has a clear adjusted effect on ${ev.night} here (${clear.map((r) => r.label.toLowerCase()).join(", ")}); the rest can’t be told from no change.`;
  const spec: ChartSpec = {
    rows,
    base: 1,
    log: true,
    mark: "dot",
    axisTitle: "Odds ratio, adjusted (1 = no change)",
    endL: "← less likely",
    endR: "more likely →",
    label: `Conditions with no credible effect, adjusted odds ratio, ${ev.label}`,
    variant: "detail",
  };
  return {
    ...m,
    switches,
    verdict,
    headline,
    scan: { value: verdict === "thin" ? "n/a" : `${clear.length} of ${read.length}`, unit: "clear after adjusting" },
    scope: scopeFor(f, g.count, ["season average"]),
    how: `Each dot is a condition people expect to matter, after holding the other factors fixed. When the whisker crosses the dotted line at 1, the condition did not move ${ev.night} measurably. ${WHISKER}`,
    body: chartBody(spec),
    legend: LG.diff,
    facts: countFacts(ctx, ev.id),
    sample: `n = ${fmtN(g.count!.n_games)} player-games`,
    caveats: [
      lateRaw && b2bRaw && lateRaw.pp != null && b2bRaw.pp != null
        ? `Raw lifts can mislead: late season ×${lateRaw.rr!.toFixed(2)} and a second night ×${b2bRaw.rr!.toFixed(2)} (risk ratio) mostly disappear after adjusting.`
        : "",
      rest.length ? `Rest days have no adjusted fit; raw risk ratios: ${rest.map((x) => `${x.k.replace("rest_r", "").replace("plus", "+")} days ×${x.r.est!.toFixed(2)} (${x.r.ciText})`).join("; ")}.` : "",
      "“Nothing there” means nothing credible here, not proven zero: ranges are the honest size of what could still hide.",
      caveat(ctx, 8),
      ...prov(ctx),
    ].filter(Boolean),
    method: `${MODEL_NOTE} Rows with fewer than 30 players or 300 player-games at a level are hatched. ${FLOOR_NOTE}`,
  };
}

/* ───────── 7. stars vs everyone ───────── */
const SVO_VIEWS = [
  { id: "rates", label: "Base rates" },
  { id: "effects", label: "Effects" },
  { id: "interact", label: "Form" },
];

export function starsVsOthers(ctx: Ctx): CardModel {
  const { f, sel, data } = ctx;
  const bn = data.bn;
  const m = baseModel(ctx, "stars-vs-others");
  const ev = evOf(pick(sel.m, BN_EVENT_OPTS));
  const view = pick(sel.s, SVO_VIEWS);
  const switches: SwitchSpec[] = [eventSwitch("m", ev.id), { key: "s", label: "View", value: view, options: SVO_VIEWS }];
  const def = f.seg === "all" ? "top50" : f.seg;
  const block: BnStars | undefined = bn.stars[f.ts]?.[def];
  const br = block?.base_rates?.[ev.id];
  const starName = segName(def);
  const scopeX = [`stars = ${starName}${f.seg === "all" ? " (default)" : ""}`];
  if (!block || !br) return { ...m, switches, state: { kind: "thin", title: "No cell for this view", text: `The study has no star comparison for ${tsName(f.ts)} · ${starName}. Nothing is drawn.`, fixes: fixesFor(f) }, scope: scopeFor(f) };
  if (br.star.thin || br.non_star.thin || def === "top25" || def === "top10") {
    return {
      ...m,
      switches,
      scope: scopeFor(f, undefined, scopeX),
      state: {
        kind: "thin",
        title: `${starName} is always too small to read`,
        text: `${fmtN(br.star.n_players)} ${starName} players, ${fmtN(br.star.n_games)} player-games, ${fmtN(br.star.n_events)} ${ev.label} nights (${pctS(br.star.value)}). Counts only: a star group this small is never ranked or compared.`,
        fixes: fixesFor(f),
      },
    };
  }
  const x150 = block.base_rates.x150.difference_star_minus_non_star;
  const p10 = block.base_rates.p10.difference_star_minus_non_star;
  const d = br.difference_star_minus_non_star;
  const dk = d.ci ? kindOf(d.ci[0], d.ci[1], 0) : "flat";
  const verdict: Verdict = d.ci ? dk : "thin";
  const flips = x150.ci && p10.ci && kindOf(x150.ci[0], x150.ci[1], 0) !== kindOf(p10.ci[0], p10.ci[1], 0) && kindOf(x150.ci[0], x150.ci[1], 0) !== "flat" && kindOf(p10.ci[0], p10.ci[1], 0) !== "flat";
  const headline = `${starName} players reach ${ev.night} in ${pctS(br.star.value)} of games against ${pctS(br.non_star.value)} for everyone else (${sg(d.value * 100, 1)} pp)${flips ? `. The answer flips with the cut (×1.5: ${sg(x150.value * 100, 1)} pp, +10: ${sg(p10.value * 100, 1)} pp): say which definition.` : "."}`;
  const rateRow = (key: string, label: string, r: typeof br.star): ChartRow => ({
    key,
    label,
    est: r.value * 100,
    lo: r.ci?.[0] != null ? r.ci[0] * 100 : null,
    hi: r.ci?.[1] != null ? r.ci[1] * 100 : null,
    valText: `${(r.value * 100).toFixed(1)}%`,
    ciText: r.ci ? `${(r.ci[0] * 100).toFixed(1)} to ${(r.ci[1] * 100).toFixed(1)}` : undefined,
    n: `${fmtN(r.n_players)} players · ${fmtN(r.n_events)} events`,
    neutral: true,
  });
  let body: React.ReactNode;
  if (view === "rates") {
    const rate: ChartSpec = {
      rows: [rateRow("star", starName, br.star), rateRow("non", "Everyone else", br.non_star)],
      base: 0,
      mark: "dot",
      min: 0,
      floor: 0,
      tickFmt: (t) => `${t}%`,
      axisTitle: `Share of player-games that are ${ev.label} nights (%)`,
      label: `Base rate of ${ev.label} nights, ${starName} vs everyone else`,
    };
    const diff: ChartSpec = {
      rows: [
        {
          key: "diff",
          label: `${starName} minus everyone else`,
          est: d.value * 100,
          lo: d.ci ? d.ci[0] * 100 : null,
          hi: d.ci ? d.ci[1] * 100 : null,
          valText: sg(d.value * 100, 1),
          unit: "pp",
          ciText: d.ci ? `${sg(d.ci[0] * 100, 1)} to ${sg(d.ci[1] * 100, 1)}` : undefined,
        },
      ],
      base: 0,
      mark: "bar",
      axisTitle: "Difference in base rate (percentage points)",
      endL: "← stars less often",
      endR: "stars more often →",
      label: "Difference in base rate",
    };
    body = (
      <>
        <Chart spec={rate} />
        <Sub>The gap</Sub>
        <Chart spec={diff} />
      </>
    );
  } else if (view === "effects") {
    const fc = block.factor_comparison[ev.id];
    if (!fc || fc.length === 0) {
      body = <Note>Too few star big nights at this cut to compare effects. Nothing is drawn.</Note>;
    } else {
      const rows: ChartRow[] = fc.map((r) => ({
        key: r.factor,
        label: factorLabel(bn, r.factor).replace(/^opponent /, "opp. ").replace(/^last /, "after last "),
        sub: `stars ×${r.star_rr.toFixed(2)} · others ×${r.non_star_rr.toFixed(2)}`,
        est: r.rr_ratio,
        lo: r.rr_ratio_ci[0],
        hi: r.rr_ratio_ci[1],
        valText: ratioTxt(r.rr_ratio),
        ciText: ci2(r.rr_ratio_ci[0], r.rr_ratio_ci[1]),
      }));
      body = chartBody({
        rows,
        base: 1,
        log: true,
        mark: "dot",
        axisTitle: "Stars’ lift ÷ everyone else’s lift (1 = same lift)",
        endL: "← stars gain less",
        endR: "stars gain more →",
        label: `Stars versus others: ratio of lifts, ${ev.label}`,
        variant: "compact",
      });
    }
  } else {
    const it = block.interaction_tests[ev.id];
    const terms = it?.significant_terms ?? [];
    if (!it) {
      body = <Note>Interaction tests are not available at this cut.</Note>;
    } else {
      const rows: ChartRow[] = terms.map((t) => ({
        key: t.factor,
        label: factorLabel(bn, t.factor).replace(/^opponent /, "opp. ").replace(/^last /, "after last "),
        sub: `stars OR ${t.star_or.toFixed(2)} · others ${t.non_star_or.toFixed(2)} · q ${t.q.toFixed(3)}`,
        est: t.interaction_or,
        lo: t.ci[0],
        hi: t.ci[1],
        valText: ratioTxt(t.interaction_or),
        ciText: ci2(t.ci[0], t.ci[1]),
      }));
      body = (
        <>
          {rows.length ? (
            chartBody({
              rows,
              base: 1,
              log: true,
              mark: "dot",
              axisTitle: "Interaction odds ratio, stars vs others (1 = same effect)",
              endL: "← weaker for stars",
              endR: "stronger for stars →",
              label: `Recent-form interactions, ${ev.label}`,
              variant: rows.length <= 5 ? "detail" : "compact",
            })
          ) : (
            <Note>No factor shows a different effect for stars at this cut once the false-discovery rate is held to 10%.</Note>
          )}
          <Note>
            {it.n_tests} factors tested: {it.n_p_lt_05} with p &lt; 0.05 against {it.expected_p_lt_05_by_chance.toFixed(1)} expected by chance; {it.n_q_lt_10} survive q &lt; 0.10. Recent-form terms (weak or hot last game) are the ones that differ most.
          </Note>
        </>
      );
    }
  }
  return {
    ...m,
    switches,
    verdict,
    headline,
    scan: { value: sg(d.value * 100, 1), unit: `pp, ${starName} vs others` },
    scope: scopeFor(f, undefined, [`${fmtN(br.star.n_players)} stars`, `${fmtN(br.non_star.n_players)} others`, ...scopeX]),
    how: `Stars are the ${starName} by points per game, picked before the games counted. “Base rates” compares how often each group has the night; “Effects” compares how much each condition lifts them; “Recent form” tests whether a weak or hot last game works differently for stars. ${WHISKER}`,
    body,
    legend: view === "rates" ? ["up", "down", "flat", "whk", "bl"] : ["up", "down", "flat", "whk", "bl"],
    facts: [
      { label: `${starName} players`, value: fmtN(br.star.n_players) },
      { label: "Star games", value: fmtN(br.star.n_games) },
      { label: "Star nights", value: fmtN(br.star.n_events) },
    ],
    sample: `n = ${fmtN(br.difference_star_minus_non_star.n_games)} player-games`,
    caveats: [
      "Star level and big-night level are linked: a bigger average makes a ×1.5 night rarer and a +10 night easier. That is why the two cuts can disagree.",
      "Defence-tier and teammates-out lifts are about the same ratio for stars and others; recent-form effects (weak or hot last game) show up for non-stars only.",
      `${ASSOC} Star membership uses training-period points ranks, so there is no look-ahead.`,
      ...prov(ctx),
    ],
    method: "Pooled segment comparison of base rates (difference in percentage points) and of risk ratios (stars’ ÷ others’), independent clusters; interaction = logistic with controls + factor + star + factor × star, player-clustered, Benjamini–Hochberg q within each cut.",
  };
}

/* ───────── 8. how the night happened ───────── */
export function howItHappened(ctx: Ctx): CardModel {
  const { f, sel, data } = ctx;
  const bn = data.bn;
  const m = baseModel(ctx, "how-it-happened");
  const ev = evOf(pick(sel.m, EV2));
  const switches: SwitchSpec[] = [eventSwitch("m", ev.id, EV2)];
  const g = bnGate(ctx, ev.id, "the same-game breakdown");
  if (g.state) return { ...m, switches, state: g.state, scope: scopeFor(f, g.count) };
  const p = bn.profile[f.ts]?.[f.seg]?.[ev.id];
  if (!p || p.big_night.share_minutes == null || p.big_night.share_shot_rate == null || p.big_night.share_efficiency == null) {
    return {
      ...m,
      switches,
      scope: scopeFor(f, g.count),
      state: {
        kind: "thin",
        title: "Not computed for this view",
        text: `The same-game breakdown exists for 3 seasons pooled and 2025-26, for All, Top 100 and Top 50. It was not computed for ${tsName(f.ts)} · ${segName(f.seg)}. Nothing is drawn.`,
        fixes: [{ label: "Show 3 seasons", ts: "pooled_2023_26" }, ...(f.seg !== "all" ? [{ label: "Show All", seg: "all" as const }] : [])],
      },
    };
  }
  const b = p.big_night;
  const o = p.other;
  const headline = `On a ${ev.label} night, about ${pctS(b.share_minutes!, 0)} of the extra points come from more minutes, ${pctS(b.share_shot_rate!, 0)} from more shots per minute and ${pctS(b.share_efficiency!, 0)} from better efficiency. It explains the night after it happens; it does not predict one.`;
  const tr = (label: string, bv: string, ov: string): [string, string, string] => [label, bv, ov];
  return {
    ...m,
    switches,
    verdict: "info",
    badgeText: "Explanation, not a forecast",
    headline,
    scan: { value: pctS(b.share_minutes!, 0), unit: "from extra minutes" },
    scope: scopeFor(f, g.count),
    how: `Same-game accounting: the excess points on a big night split into minutes, shots per minute and shooting efficiency. Labelled “how it happened, not a prediction”: the totals are an identity with points, so they say nothing about what to expect beforehand.`,
    body: (
      <>
        <Sub>Share of the excess points</Sub>
        <ShareBar
          parts={[
            { label: "more minutes", v: b.share_minutes! },
            { label: "more shots per minute", v: b.share_shot_rate! },
            { label: "better efficiency", v: b.share_efficiency! },
          ]}
        />
        <Sub>Versus the player’s own norm</Sub>
        <CompareTable
          head={["", `${ev.label} night`, "Other games"]}
          rows={[
            tr("Points", b.mean_pts.toFixed(1), o.mean_pts.toFixed(1)),
            tr("Minutes (min)", sg(b.d_min, 1), sg(o.d_min, 1)),
            tr("Shots (FGA)", sg(b.d_fga, 1), sg(o.d_fga, 1)),
            tr("True shooting (pp)", sg(b.d_ts_pp, 1), sg(o.d_ts_pp, 1)),
          ]}
        />
        <Note>Prior average of these players: {b.mean_prior_avg.toFixed(1)} PPG on big nights, {o.mean_prior_avg.toFixed(1)} on other nights.</Note>
      </>
    ),
    legend: [],
    facts: [
      { label: "Big-night games", value: fmtN(b.n_games) },
      { label: "Other games", value: fmtN(o.n_games) },
      { label: "Avg minutes extra", value: sg(b.d_min, 1) },
    ],
    sample: `n = ${fmtN(b.n_games)} big-night games`,
    caveats: [
      caveat(ctx, 6),
      f.seg === "top50" ? "For Top 50 stars the shot-volume share is larger and the minutes share smaller than for all players: stars already play the minutes." : "",
      ...prov(ctx),
    ].filter(Boolean),
    method: "Same-game (lens B) decomposition of points above the player’s prior average into minutes, shot rate per minute and efficiency; shown for big-night games against all other games, with each measure expressed relative to the player’s own prior norm. Data shown for 3 seasons pooled and 2025-26 only.",
  };
}

/* ───────── 9. no pregame probability ───────── */
export function noForecast(ctx: Ctx): CardModel {
  const { f, sel, data } = ctx;
  const bn = data.bn;
  const m = baseModel(ctx, "no-forecast");
  const ev = evOf(pick(sel.m, EV2));
  const switches: SwitchSpec[] = [eventSwitch("m", ev.id, EV2)];
  const g = bnGate(ctx, ev.id, "a pregame model");
  if (g.state) return { ...m, switches, state: g.state, scope: scopeFor(f, g.count) };
  const perf = bn.perf[f.ts]?.[f.seg]?.[ev.id];
  const cells = bn.context[f.ts] ?? [];
  const rr = bn.auc_range;
  const aucRows: ChartRow[] = perf
    ? [
        { key: "ctl", label: "Controls only", sub: "prior average, volatility…", est: perf.ctl, valText: perf.ctl != null ? perf.ctl.toFixed(2) : "n/a", neutral: true, thin: perf.ctl == null, thinTxt: "not fitted" },
        { key: "pre", label: "Controls + pregame factors", est: perf.auc, lo: perf.lo, hi: perf.hi, valText: perf.auc.toFixed(2), ciText: ci2(perf.lo, perf.hi), n: `${fmtN(perf.nt)} test games · ${fmtN(perf.ne)} events`, neutral: true },
      ]
    : [];
  const spec: ChartSpec = {
    rows: aucRows,
    base: 0.5,
    mark: "dot",
    min: 0.4,
    max: 0.85,
    axisTitle: "AUC on held-out games (0.5 = coin flip, 1 = perfect)",
    label: `AUC for ${ev.label}, controls only vs pregame`,
  };
  const gain = perf && perf.d != null ? perf.d : null;
  const pooledAll = bn.perf.pooled_2023_26?.all ?? {};
  const rng = (ids: string[]): [number, number] | null => {
    const v = ids.map((k) => pooledAll[k]?.auc).filter((x): x is number => x != null);
    return v.length ? [Math.min(...v), Math.max(...v)] : null;
  };
  const mainRange = rng(["x125", "x150", "p5", "p10", "z15"]);
  const allRange = rng(["x125", "x150", "x200", "p5", "p10", "z15"]);
  const headline = perf
    ? `Pregame factors give an AUC of ${perf.auc.toFixed(2)} for ${ev.night}${gain != null ? `, only ${gain.toFixed(2)} above a controls-only model` : ""}: not a usable forecast. Show base rates by context instead of a probability.`
    : `No model score is shown. Context base rates only: the study did not score a pregame model for ${tsName(f.ts)} · ${segName(f.seg)}.`;
  return {
    ...m,
    switches,
    verdict: "info",
    badgeText: "Not a forecast",
    headline,
    scan: { value: perf ? perf.auc.toFixed(2) : "n/a", unit: "AUC, pregame" },
    scope: scopeFor(f, g.count),
    how: "We do not ship a pregame big-night probability. The dots show how well the best pregame model separates big nights from the rest on held-out games; what we show instead is the plain base rate for a context bucket (prior average × teammates out).",
    body: (
      <>
        {perf ? (
          <>
            <Sub>Pregame model skill</Sub>
            <Chart spec={spec} />
          </>
        ) : null}
        <Sub>Base rate by context · share of player-games that are {ev.label} nights</Sub>
        <ContextTable cells={cells} tiers={bn.context_tiers} ev={ev.id as "x150" | "p10"} />
        <Note>All players with a prior average of 8+ PPG (the segment filter does not cut this table). Each cell: rate, 95% range, player-games.</Note>
      </>
    ),
    legend: [],
    facts: [
      { label: "AUC range, 5 cuts, 3 seasons, All", value: mainRange ? `${mainRange[0].toFixed(2)}–${mainRange[1].toFixed(2)}` : "n/a" },
      { label: "AUC incl. ×2.0", value: allRange ? `${allRange[0].toFixed(2)}–${allRange[1].toFixed(2)}` : "n/a" },
      { label: "Test games", value: perf ? fmtN(perf.nt) : "n/a" },
    ],
    sample: perf ? `${fmtN(perf.nt)} held-out games` : "",
    caveats: [
      `Across the non-thin cells the pregame AUC runs from ${rr.min.toFixed(2)} to ${rr.max.toFixed(2)} (${rr.n} fits); for Top 50 stars the pregame factors add nothing credible for ×1.5.`,
      "The controls-only model already knows each player’s average and volatility, so it already scores well; the pregame context adds only a little on top.",
      caveat(ctx, 6),
      ...prov(ctx),
    ],
    method: "Logistic models fitted on earlier dates and scored on the last ~20% of dates of each timespan: controls only (prior average, volatility, usage, minutes, progress, start rate, position) vs controls + all pregame terms. AUC with a 95% player-cluster bootstrap interval. Context bins: prior average 8–12, 12–16, 16–20, 20+ PPG × none / <10 / 10–20 / 20+ PPG of regulars out; cells under 30 players or 300 games are hatched.",
  };
}

/* ───────── 10. credible player cases ───────── */
function credChart(list: BnCredible[], label: string, ev: ReturnType<typeof evOf>, an: BnCredible["an"], leagueMean: number): ChartSpec {
  const rows: ChartRow[] = list.map((c) => ({
    key: `${c.an}-${c.id}`,
    label: c.name,
    sub: `${c.nc} games${c.nr ? ` vs ${c.nr}` : ""}${c.top50 ? " · Top 50" : ""}${c.flag ? ` · ${c.flag.replace("_", " ")}` : ""}`,
    est: c.sh,
    lo: c.lo,
    hi: c.hi,
    valText: sg(c.sh, 1),
    unit: "pp",
    ciText: `${sg(c.lo, 1)} to ${sg(c.hi, 1)}`,
    n: `raw ${sg(c.raw, 1)} pp`,
    href: `/players?player=${encodeURIComponent(c.id)}`,
  }));
  return {
    rows,
    base: leagueMean,
    mark: "dot",
    axisTitle:
      (an === "propensity_vs_expected" ? `${ev.label} rate minus expected for his average (pp)` : `${ev.label} rate with teammates out minus without (pp)`) +
      `; dotted line = league average ${sg(leagueMean, 1)} pp`,
    endL: "← below the league",
    endR: "above the league →",
    label,
    variant: "detail",
  };
}

export function credibleOnly(ctx: Ctx): CardModel {
  const { f, sel, data } = ctx;
  const bn = data.bn;
  const m = baseModel(ctx, "credible-players");
  const ev = evOf(pick(sel.m, EV2));
  const switches: SwitchSpec[] = [eventSwitch("m", ev.id, EV2)];
  if (f.ts === "2026_27") {
    return {
      ...m,
      switches,
      scope: scopeFor(f),
      state: {
        kind: "thin",
        title: "Player flags hidden for 2026-27",
        text: "Players have too few games this season (about a dozen per team) for a credible player-specific pattern. No flags are shown; the study keeps 2026-27 provisional.",
        fixes: [{ label: "Show 2025-26", ts: "2025_26" }, { label: "Show 3 seasons", ts: "pooled_2023_26" }],
      },
      responders: hiddenResponders(ctx, "credible cases") ?? { kind: "none" },
    };
  }
  const out = `${ev.id}_std`;
  const sum = bn.players[f.ts]?.propensity_vs_expected?.[out];
  const prop = credFor(ctx, "propensity_vs_expected", out).filter((c) => c.dir === "above");
  const tout = credFor(ctx, "teammates_out_10plus", out);
  const toutSum = bn.players[f.ts]?.teammates_out_10plus?.[out];
  if (!sum) {
    return { ...m, switches, scope: scopeFor(f), state: { kind: "thin", title: "No player summary", text: `No per-player summary exists for ${tsName(f.ts)}. Nothing is drawn.`, fixes: fixesFor(f) } };
  }
  const verdict: Verdict = "info";
  const headline = `${sum.n_abs_z_ge_2_5} of ${fmtN(sum.n_players)} players are flagged at |z| ≥ 2.5 for ${ev.night}, against ${sum.expected_abs_z_ge_2_5_by_chance.toFixed(1)} expected by chance. Only ${sum.n_credible_above_league} are credibly above the league; ${sum.n_credible_above_top50} ${sum.n_credible_above_top50 === 1 ? "is" : "are"} in the Top 50.`;
  const respPropensity: PlayerConditionRow[] = credibleToRows(prop);
  return {
    ...m,
    switches,
    verdict,
    badgeText: "Credible cases only",
    headline,
    scan: { value: `${sum.n_abs_z_ge_2_5}`, unit: `flagged vs ${sum.expected_abs_z_ge_2_5_by_chance.toFixed(1)} by chance` },
    scope: [tsName(f.ts), `${fmtN(sum.n_players)} players`, "40+ eligible games each"],
    how: `A player appears only if his shrunk 95% interval excludes the league mean. The tiles print how many players were flagged next to how many chance alone would flag. Dots are shrunk estimates in percentage points; read the interval, not the rank.`,
    body: (
      <>
        <Tiles
          tiles={[
            { big: String(sum.n_abs_z_ge_2_5), label: "flagged at |z| ≥ 2.5", sub: `${sum.expected_abs_z_ge_2_5_by_chance.toFixed(1)} expected by chance` },
            { big: String(sum.n_p_lt_05), label: "flagged at p < 0.05", sub: `${sum.expected_p_lt_05_by_chance.toFixed(1)} expected by chance` },
            { big: String(sum.n_credible_above_league), label: "credibly above the league", sub: `${sum.n_credible_below_league} credibly below` },
            { big: `${sum.n_credible_above_top50} of ${sum.n_stars_top50}`, label: "Top 50 stars credible", sub: "role players, mostly" },
          ]}
        />
        <Sub>Higher {ev.label} rate than players with the same average</Sub>
        {prop.length ? <Chart spec={credChart(prop, "Credible players, propensity", ev, "propensity_vs_expected", sum.league_mean_diff * 100)} /> : <Note>No player clears the bar at this cut.</Note>}
        <Sub>Teammates out (10+ PPG): who responds</Sub>
        {tout.length ? (
          <Chart spec={credChart(tout, "Credible players, teammates out", ev, "teammates_out_10plus", (toutSum?.league_mean_diff ?? 0) * 100)} />
        ) : (
          <Note>No player is credibly different from the league at this cut{toutSum ? ` (${toutSum.n_abs_z_ge_2_5} flagged against ${toutSum.expected_abs_z_ge_2_5_by_chance.toFixed(1)} expected by chance)` : ""}.</Note>
        )}
      </>
    ),
    legend: ["up", "down", "flat", "whk", "bl"],
    facts: [
      { label: "Players", value: fmtN(sum.n_players) },
      { label: "Spread (tau)", value: `${(sum.tau * 100).toFixed(1)} pp` },
      { label: "Credible", value: `${sum.n_credible_above_league} up · ${sum.n_credible_below_league} down` },
    ],
    sample: `${fmtN(sum.n_players)} players`,
    caveats: [
      "A controls-only model can be misspecified for players with role changes: read these as worth watching, not as traits.",
      toutSum ? `Teammates-out split: ${toutSum.n_credible_above_league} players credibly more responsive and ${toutSum.n_credible_below_league} credibly less. The “less” group are high-average players for whom a ×1.5 night is rare, which partly reflects base rates rather than the vacuum itself.` : "",
      "Credible = the shrunk interval (the player’s own evidence only) excludes the league average, drawn as the dotted line (not zero). Flagged = |z| ≥ 2.5 or q < 0.10. Expected by chance assumes every player is the league mean.",
      ...(f.ts === "pooled_2023_27" ? [BN_PROV] : []),
    ].filter(Boolean),
    method: "Per-player empirical-Bayes shrinkage (DerSimonian–Laird heterogeneity) of the difference between his observed big-night rate and the rate expected for his average, volatility, usage, minutes and role; condition splits need 10+ games on each side. Players need 40+ eligible games (pooled spans) at a prior average of 8+.",
    responders: { kind: "ready", set: buildResponders(respPropensity, `${ev.label} rate vs expected for his average`, { note: "Credible higher-rate cases only. Per-player flags come from the study; no persistence test yet." }) },
  };
}
