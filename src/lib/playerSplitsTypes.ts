/** Client-safe types for player-splits-v1 / insights-player-splits-v1. */

export type ScopeKey = "2025-26" | "2026-27" | "combined";
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

export type SeasonBlock = {
  conditions: Record<string, Condition>;
  comparisons: Record<string, Comparison>;
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
  seasons: Record<string, SeasonBlock | null>;
  league: Record<
    string,
    {
      comparisons: Record<string, LeagueCmp>;
      conditions: Record<string, { n_players: number; pts: number; min: number; per36: number }>;
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
  scope: ScopeKey;
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

export const SCOPE_ORDER: ScopeKey[] = ["2025-26", "2026-27", "combined"];

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
