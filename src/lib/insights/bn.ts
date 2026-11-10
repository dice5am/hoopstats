import type { BigNightsData, BnBaseline, BnCount, BnEvent, BnLift, BnSeg } from "../bigNightsTypes";
import type { SegmentKey, TimespanKey } from "../timespans";
import type { CardState, ChartRow, Ctx, Verdict } from "./types";
import { fixesFor, fmtN, kindOf, pctS, segName, sg, tsName } from "./util";

/** The six event cuts, in switch order. Labels are the study's own definitions. */
export const BN_EVENTS: { id: BnEvent; label: string; night: string; phrase: string }[] = [
  { id: "x150", label: "×1.5", night: "a ×1.5 night", phrase: "scoring 1.5× his average or more" },
  { id: "p10", label: "+10", night: "a +10 night", phrase: "scoring 10+ over his average" },
  { id: "x125", label: "×1.25", night: "a ×1.25 night", phrase: "scoring 1.25× his average or more" },
  { id: "x200", label: "×2.0", night: "a ×2 night", phrase: "scoring 2× his average or more" },
  { id: "p5", label: "+5", night: "a +5 night", phrase: "scoring 5+ over his average" },
  { id: "z15", label: "z≥1.5", night: "a z ≥ 1.5 night", phrase: "scoring 1.5 standard deviations above his average or more" },
];
export const BN_EVENT_OPTS = BN_EVENTS.map((e) => ({ id: e.id, label: e.label }));
export const evOf = (id: string) => BN_EVENTS.find((e) => e.id === id) ?? BN_EVENTS[0];

export const BASELINE_OPTS = [
  { id: "std", label: "Season average" },
  { id: "l10", label: "Last 10 games" },
];
export const BASELINE_WORD: Record<BnBaseline, string> = { std: "his season-to-date average", l10: "his average over his last 10 games" };

export type Lift = {
  rl: number | null;
  rr0: number | null;
  n: number;
  ev: number;
  rr: number | null;
  rrl: number | null;
  rrh: number | null;
  or: number | null;
  orl: number | null;
  orh: number | null;
  pp: number | null;
  ppl: number | null;
  pph: number | null;
  ok: boolean;
  thin: boolean;
};

const dec = (a: BnLift | undefined): Lift | null =>
  !a
    ? null
    : {
        rl: a[0], rr0: a[1], n: a[2] as number, ev: a[3] as number,
        rr: a[4], rrl: a[5], rrh: a[6], or: a[7], orl: a[8], orh: a[9], pp: a[10], ppl: a[11], pph: a[12],
        ok: ((a[13] as number) & 1) === 1,
        thin: ((a[13] as number) & 2) === 2,
      };

export function liftOf(bn: BigNightsData, ts: TimespanKey, seg: SegmentKey, bl: BnBaseline, ev: BnEvent, factor: string): Lift | null {
  return dec(bn.lift[ts]?.[seg]?.[bl]?.[ev]?.[factor]);
}

export const factorLabel = (bn: BigNightsData, f: string) => bn.factor_labels[f]?.label ?? f;

export function countOf(bn: BigNightsData, ts: TimespanKey, seg: SegmentKey, ev: BnEvent): BnCount | undefined {
  return bn.counts[ts]?.[seg]?.[ev];
}

export const isBnSeg = (s: SegmentKey): s is BnSeg => s === "all" || s === "top100" || s === "top50";

/**
 * Thin / provisional gate for a Big-nights card at the current filters.
 * Top 25 / Top 10 are always thin (25 / 10 players): counts only. Cells under Data's floor likewise.
 */
export function bnGate(ctx: Ctx, ev: BnEvent, what: string): { count?: BnCount; state?: CardState } {
  const { f, data } = ctx;
  const c = countOf(data.bn, f.ts, f.seg, ev);
  const where = `${tsName(f.ts)} · ${segName(f.seg)}`;
  if (!c) {
    return {
      state: { kind: "thin", title: "No cell for this view", text: `The study has no ${where} cell. Nothing is drawn; we won’t guess.`, fixes: fixesFor(f) },
    };
  }
  if (c.thin || !isBnSeg(f.seg)) {
    const evn = evOf(ev);
    return {
      count: c,
      state: {
        kind: "thin",
        title: f.seg === "top25" || f.seg === "top10" ? `${segName(f.seg)} is always too small to read` : "Too few games to read",
        text: `${segName(f.seg)} in ${tsName(f.ts)}: ${fmtN(c.n_players)} players, ${fmtN(c.n_games)} player-games, ${fmtN(c.n_events)} ${evn.label} nights (${pctS(c.base_rate)}). Counts only: ${what} is never ranked or read from a cell this small.`,
        fixes: fixesFor(f),
      },
    };
  }
  return { count: c };
}

/* ───────── rows ───────── */
export const ratioTxt = (v: number) => `×${v.toFixed(2)}`;
export const ci2 = (a: number, b: number) => `${a.toFixed(2)} to ${b.toFixed(2)}`;

type Meas = "rr" | "or";

function n(l: Lift) {
  return `${fmtN(l.n)} games · ${fmtN(l.ev)} events`;
}

/** Ratio row (risk ratio raw, or odds ratio adjusted). Thin levels are hatched, never plotted. */
export function ratioRow(key: string, label: string, l: Lift | null, m: Meas, opts: { sub?: string; reason?: string } = {}): ChartRow {
  const base: ChartRow = { key, label, sub: opts.sub, est: null };
  if (!l) return { ...base, thin: true, thinTxt: "not available here" };
  if (l.thin || !l.ok) return { ...base, thin: true, thinTxt: "too few games", n: n(l) };
  const [est, lo, hi] = m === "rr" ? [l.rr, l.rrl, l.rrh] : [l.or, l.orl, l.orh];
  if (est == null || lo == null || hi == null) return { ...base, thin: true, thinTxt: m === "or" ? "no adjusted fit" : "not available", n: n(l) };
  return { ...base, est, lo, hi, valText: ratioTxt(est), ciText: ci2(lo, hi), n: n(l) };
}

/** Adjusted percentage-point row. */
export function ppRow(key: string, label: string, l: Lift | null, opts: { sub?: string } = {}): ChartRow {
  const base: ChartRow = { key, label, sub: opts.sub, est: null };
  if (!l) return { ...base, thin: true, thinTxt: "not available here" };
  if (l.thin || !l.ok) return { ...base, thin: true, thinTxt: "too few games", n: n(l) };
  if (l.pp == null || l.ppl == null || l.pph == null) return { ...base, thin: true, thinTxt: "no adjusted fit", n: n(l) };
  return { ...base, est: l.pp, lo: l.ppl, hi: l.pph, valText: sg(l.pp, 1), unit: "pp", ciText: `${sg(l.ppl, 1)} to ${sg(l.pph, 1)}`, n: n(l) };
}

export const rowVerdict = (r: ChartRow, base: number): Verdict => (r.thin || r.lo == null || r.hi == null ? "thin" : kindOf(r.lo, r.hi, base));

export const rates = (l: Lift | null) => (l && l.rl != null && l.rr0 != null ? `${pctS(l.rl)} vs ${pctS(l.rr0)}` : undefined);

/** The 'thin and provisional' note appended to every Big-nights card. */
export const BN_PROV = "2026-27 is provisional (few games per player so far): intervals are wide and rows under Data’s floor are hatched. Pools that include it carry the same flag.";
