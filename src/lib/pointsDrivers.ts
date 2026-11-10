import fs from "node:fs";
import path from "node:path";
import type { PointsDriversData } from "./pointsDriversTypes";

/**
 * Generated from data/marts/points_drivers.parquet by
 * scripts/python/export_points_drivers_json.py (kept outside data/).
 */
const FILE = path.join(process.cwd(), "src", "generated", "points_drivers.json");

export function loadPointsDrivers(): PointsDriversData {
  return JSON.parse(fs.readFileSync(FILE, "utf8")) as PointsDriversData;
}
