import fs from "node:fs";
import path from "node:path";
import {
  parseJsonAllowingNaN,
  type PlayerSplitsInsights,
} from "./playerSplitsTypes";

export type {
  PlayerSplits,
  PlayerSplitsInsights,
  RankEntry,
  FlaggedEntry,
  CmpKey,
  ScopeKey,
} from "./playerSplitsTypes";

export {
  SCOPE_ORDER,
  CMP_LABELS,
  COND_LABELS,
  SEGMENT_ROW_LABELS,
  parseJsonAllowingNaN,
  formatSigned,
  formatCi,
  isWatchFlag,
  isStrongFlag,
  gameRow,
} from "./playerSplitsTypes";

const AGG_FILE = path.join(
  process.cwd(),
  "data",
  "insights_player_splits.json",
);

export function loadPlayerSplitsInsights(): PlayerSplitsInsights {
  const raw = fs.readFileSync(AGG_FILE, "utf8");
  return parseJsonAllowingNaN<PlayerSplitsInsights>(raw);
}
