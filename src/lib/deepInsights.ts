import fs from "node:fs";
import path from "node:path";
import type { DeepInsightsData } from "./deepInsightsTypes";

/**
 * Generated from data/marts/{tier_effects,tail_models,tail_performance,
 * spline_effects,interaction_effects,dispersion_effects}.parquet and
 * data/deep_analyses_summary.json by scripts/python/export_deep_insights_json.py.
 */
const FILE = path.join(process.cwd(), "src", "generated", "deep_insights.json");

export function loadDeepInsights(): DeepInsightsData {
  return JSON.parse(fs.readFileSync(FILE, "utf8")) as DeepInsightsData;
}
