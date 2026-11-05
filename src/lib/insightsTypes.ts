export type ScopeKey = "2025-26" | "2026-27" | "combined";

export type MetricStats = {
  mean: number;
  median: number;
  ci95: [number, number];
  p: number;
  mean_a: number;
  mean_b: number;
};

export type MetricBlock = {
  n_players: number;
  n_units: number;
  games_a: number;
  games_b: number;
  pts: MetricStats | null;
  minutes: MetricStats | null;
  per36: MetricStats | null;
  small_n: boolean;
};

export type SegmentMap = Record<string, MetricBlock | number>;

export type ScopeBlock = {
  overall: MetricBlock;
  segments: {
    position: SegmentMap;
    age: SegmentMap;
    experience: SegmentMap;
    scorer_tier: SegmentMap;
  };
};

export type Comparison = {
  label: string;
  a: string;
  b: string;
  by_scope: Record<ScopeKey, ScopeBlock>;
};

export type InsightsData = {
  schema_version: string;
  data_as_of: Record<string, string>;
  metric_note: string;
  definitions: Record<string, unknown> & {
    min_games_per_side?: number;
  };
  caveats: string[];
  results: {
    home_away: Comparison;
    b2b_second_vs_rested: Comparison;
    b2b_first_vs_rested: Comparison;
  };
};

export const SCOPE_ORDER: ScopeKey[] = ["2025-26", "2026-27", "combined"];

export const SEGMENT_ORDER = {
  position: ["G", "F", "C"],
  age: ["le_23", "24_27", "28_31", "32_plus"],
  experience: ["rookie", "1_3", "4_7", "8_plus"],
  scorer_tier: ["top_10", "11_25", "26_50", "51_100", "rest"],
} as const;

export const SEGMENT_LABELS: Record<string, string> = {
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
  top_10: "Top 10",
  "11_25": "11–25",
  "26_50": "26–50",
  "51_100": "51–100",
  rest: "Rest",
};

export const SEGMENT_TITLES: Record<keyof typeof SEGMENT_ORDER, string> = {
  position: "By position",
  age: "By age",
  experience: "By experience",
  scorer_tier: "By scorer tier",
};

export function scopeHasMetric(
  block: MetricBlock | undefined,
  metric: "pts" | "minutes" | "per36" = "pts",
): boolean {
  if (!block) return false;
  if (block.n_units <= 0) return false;
  return block[metric] != null;
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
