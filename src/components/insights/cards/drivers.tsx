import { DRIVER_LABELS, type DriverModel, type Lens, type ModelKey } from "@/lib/pointsDriversTypes";
import type { CardModel, ChartRow, ChartSpec, Ctx, SwitchSpec } from "@/lib/insights/types";
import { EARLY, deepCell, fmtN, isThinCell, kindOf, scopeFor, segName, sg, thinState, tsName, fixesFor } from "@/lib/insights/util";
import { ASSOC, EARLY_NOTE, LG, WHISKER, baseModel, chartBody, pick } from "./common";
import { CurveChart } from "./bodies";
import styles from "../insights.module.css";

const LENS = [
  { id: "pregame", label: "Pregame" },
  { id: "explanatory", label: "Same game" },
];
const MODELS = [
  { id: "mixedlm", label: "Mixed" },
  { id: "ols", label: "OLS" },
];

function driversCell(ctx: Ctx, lens: Lens) {
  return ctx.data.drivers.cells[lens]?.[ctx.f.ts]?.[ctx.f.seg];
}

function tooFew(ctx: Ctx, m: CardModel, switches: SwitchSpec[], cell: ReturnType<typeof driversCell>, what: string): CardModel {
  const { f } = ctx;
  const text = cell && !cell.fitted
    ? `${tsName(f.ts)} ${segName(f.seg)} has only ${fmtN(cell.n_players)} players and ${fmtN(cell.n_games)} player-games: too few to fit a model at all. Nothing is drawn.`
    : cell
      ? `${segName(f.seg)} has only ${fmtN(cell.n_players)} players (${fmtN(cell.n_games)} player-games). Cells under 30 players are not ranked, because a handful of players would set the order.`
      : `No fitted cell for ${tsName(f.ts)} · ${segName(f.seg)}. Nothing is drawn.`;
  return { ...m, switches, scope: scopeFor(f, cell), state: { kind: "thin", title: EARLY(f.ts) ? "Not enough games yet" : `Too few games to ${what}`, text, fixes: fixesFor(f) } };
}

function gainPct(mod: DriverModel): number | null {
  return mod.test_mae != null && mod.baseline_mae != null ? ((mod.baseline_mae - mod.test_mae) / mod.baseline_mae) * 100 : null;
}

/* ───────── points drivers ───────── */
export function drivers(ctx: Ctx): CardModel {
  const { f, sel, data } = ctx;
  const m = baseModel(ctx, "drivers");
  const lens = pick(sel.m, LENS) as Lens;
  const cell = driversCell(ctx, lens);
  const modelOpts = MODELS.map((o) => ({ ...o, disabled: !cell?.models[o.id as ModelKey] }));
  const mk = pick(sel.s, modelOpts) as ModelKey;
  const switches: SwitchSpec[] = [
    { key: "m", label: "Lens", value: lens, options: LENS },
    { key: "s", label: "Model", value: mk, options: modelOpts },
  ];
  const mod = cell?.models[mk] ?? cell?.models.mixedlm;
  if (!cell || !cell.fitted || cell.thin || !mod) return tooFew(ctx, m, switches, cell, "rank");
  const ds = [...mod.drivers].sort((a, b) => a.rank - b.rank).filter((d) => d.coef != null && d.lo != null && d.hi != null);
  const rows: ChartRow[] = ds.map((d) => ({
    key: d.driver,
    label: DRIVER_LABELS[d.driver] ?? d.driver,
    sub: `rank ${d.rank}`,
    est: d.coef!,
    lo: d.lo!,
    hi: d.hi!,
    valText: sg(d.coef!),
    ciText: `${sg(d.lo!)} to ${sg(d.hi!)}`,
  }));
  const head = rows[0];
  const verdict = head ? kindOf(head.lo!, head.hi!, 0) : "thin";
  const headline = head
    ? verdict === "flat"
      ? `No single measure stands out: even the top one (${head.label}) can’t be told from zero.`
      : `${head.label} goes with the most points: about ${Math.abs(head.est!).toFixed(1)} ${verdict === "up" ? "more" : "fewer"} per +1 standard deviation, and it is clear.`
    : "No driver could be estimated here.";
  const spec: ChartSpec = {
    rows,
    base: 0,
    mark: "bar",
    axisTitle: "Points per +1 SD of the measure (pts)",
    endL: "← fewer points",
    endR: "more points →",
    label: `${lens === "pregame" ? "Pregame" : "Same-game"} drivers, ${mk === "mixedlm" ? "mixed" : "OLS"} model`,
  };
  const split = data.drivers.date_split[f.ts];
  return {
    ...m,
    switches,
    verdict,
    headline,
    scan: { value: head ? sg(head.est!) : "n/a", unit: head ? `pts, ${head.label}` : "" },
    scope: scopeFor(f, cell),
    how: `Each bar is the change in points for +1 standard deviation of that measure, holding the others fixed. ${WHISKER}`,
    body: chartBody(spec),
    legend: LG.diffNoThin,
    facts: [
      { label: "Players", value: fmtN(cell.n_players) },
      { label: "Games", value: fmtN(cell.n_games) },
      { label: "Drivers", value: String(rows.length) },
    ],
    sample: `n = ${fmtN(cell.n_games)} games`,
    caveats: [
      `${ASSOC} Effect = change in points per +1 standard deviation of the measure, ranked by size.`,
      lens === "pregame"
        ? "Pregame lens: inputs are each player’s averages over his previous 10 games only, so everything is known before tip-off."
        : "Same-game lens: inputs are the same game’s box-score measures. They describe how points get produced; they are not pregame predictors, and the fit is near arithmetic (points = 2 × TS% × (FGA + 0.44 × FTA)).",
      "Left out: USG% and eFG% were dropped as near-duplicates of FGA, FTA, minutes and TS% (variance-inflation check); net rating equals off minus def rating exactly, so only the two parts are kept; PIE is dropped from the same-game lens because it contains the player’s own points.",
      "Not in this model: opponent inputs (defence, pace; see Matchups), injuries and lineups, and betting lines.",
      mk === "mixedlm" ? "Mixed model: player random intercept." : "OLS with player-clustered CIs.",
      `Data through ${data.drivers.through ?? "—"}. Test split is by date (last 20% of game dates); Top 25 and Top 10 are never ranked.`,
      ...(EARLY(f.ts) && split ? [`2026-27 is provisional: the test window is only the last ${split.n_test_dates} game dates (from ${split.cutoff}).`] : []),
      ...(f.ts === "pooled_2023_27" ? [EARLY_NOTE] : []),
    ],
    method: "Standardised linear model of points on the box-score measures (pregame: trailing-10-game averages). Coefficients are points per +1 SD with 95% intervals.",
  };
}

