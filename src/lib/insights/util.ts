import type { DeepCell, Eff, Outcome } from "../deepInsightsTypes";
import {
  SEGMENT_SWITCH_LABEL,
  TIMESPAN_SWITCH_LABEL,
  type SegmentKey,
  type TimespanKey,
} from "../timespans";
import type { CardState, ChartRow, Ctx, Filters, Fix, Verdict } from "./types";

/* ───────── formatting ───────── */
export const sg = (n: number, d = 2) => (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n).toFixed(d);
export const ciTxt = (a: number, b: number, d = 2) => `${sg(a, d)} to ${sg(b, d)}`;
export const fmtN = (n: number) => n.toLocaleString("en-US");
export const pctS = (n: number, d = 1) => `${(n * 100).toFixed(d)}%`;
export const ppS = (n: number, d = 1) => sg(n * 100, d);
export const r1 = (n: number) => Math.abs(n).toFixed(1);
export const plural = (n: number, w: string) => `${fmtN(n)} ${w}${n === 1 ? "" : "s"}`;

export const tsName = (ts: TimespanKey) => TIMESPAN_SWITCH_LABEL[ts] ?? ts;
export const segName = (s: SegmentKey) => SEGMENT_SWITCH_LABEL[s] ?? s;

/* ───────── verdicts ───────── */
export function kindOf(lo: number, hi: number, base: number): "up" | "down" | "flat" {
  return lo > base ? "up" : hi < base ? "down" : "flat";
}

export function verdictOf(lo: number | null | undefined, hi: number | null | undefined, base: number, thin = false): Verdict {
  if (thin || lo == null || hi == null) return "thin";
  return kindOf(lo, hi, base);
}

export const BADGE_TEXT: Record<Verdict, string> = {
  up: "▲ Clear",
  down: "▼ Clear",
  flat: "○ Not clear",
  thin: "Too few games",
  pend: "Study incoming",
  info: "Overview",
  err: "Error",
};

/* ───────── cells ───────── */
export function deepCell(ctx: Ctx, ts: TimespanKey = ctx.f.ts, seg: SegmentKey = ctx.f.seg): DeepCell | undefined {
  return ctx.data.deep.cells[ts]?.[seg];
}

export function isThinCell(c: DeepCell | undefined): boolean {
  return !c || c.thin;
}

export const EARLY = (ts: TimespanKey) => ts === "2026_27";

export function scopeFor(f: Filters, cell?: { n_players: number; n_games: number } | null, extra: string[] = []): string[] {
  const out = [tsName(f.ts), segName(f.seg)];
  if (cell) out.push(`${fmtN(cell.n_players)} players`, `${fmtN(cell.n_games)} games`);
  return [...out, ...extra];
}

export function pillsFor(f: Filters, honours: { ts: "yes" | "na"; seg: "yes" | "na" | "rows" }): { text: string; hot?: boolean }[] {
  const p: { text: string; hot?: boolean }[] = [];
  if (EARLY(f.ts)) p.push({ text: "early sample", hot: true });
  if (honours.ts === "na") p.push({ text: "timespan n/a" });
  if (honours.seg === "na") p.push({ text: "segment n/a" });
  return p;
}

/** One-tap fixes for an empty / too-few-games state. */
export function fixesFor(f: Filters): Fix[] {
  const fx: Fix[] = [];
  if (f.seg !== "all") fx.push({ label: "Show All", seg: "all" });
  if (f.ts === "2026_27") fx.push({ label: "Show 2025-26", ts: "2025_26" });
  else if (f.ts !== "pooled_2023_26" && fx.length < 2) fx.push({ label: "Show 3 seasons", ts: "pooled_2023_26" });
  return fx.slice(0, 2);
}

export function thinState(f: Filters, cell: DeepCell | undefined, what = "this card"): CardState {
  const where = `${tsName(f.ts)} · ${segName(f.seg)}`;
  let text: string;
  if (!cell) {
    text = `No cell exists for ${where}: too few players to compute ${what} at all. Nothing is drawn; we won’t guess.`;
  } else if (f.ts === "2026_27") {
    text = `${fmtN(cell.n_games)} player-games for ${segName(f.seg)} this season so far (${fmtN(cell.n_players)} players). Nothing is drawn; we won’t guess.`;
  } else {
    text = `${fmtN(cell.n_players)} players and ${fmtN(cell.n_games)} player-games in ${where}. Cells under 30 players or 300 games are not read. Nothing is drawn; we won’t guess.`;
  }
  return { kind: "thin", title: EARLY(f.ts) ? "Not enough games yet" : "Too few games to read", text, fixes: fixesFor(f) };
}

/* ───────── rows from effects ───────── */
export const OUT_LABEL: Record<Outcome, string> = {
  dev: "Points vs prior avg",
  big5: "Big night +5",
  big10: "Big night +10",
  x125: "Big night ×1.25",
};

/** One contrast (level − reference) as a chart row. Points in PTS, rates in percentage points. */
export function effRow(
  key: string,
  label: string,
  sub: string | undefined,
  e: Eff | undefined,
  o: Outcome,
  opts: { n?: boolean; thinReason?: string; mark?: boolean } = {},
): ChartRow {
  const isDev = o === "dev";
  const base: ChartRow = { key, label, sub, est: null, mark: opts.mark };
  if (opts.thinReason) return { ...base, thin: true, thinTxt: opts.thinReason };
  if (!e) return { ...base, thin: true, thinTxt: "not available" };
  const n = opts.n === false ? undefined : `${fmtN(e.nl)} vs ${fmtN(e.nr)} games`;
  if (e.sup || e.d == null || e.lo == null || e.hi == null) {
    return { ...base, thin: true, thinTxt: "under 30 games on a side", n };
  }
  const sc = isDev ? 1 : 100;
  const t = (v: number) => sg(v * sc, isDev ? 2 : 1);
  return {
    ...base,
    est: e.d * sc,
    lo: e.lo * sc,
    hi: e.hi * sc,
    valText: t(e.d),
    unit: isDev ? "pts" : "pp",
    ciText: `${t(e.lo)} to ${t(e.hi)}`,
    n,
  };
}

export const effKind = (r: ChartRow, base = 0): Verdict =>
  r.thin || r.lo == null || r.hi == null ? "thin" : kindOf(r.lo, r.hi, base);

export function unitOf(o: Outcome): { axis: string; short: string } {
  return o === "dev"
    ? { axis: "Points vs his prior average (pts)", short: "pts" }
    : { axis: "Change in chance of a big night (percentage points)", short: "pp" };
}

export function measureWord(o: Outcome): string {
  return o === "dev"
    ? "points above his own prior average"
    : o === "big5"
      ? "the chance of scoring 5+ over his prior average"
      : o === "big10"
        ? "the chance of scoring 10+ over his prior average"
        : "the chance of scoring 1.25× his prior average or more";
}

export const nice = (n: number | null | undefined, d = 2) => (n == null ? "n/a" : n.toFixed(d));
