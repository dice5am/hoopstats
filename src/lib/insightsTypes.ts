import type { SegmentKey, TimespanKey } from "./timespans";

export type { SegmentKey, TimespanKey };

export type MetricStats = {
  mean: number;
  median: number;
  ci95: [number, number] | null;
  p: number | null;
  mean_a: number;
  mean_b: number;
};

export type ComparisonBlock = {
  n_players: number;
  n_units: number;
  games_a: number;
  games_b: number;
  pts: MetricStats | null;
  minutes: MetricStats | null;
  per36: MetricStats | null;
  small_n: boolean;
};

export type SegmentResult = {
  segment_size: number;
  ppg_floor_min_games: number;
  ppg_rank_max: number | null;
  n_ranked: number;
  ppg_range: [number, number] | null;
  home_away: ComparisonBlock | null;
  b2b_2nd: ComparisonBlock | null;
  b2b_1st: ComparisonBlock | null;
};

export type SecondaryCut = {
  home_away: ComparisonBlock | null;
  b2b_2nd: ComparisonBlock | null;
  b2b_1st: ComparisonBlock | null;
};

export type TimespanInfo = {
  label: string;
  seasons: string[];
  pooled: boolean;
  min_games_floor: number;
  n_players_with_games: number;
  n_ranked: number;
  data_as_of: string | null;
};

export type InsightsData = {
  schema_version: string;
  data_as_of: Record<string, string>;
  default: { timespan: TimespanKey; segment: SegmentKey };
  timespans: TimespanKey[];
  segments: SegmentKey[];
  timespan_info: Record<string, TimespanInfo>;
  segment_info: Record<string, string>;
  metric_note: string;
  definitions: Record<string, unknown> & {
    min_games_per_side?: number;
  };
  caveats: string[];
  results: Record<string, Record<string, SegmentResult>>;
  secondary: Record<
    string,
    {
      position?: Record<string, SecondaryCut | number>;
      age?: Record<string, SecondaryCut | number>;
      experience?: Record<string, SecondaryCut | number>;
    }
  >;
};

export const SECONDARY_ORDER = {
  position: ["G", "F", "C"],
  age: ["le_23", "24_27", "28_31", "32_plus"],
  experience: ["rookie", "1_3", "4_7", "8_plus"],
} as const;

export const SECONDARY_LABELS: Record<string, string> = {
  G: "Guards",
  F: "Forwards",
  C: "Centers",
  le_23: "≤23",
  "24_27": "24–27",
  "28_31": "28–31",
  "32_plus": "32+",
  rookie: "Rookie",
  "1_3": "1–3 yrs",
  "4_7": "4–7 yrs",
  "8_plus": "8+ yrs",
};

export const SECONDARY_TITLES: Record<keyof typeof SECONDARY_ORDER, string> = {
  position: "By position",
  age: "By age",
  experience: "By experience",
};

export function blockHasMetric(
  block: ComparisonBlock | null | undefined,
  metric: "pts" | "minutes" | "per36" = "pts",
): boolean {
  if (!block) return false;
  if (block.n_units <= 0) return false;
  const stats = block[metric];
  return stats != null && typeof stats.mean === "number";
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
