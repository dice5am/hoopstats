/** Shape of src/generated/big_nights.json (scripts/python/export_big_nights_json.py). */
export type BnEvent = "x125" | "x150" | "x200" | "p5" | "p10" | "z15";
export type BnBaseline = "std" | "l10";
export type BnSeg = "all" | "top100" | "top50";

/**
 * One factor × cell. Field order = `lift_fields` in the file:
 * [rate_level, rate_ref, n_level, events_level, rr, rr_lo, rr_hi, adj_or, adj_or_lo, adj_or_hi, adj_pp, adj_pp_lo, adj_pp_hi, flags]
 * flags: 1 = reportable, 2 = thin_level (under 30 players or 300 player-games at this level).
 */
export type BnLift = (number | null)[];

export type BnCount = { n_games: number; n_players: number; n_events: number; base_rate: number; thin: boolean; low_events?: boolean };

export type BnPerf = { auc: number; lo: number; hi: number; ctl: number | null; d: number | null; nt: number; ne: number };

export type BnRate = { n_games: number; n_players: number; n_events: number; value: number; ci: [number, number] | null; thin: boolean };

export type BnStarFactor = {
  factor: string;
  label: string;
  star_rr: number;
  star_rr_ci: [number, number];
  non_star_rr: number;
  non_star_rr_ci: [number, number];
  star_pp: number;
  non_star_pp: number;
  pp_diff: number;
  pp_diff_ci: [number, number];
  rr_ratio: number;
  rr_ratio_ci: [number, number];
};

export type BnInteraction = {
  n_tests: number;
  n_p_lt_05: number;
  expected_p_lt_05_by_chance: number;
  n_q_lt_10: number;
  significant_terms: { factor: string; star_or: number; non_star_or: number; interaction_or: number; ci: [number, number]; q: number }[];
};

export type BnStars = {
  base_rates: Record<string, { star: BnRate; non_star: BnRate; difference_star_minus_non_star: BnRate }>;
  factor_comparison: Record<string, BnStarFactor[]>;
  interaction_tests: Record<string, BnInteraction>;
};

export type BnProfileSide = {
  n_games: number;
  mean_pts: number;
  mean_prior_avg: number;
  d_min: number;
  d_fga: number;
  d_fta: number;
  d_3pa: number;
  d_usg_pp: number;
  d_ts_pp: number;
  share_minutes: number | null;
  share_shot_rate: number | null;
  share_efficiency: number | null;
};

export type BnPlayerSummary = {
  n_players: number;
  league_mean_diff: number;
  tau: number;
  n_abs_z_ge_2_5: number;
  expected_abs_z_ge_2_5_by_chance: number;
  n_p_lt_05: number;
  expected_p_lt_05_by_chance: number;
  n_credible_above_league: number;
  n_credible_below_league: number;
  n_credible_above_top50: number;
  n_stars_top50: number;
  provisional: boolean;
};

export type BnCredible = {
  id: string;
  name: string;
  an: "propensity_vs_expected" | "teammates_out_10plus";
  out: string;
  dir: "above" | "below";
  nc: number;
  nr: number;
  raw: number;
  sh: number;
  lo: number;
  hi: number;
  flag: string | null;
  z: number | null;
  top50: boolean;
};

export type BnContextCell = {
  tier: string;
  vac: string;
  n: number;
  players: number;
  thin: boolean;
  x150: { k: number; r: number | null; lo: number | null; hi: number | null };
  p10: { k: number; r: number | null; lo: number | null; hi: number | null };
};

export type BigNightsData = {
  through: string;
  status: string;
  provisional_timespans: string[];
  default: { timespan: string; segment: string; baseline: string; floor: number; events: string[] };
  definitions: Record<string, string>;
  counts: Record<string, Record<string, Record<string, BnCount>>>;
  lift_fields: string[];
  lift: Record<string, Record<string, Record<string, Record<string, Record<string, BnLift>>>>>;
  factor_labels: Record<string, { label: string; ref: string }>;
  perf: Record<string, Record<string, Record<string, BnPerf>>>;
  auc_range: { min: number; max: number; n: number; pooled_min: number; pooled_max: number; pooled_n: number };
  stars: Record<string, Record<string, BnStars>>;
  profile: Record<string, Record<string, Record<string, { big_night: BnProfileSide; other: BnProfileSide }>>>;
  players: Record<string, Record<string, Record<string, BnPlayerSummary>>>;
  credible: Record<string, BnCredible[]>;
  context: Record<string, BnContextCell[]>;
  context_tiers: string[];
  caveats: string[];
};
