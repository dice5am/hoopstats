import type { ReactNode } from "react";
import type { InsightsData } from "../insightsTypes";
import type { PlayerSplitsInsights } from "../playerSplitsTypes";
import type { PointsDriversData } from "../pointsDriversTypes";
import type { DeepInsightsData } from "../deepInsightsTypes";
import type { BigNightsData } from "../bigNightsTypes";
import type { PlayerConditionsData } from "../playerConditionsTypes";
import type { SegmentKey, TimespanKey } from "../timespans";
import type { ResponderSource } from "./responders";

/** Card verdict. up/down only when a credible interval excludes the baseline. */
export type Verdict = "up" | "down" | "flat" | "thin" | "pend" | "info" | "err";

export type LegendKey = "up" | "down" | "flat" | "thin" | "whk" | "bl" | "ring" | "noise" | "obs" | "band";

export type Filters = { ts: TimespanKey; seg: SegmentKey };

/** Per-card selections: m = view switch, s = "Split by" / second switch. */
export type Sel = { m?: string; s?: string };

export type SwitchSpec = {
  key: "m" | "s";
  label?: string;
  value: string;
  options: { id: string; label: string; disabled?: boolean }[];
};

export type ChartRow = {
  key: string;
  label: string;
  sub?: string;
  est: number | null;
  lo?: number | null;
  hi?: number | null;
  /** text shown as the signed value (right) */
  valText?: string;
  unit?: string;
  /** under-plot line: CI text (left) and n (right) */
  ciText?: string;
  n?: string;
  /** hatched, nothing drawn */
  thin?: boolean;
  thinTxt?: string;
  thinVal?: string;
  /** player "watch" lead: hollow orange ring; filled only when strong */
  ring?: boolean;
  strong?: boolean;
  /** reference row (the middle tier): hollow dot at the baseline, no interval */
  ref?: boolean;
  /** no CI exists: neutral ink dot */
  neutral?: boolean;
  /** league-wide band (player-splits) */
  href?: string;
  /** marks the selected segment */
  mark?: boolean;
};

export type ChartSpec = {
  rows: ChartRow[];
  base: number;
  log?: boolean;
  mark: "bar" | "dot";
  axisTitle: string;
  endL?: string;
  endR?: string;
  /** override autoscale */
  min?: number;
  max?: number;
  /** hard lower bound for the axis (e.g. 0 for a rate) */
  floor?: number;
  ticks?: number[];
  tickFmt?: (t: number) => string;
  band?: [number, number];
  variant?: "detail" | "compact";
  label: string;
  /** a baseline label printed on the axis title row (e.g. "0.5 = coin flip") */
  baseLabel?: string;
};

export type Fix = { label: string; ts?: TimespanKey; seg?: SegmentKey };

export type CardState = {
  kind: "thin" | "pend" | "err";
  title: string;
  text: string;
  fixes?: Fix[];
};

export type Fact = { label: string; value: string };

export type CardModel = {
  verdict: Verdict;
  /** overrides the badge wording (e.g. "Curved") */
  badgeText?: string;
  headline: string;
  scan: { value: string; unit: string };
  /** scope-line parts, joined with " · " */
  scope: string[];
  /** pills in the scope line: "early sample", "segment n/a", … */
  pills: { text: string; hot?: boolean }[];
  how: string;
  switches: SwitchSpec[];
  body: ReactNode;
  legend: LegendKey[];
  facts: Fact[];
  sample: string;
  caveats: string[];
  method: string;
  state?: CardState;
  /** "Players most affected" block source (adapter: lib/insights/responders.ts) */
  responders?: ResponderSource;
  /** async cards render their own skeleton */
  async?: boolean;
};

export type Bundle = {
  insights: InsightsData;
  splits: PlayerSplitsInsights;
  drivers: PointsDriversData;
  deep: DeepInsightsData;
  bn: BigNightsData;
  pc: PlayerConditionsData;
};

export type Ctx = { f: Filters; data: Bundle; sel: Sel };

export type TopicId = "venue" | "matchups" | "big-nights" | "players" | "drivers";

export type Topic = { id: TopicId; label: string; q: string };
