import type { SegmentKey, TimespanKey } from "./timespans";

export type Outcome = "dev" | "big5" | "big10" | "x125";

export type Eff = {
  l: number | null; // level mean / rate
  r: number | null; // reference mean / rate
  d: number | null; // diff (PTS for dev, probability for the rest)
  lo: number | null;
  hi: number | null;
  nl: number;
  nr: number;
  rr: number | null; // rate ratio (big-night outcomes)
  rrlo: number | null;
  rrhi: number | null;
  sup: boolean; // < 30 games on a side: contrast blanked
};

export type TailTerm = {
  or: number | null;
  lo: number | null;
  hi: number | null;
  pp: number | null;
  pplo: number | null;
  pphi: number | null;
};

export type TailOutcome = {
  base: number | null;
  events: number | null;
  terms: Record<string, TailTerm>;
};

export type Perf = {
  auc: number | null;
  slope: number | null;
  train: number | null;
  test: number | null;
  n_test: number;
  ll: number | null;
  llo: number | null;
  lhi: number | null;
};

export type SdRatio = { r: number | null; lo: number | null; hi: number | null };

export type Curve = {
  p: number | null;
  pts: [number, number | null, number | null, number | null][];
};

export type DeepCell = {
  thin: boolean;
  n_players: number;
  n_games: number;
  eff?: Record<string, Partial<Record<Outcome, Eff>>>;
  tail?: Partial<Record<"big5" | "big10" | "x125", TailOutcome>>;
  perf?: Partial<Record<"big5" | "big10" | "x125", Perf>>;
  sd?: Record<string, SdRatio>;
  spline?: { def?: Curve; pace?: Curve };
};

export type ModLevel = {
  e: number | null;
  lo: number | null;
  hi: number | null;
  p: number | null;
  n: number;
};

export type FlagRow = {
  condition: string;
  outcome: Outcome;
  n_players: number;
  tau: number | null;
  n_flag_strong_q10: number;
  n_flag_watch_z25: number;
  expected_watch_by_chance: number;
  n_p_lt_05: number;
  expected_p_lt_05_by_chance: number;
  n_above_league: number;
  n_below_league: number;
  n_credible_up_top50: number;
  n_above_league_top50: number;
  n_below_league_top50: number;
  n_stars_top50: number;
  league_mean_diff: number | null;
  league_mean_ci_low: number | null;
  league_mean_ci_high: number | null;
  provisional: boolean;
};

export type DeepInsightsData = {
  through: string | null;
  outcomes: Record<Outcome, string>;
  auc: {
    min: number;
    max: number;
    n: number;
    pooled_min: number;
    pooled_max: number;
    pooled_n: number;
  };
  cells: Record<string, Record<string, DeepCell>>;
  interactions: Record<
    string,
    Record<"position" | "role", Partial<Record<"dev" | "big10" | "x125", Record<string, ModLevel>>>>
  >;
  flags: Record<string, FlagRow[]>;
};

export function deepCell(
  data: DeepInsightsData,
  ts: TimespanKey,
  seg: SegmentKey,
): DeepCell | undefined {
  return data.cells[ts]?.[seg];
}