/* ───────── model vs baseline ───────── */
export function baseline(ctx: Ctx): CardModel {
  const { f, sel, data } = ctx;
  const m = baseModel(ctx, "baseline");
  const lens = pick(sel.m, LENS) as Lens;
  const cell = driversCell(ctx, lens);
  const modelOpts = MODELS.map((o) => ({ ...o, disabled: !cell?.models[o.id as ModelKey] }));
  const mk = pick(sel.s, modelOpts) as ModelKey;
  const switches: SwitchSpec[] = [
    { key: "m", label: "Lens", value: lens, options: LENS },
    { key: "s", label: "Model", value: mk, options: modelOpts },
  ];
  const mod = cell?.models[mk] ?? cell?.models.mixedlm;
  if (!cell || !cell.fitted || cell.thin || !mod || mod.test_mae == null || mod.baseline_mae == null) return tooFew(ctx, m, switches, cell, "score");
  const gain = gainPct(mod)!;
  const beats = data.drivers.pregame_beats_baseline_mae;
  const maxMae = Math.max(mod.test_mae, mod.baseline_mae);
  const bar = (label: string, v: number, max: number, color: string, txt: string) => (
    <div className={styles.row} key={label}>
      <div className={styles.r1}>
        <div className={styles.nm}>{label}</div>
        <div className={styles.v}>{txt}</div>
      </div>
      <div style={{ height: 14, width: `${(v / max) * 100}%`, background: color, border: "1.5px solid var(--hw-ink)", marginTop: 4 }} />
    </div>
  );
  const body = (
    <div className={styles.chart}>
      {bar("Model error (MAE)", mod.test_mae, maxMae, "var(--hw-ink)", `${mod.test_mae.toFixed(2)} pts`)}
      {bar("Prior-average error (MAE)", mod.baseline_mae, maxMae, "var(--d-flat)", `${mod.baseline_mae.toFixed(2)} pts`)}
      {mod.test_r2 != null && mod.baseline_r2 != null ? (
        <>
          {bar("Model R²", mod.test_r2, Math.max(mod.test_r2, mod.baseline_r2), "var(--hw-ink)", mod.test_r2.toFixed(3))}
          {bar("Prior-average R²", mod.baseline_r2, Math.max(mod.test_r2, mod.baseline_r2), "var(--d-flat)", mod.baseline_r2.toFixed(3))}
        </>
      ) : null}
      <div className={styles.axt}>
        <b>Held-out last 20% of dates · shorter error bar is better, longer R² bar is better</b>
      </div>
    </div>
  );
  const headline =
    lens === "pregame"
      ? gain >= 0
        ? `The pregame model cuts error by only ${gain.toFixed(1)}% against just using the prior average.`
        : `The pregame model has ${Math.abs(gain).toFixed(1)}% higher error than just using the prior average.`
      : `Same-game measures account for points almost by construction (R² ${mod.test_r2 != null ? mod.test_r2.toFixed(2) : "n/a"}): this is not forecasting skill.`;
  return {
    ...m,
    switches,
    verdict: "info",
    badgeText: "Overview",
    headline,
    scan: { value: `${gain >= 0 ? "−" : "+"}${Math.abs(gain).toFixed(1)}%`, unit: "error vs prior avg" },
    scope: scopeFor(f, cell),
    how: "Each bar is the typical miss (MAE, in points) or the share of variation explained (R²) on games the model never saw, next to the plain prior average.",
    body,
    legend: [],
    facts: [
      { label: "Beat baseline (mixed)", value: `${beats.mixedlm.beat}/${beats.mixedlm.cells} cells` },
      { label: "Beat baseline (OLS)", value: `${beats.ols.beat}/${beats.ols.cells} cells` },
      { label: "Test games", value: "last 20% of dates" },
    ],
    sample: `${beats.mixedlm.beat}/${beats.mixedlm.cells} cells beat baseline`,
    caveats: [
      `${ASSOC} No interval exists for the error gain, so this card is descriptive (Overview), not Clear / Not clear.`,
      `Across the ${beats.mixedlm.cells} non-thin cells the mixed model beat the prior average on MAE in ${beats.mixedlm.beat} and OLS in ${beats.ols.beat}. Per-game scoring is mostly noise around a player’s level.`,
      lens === "explanatory" ? "The baseline is for reference only on this lens: same-game inputs are not a like-for-like forecast." : "",
      ...(EARLY(f.ts) || f.ts === "pooled_2023_27" ? [EARLY_NOTE] : []),
    ].filter(Boolean),
    method: "Model fitted on the first 80% of game dates, scored on the last 20%; baseline = the player’s prior season-to-date average. MAE = mean absolute error in points.",
  };
}

