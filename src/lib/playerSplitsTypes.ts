/** Client-safe types for player-splits-v2 / insights-player-splits-v2. */

import type { TimespanKey, SegmentKey } from "./timespans";

export type { TimespanKey, SegmentKey };
export type ScopeKey = TimespanKey;
export type CmpKey =
  | "home_away"
  | "b2b_second_vs_rested"
  | "b2b_first_vs_rested";
export type CondKey = "home" | "away" | "b2b_2nd" | "b2b_1st" | "rested";

export type PtsStats = {
  raw: number;
  shrunk: number;
  shrink_weight: number;
  se: number;
  ci95: [number, number];
  z: number;
  p: number;
  q: number;
  percentile: number;
  flag: string | null;
};

export type QualifyingCmp = {
  qualifies: true;
  n_a: number;
  n_b: number;
  pts: PtsStats;
  minutes: { raw: number; ci95: [number, number] };
  per36: { raw: number };
};

export type NonQualifyingCmp = {
  qualifies: false;
  n_a: number;
  n_b: number;
};

export type Comparison = QualifyingCmp | NonQualifyingCmp;

export type Condition = {
  n: number;
  pts: number | null;
  pts_sd: number | null;
  min: number | null;
  per36: number | null;
};

export type SeasonSegment = {
  gp: number;
  ppg: number;
  ppg_rank: number | null;
  meets_floor: boolean;
  min_games_floor: number;
  segments: string[];
  segment_league?: Record<
    string,
    Record<string, { n_players: number; pts_mean: number; pts_median: number; min_mean: number; per36_mean: number }>
  >;
};

export type SeasonBlock = {
  conditions: Record<string, Condition>;
  comparisons: Record<string, Comparison>;
  segment?: SeasonSegment;
};

export type LeagueCmp = {
  n_players: number;
  pts_mean: number;
  pts_median: number;
  tau: number;
  min_mean: number;
  per36_mean: number;
};

export type PlayerSplits = {
  schema_version: string;
  player_id: string;
  full_name: string;
  team: string | null;
  data_as_of: Record<string, string>;
  timespans?: TimespanKey[];
  default_timespan?: TimespanKey;
  seasons: Record<string, SeasonBlock | null>;
  league: Record<
    string,
    {
      comparisons: Record<string, LeagueCmp & { n_strong_all_players?: number; n_watch_all_players?: number }>;
      conditions: Record<string, { n_players: number; pts: number; min: number; per36: number }>;
      by_segment?: Record<string, Record<string, { n_players: number; pts_mean: number; pts_median: number; min_mean: number; per36_mean: number }>>;
      timespan?: string;
    }
  >;
  game_fields: string[];
  /** Compact rows matching game_fields order. */
  games: (string | number | null)[][];
};

export type RankEntry = {
  player_id: string;
  full_name: string;
  team: string | null;
  qualifies: boolean;
  n_a: number;
  n_b: number;
  pts: PtsStats;
  minutes: { raw: number; ci95: [number, number] };
  per36: { raw: number };
};

export type RankingBlock = {
  n_ranked: number;
  shrunk_is_flat: boolean;
  by_shrunk: { top: RankEntry[]; bottom: RankEntry[] };
  by_raw: { top: RankEntry[]; bottom: RankEntry[] };
};

export type FlaggedEntry = RankEntry & {
  scope: string;
  comparison: CmpKey;
};

export type HeatmapSegment = {
  rows: string[];
  cond_cols: string[];
  pts: (number | null)[][];
  n: number[][];
  cmp_cols: string[];
  cmp_pts_mean: (number | null)[][];
  cmp_n: number[][];
};

export type PlayerSplitsInsights = {
  schema_version: string;
  data_as_of: Record<string, string>;
  default?: { timespan: TimespanKey; segment: SegmentKey };
  timespans?: TimespanKey[];
  segments?: SegmentKey[];
  definitions: Record<string, string>;
  ranking_note: string;
  ranking_population: string;
  league: Record<string, unknown>;
  rankings: Record<string, Record<string, RankingBlock>>;
  heatmaps: {
    segment_x_condition: Record<string, Record<string, HeatmapSegment>>;
    player_x_condition: Record<string, unknown>;
  };
  distributions: Record<string, unknown>;
  flagged: FlaggedEntry[];
  caveats: string[];
};

export { TIMESPAN_ORDER as SCOPE_ORDER, TIMESPAN_SWITCH_LABEL, SEGMENT_SWITCH_LABEL, gameInTimespan } from "./timespans";

export const LEGACY_SCOPE_ORDER: string[] = ["2025-26", "2026-27", "combined"];

export const CMP_LABELS: Record<CmpKey, string> = {
  home_away: "Home vs away",
  b2b_second_vs_rested: "B2B 2nd vs rested",
  b2b_first_vs_rested: "B2B 1st vs rested",
};

export const COND_LABELS: Record<string, string> = {
  home: "Home",
  away: "Away",
  b2b_2nd: "B2B 2nd",
  b2b_1st: "B2B 1st",
  rested: "Rested",
};

export const SEGMENT_ROW_LABELS: Record<string, string> = {
  G: "Guards",
  F: "Forwards",
  C: "Centers",
  le_23: "≤23",
  "24_27": "24–27",
  "28_31": "28–31",
  "32_plus": "32+",
  rookie: "Rookie",
  "1_3": "1–3",
  "4_7": "4–7",
  "8_plus": "8+",
  top_10: "Top 10",
  "11_25": "11–25",
  "26_50": "26–50",
  "51_100": "51–100",
  rest: "Rest",
  all: "All",
  top100: "Top 100",
  top50: "Top 50",
  top25: "Top 25",
  top10: "Top 10",
};

/** Parse JSON that may contain Python-style NaN (invalid JSON). */
export function parseJsonAllowingNaN<T>(text: string): T {
  return JSON.parse(text.replace(/:\s*NaN\b/g, ":null")) as T;
}

export function formatSigned(n: number, digits = 2): string {
  const abs = Math.abs(n).toFixed(digits);
  if (n > 0) return `+${abs}`;
  if (n < 0) return `−${abs}`;
  return abs;
}

export function formatCi(ci: [number, number], digits = 2): string {
  return `${formatSigned(ci[0], digits)} to ${formatSigned(ci[1], digits)}`;
}

export function isWatchFlag(flag: string | null | undefined): boolean {
  return typeof flag === "string" && flag.includes("watch");
}

export function isStrongFlag(flag: string | null | undefined): boolean {
  return typeof flag === "string" && flag.includes("strong");
}

export function gameRow(
  fields: string[],
  row: (string | number | null)[],
): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = {};
  fields.forEach((f, i) => {
    out[f] = row[i] ?? null;
  });
  return out;
}
