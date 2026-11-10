import fs from "node:fs";
import path from "node:path";
import type { PlayerConditionsData } from "./playerConditionsTypes";

/** Generated from data/player_conditions_summary.json + data/marts/player_conditions_*.parquet by scripts/python/export_player_conditions_json.py. */
const FILE = path.join(process.cwd(), "src", "generated", "player_conditions.json");

export function loadPlayerConditions(): PlayerConditionsData {
  return JSON.parse(fs.readFileSync(FILE, "utf8")) as PlayerConditionsData;
}