/* ───────── defence & pace curves ───────── */
export function shape(ctx: Ctx): CardModel {
  const { f } = ctx;
  const m = baseModel(ctx, "shape");
  const cell = deepCell(ctx);
  const sp = cell && !cell.thin ? cell.spline : undefined;
  const def = sp?.def;
  if (isThinCell(cell) || !def) return { ...m, scope: scopeFor(f, cell), state: thinState(f, cell, "fitted curves") };
  const pace = sp?.pace;
  const pT = (p: number | null) => (p == null ? "n/a" : p < 0.001 ? "p < 0.001" : `p = ${p.toFixed(3)}`);
  const curved = def.p != null && def.p < 0.05;
  const at = (x: number) => def.pts.find((p) => p[0] === x)?.[1] ?? null;
  const first = def.pts[0][0];
  const last = def.pts[def.pts.length - 1][0];
  const mid = def.pts[Math.floor(def.pts.length / 2)][0];
  const body = (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <CurveChart title="Points vs prior average by opponent defence rank" pts={def.pts} endLabels={["worst defence", "best defence"]} axisTitle="Fitted effect (pts) · band = 95% CI" />
      {pace ? <CurveChart title="… by opponent pace rank" pts={pace.pts} endLabels={["fastest", "slowest"]} axisTitle="Fitted effect (pts) · band = 95% CI" /> : null}
    </div>
  );
  return {
    ...m,
    verdict: curved ? "info" : "flat",
    badgeText: curved ? "Curved" : undefined,
    headline: curved
      ? `Opponent defence is clearly not a straight line for ${segName(f.seg)} players (${pT(def.p)}).`
      : `Opponent defence can’t be told from a straight line for ${segName(f.seg)} players (${pT(def.p)}).`,
    scan: { value: pT(def.p), unit: "curve test" },
    scope: scopeFor(f, cell),
    how: "The line is the fitted effect of opponent rank on points above the player’s average; the tan band is its 95% range. Flat along 0 = no effect.",
    body,
    legend: ["band", "bl"],
    facts: [
      { label: "Players", value: fmtN(cell!.n_players) },
      { label: "Games", value: fmtN(cell!.n_games) },
      { label: "Curve test", value: pT(def.p) },
    ],
    sample: `n = ${fmtN(cell!.n_games)} games`,
    caveats: [
      `${ASSOC} Fitted curve with a 95% band, other measures held at their average.`,
      `${segName(f.seg)} defence curve: ${sg(at(first) ?? 0)} pts at the weakest defence, ${sg(at(mid) ?? 0)} in the middle, ${sg(at(last) ?? 0)} at the strongest. Test that it is not a straight line: ${pT(def.p)}${def.p != null ? (def.p < 0.05 ? " (clearly curved)." : " (can’t tell it from a straight line here).") : "."}`,
      "The pregame drivers model has no opponent inputs, so it says nothing about matchups; those are covered in Matchups.",
      "Curved models did not beat the straight-line one on held-out games in most cells, so this is a reading of the shape, not a better forecast.",
      ...(EARLY(f.ts) || f.ts === "pooled_2023_27" ? [EARLY_NOTE] : []),
    ],
    method: "Spline in opponent defence (and pace) rank inside the matchup model; p-value tests the curve against a straight line.",
  };
}
