/** Timespan and PPG-segment ids from insights-home-away-b2b-v2 / player-splits-v2. */

export type TimespanKey =
  | "pooled_2023_27"
  | "pooled_2023_26"
  | "2023_24"
  | "2024_25"
  | "2025_26"
  | "2026_27";

export type SegmentKey = "all" | "top100" | "top50" | "top25" | "top10";

export const TIMESPAN_ORDER: TimespanKey[] = [
  "pooled_2023_27",
  "pooled_2023_26",
  "2023_24",
  "2024_25",
  "2025_26",
  "2026_27",
];

export const SEGMENT_ORDER: SegmentKey[] = [
  "all",
  "top100",
  "top50",
  "top25",
  "top10",
];

/** Compact switcher labels; keys are the JSON timespan ids. */
export const TIMESPAN_SWITCH_LABEL: Record<TimespanKey, string> = {
  pooled_2023_27: "4 seasons pooled",
  pooled_2023_26: "3 seasons 2023–26",
  "2023_24": "2023-24",
  "2024_25": "2024-25",
  "2025_26": "2025-26",
  "2026_27": "2026-27",
};

export const SEGMENT_SWITCH_LABEL: Record<SegmentKey, string> = {
  all: "All",
  top100: "Top 100",
  top50: "Top 50",
  top25: "Top 25",
  top10: "Top 10",
};

/** Map a game's `season` field (2025-26) onto a timespan id. */
export function gameInTimespan(season: string, ts: string): boolean {
  const key = season.replace("-", "_");
  if (ts === key) return true;
  if (ts === "pooled_2023_27") return true;
  if (ts === "pooled_2023_26") return key !== "2026_27";
  return false;
}
