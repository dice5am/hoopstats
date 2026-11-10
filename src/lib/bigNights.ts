import fs from "node:fs";
import path from "node:path";
import type { BigNightsData } from "./bigNightsTypes";

/**
 * Generated from data/big_nights_summary.json + data/marts/big_night_*.parquet
 * by scripts/python/export_big_nights_json.py.
 */
const FILE = path.join(process.cwd(), "src", "generated", "big_nights.json");

export function loadBigNights(): BigNightsData {
  return JSON.parse(fs.readFileSync(FILE, "utf8")) as BigNightsData;
}
