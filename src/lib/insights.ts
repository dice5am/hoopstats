import fs from "node:fs";
import path from "node:path";
import type { InsightsData } from "./insightsTypes";

export type {
  TimespanKey,
  SegmentKey,
  MetricStats,
  ComparisonBlock,
  SegmentResult,
  InsightsData,
} from "./insightsTypes";

export {
  SECONDARY_ORDER,
  SECONDARY_LABELS,
  SECONDARY_TITLES,
  blockHasMetric,
  formatSigned,
  formatCi,
} from "./insightsTypes";

const DATA_FILE = path.join(
  process.cwd(),
  "data",
  "insights_home_away_b2b.json",
);

export function loadInsights(): InsightsData {
  const raw = fs.readFileSync(DATA_FILE, "utf8");
  return JSON.parse(raw) as InsightsData;
}
