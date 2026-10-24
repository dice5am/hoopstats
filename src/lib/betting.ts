import fs from "node:fs";
import path from "node:path";

/** One past game, newest first (contract `betting-points-v1`, lastK_*). */
export type PointsGame = {
  pts: number;
  date: string; // NBA local game date, YYYY-MM-DD
  opp: string;
  homeAway: "home" | "away";
};

import type { SlotStatus, TeamGame } from "./teamGames";

export type { PastGame, SlotStatus, TeamGame } from "./teamGames";

/** Slim projection of a `player_points_betting` row — points only. */
export type PointsRow = {
  player_id: string;
  full_name: string;
  team_abbreviation: string | null;
  position: string | null;
  last_game_team_abbreviation: string | null;
  team_changed_vs_last_game: boolean;
  has_season_games: boolean;
  gp_season: number | null;
  pts_season_avg: number | null;
  month_key: string;
  gp_month: number | null;
  pts_month_avg: number | null;
  last_season_pts_avg: number | null;
  last_season_gp: number | null;
  n_last: number | null;
  last: PointsGame[];
  teamGames: TeamGame[];
  /** Columns on the season chart. From Data's `slot_total` (v2+). */
  slotTotal: number;
  data_as_of_game_date: string | null;
  pulled_at_utc: string | null;
};

type RawRow = Record<string, unknown>;

const DATA_FILE = path.join(process.cwd(), "data", "betting_points.json");
/**
 * Team-games export. Swap point: copy Data's gated file here and record its
 * sha in data/SOURCES.md. Only this loader reads it.
 */
const TEAM_GAMES_FILE = path.join(
  process.cwd(),
  "data",
  "player_team_games.json",
);
/** Fallback only while the file has no `slot_total` (v1): 82 regular-season games. */
const V1_SEASON_GAMES = 82;
const STATUSES: readonly SlotStatus[] = [
  "played",
  "missed",
  "scheduled",
  "tbd",
  "not_on_team",
];

function toTeamGames(raw: unknown): TeamGame[] {
  if (!Array.isArray(raw)) return [];
  const out: TeamGame[] = [];
  for (const g of raw as RawRow[]) {
    // Regular season only: the NBA Cup final never counts (Cup group and
    // knockout games do). Dropped defensively until Data ships files without it.
    if (g.is_cup_final === true) continue;
    const status = g.status as SlotStatus;
    if (!STATUSES.includes(status)) continue;
    const ha =
      g.home_away === "home" || g.home_away === "away" ? g.home_away : null;
    const seq = num(g.game_seq) ?? out.length + 1;
    out.push({
      seq,
      slotKey: str(g.slot_key) ?? str(g.game_id) ?? `slot-${seq}`,
      gameId: str(g.game_id),
      date: str(g.game_date)?.slice(0, 10) ?? null,
      opp: str(g.opponent_abbreviation),
      homeAway: ha,
      team: str(g.team_abbreviation),
      status,
      pts: status === "played" ? num(g.pts) : null,
    });
  }
  // File order is the season order (tbd slots have no date), so keep it by seq.
  return out.sort((a, b) => a.seq - b.seq);
}

type TeamGamesEntry = { games: TeamGame[]; slotTotal: number };

function loadTeamGames(): Map<string, TeamGamesEntry> {
  const m = new Map<string, TeamGamesEntry>();
  if (!fs.existsSync(TEAM_GAMES_FILE)) return m;
  const raw = JSON.parse(fs.readFileSync(TEAM_GAMES_FILE, "utf8")) as RawRow[];
  for (const r of raw) {
    const games = toTeamGames(r.games);
    const fromFile = num(r.slot_total);
    let slotTotal: number;
    if (fromFile !== null) {
      slotTotal = Math.max(fromFile, games.length);
    } else {
      // v1 has past games only: pad with scheduled slots to 82 (exact while nobody is traded).
      while (games.length < V1_SEASON_GAMES) {
        games.push({
          seq: games.length + 1,
          slotKey: `slot-${games.length + 1}`,
          gameId: null,
          date: null,
          opp: null,
          homeAway: null,
          team: null,
          status: "scheduled",
          pts: null,
        });
      }
      slotTotal = games.length;
    }
    m.set(String(r.player_id), { games, slotTotal });
  }
  return m;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function toRow(r: RawRow): PointsRow {
  const nLast = num(r.n_last);
  const last: PointsGame[] = [];
  for (let k = 1; k <= (nLast ?? 0); k++) {
    const pts = num(r[`last${k}_pts`]);
    const date = str(r[`last${k}_date`]);
    const opp = str(r[`last${k}_opp`]);
    const ha = r[`last${k}_home_away`];
    if (pts === null || !date || !opp || (ha !== "home" && ha !== "away")) {
      continue;
    }
    last.push({ pts, date: date.slice(0, 10), opp, homeAway: ha });
  }
  return {
    player_id: String(r.player_id),
    full_name: String(r.full_name ?? ""),
    team_abbreviation: str(r.team_abbreviation),
    position: str(r.position),
    last_game_team_abbreviation: str(r.last_game_team_abbreviation),
    team_changed_vs_last_game: r.team_changed_vs_last_game === true,
    has_season_games: r.has_season_games === true,
    gp_season: num(r.gp_season),
    pts_season_avg: num(r.pts_season_avg),
    month_key: String(r.month_key ?? ""),
    gp_month: num(r.gp_month),
    pts_month_avg: num(r.pts_month_avg),
    last_season_pts_avg: num(r.last_season_pts_avg),
    last_season_gp: num(r.last_season_gp),
    n_last: nLast,
    last,
    teamGames: [],
    slotTotal: 0,
    data_as_of_game_date: str(r.data_as_of_game_date)?.slice(0, 10) ?? null,
    pulled_at_utc: str(r.pulled_at_utc),
  };
}

/** Read the static export committed to the repo. Missing file ⇒ empty list. */
export function loadPointsRows(): PointsRow[] {
  if (!fs.existsSync(DATA_FILE)) return [];
  const raw = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) as RawRow[];
  const teamGames = loadTeamGames();
  return raw
    .map((r) => {
      const row = toRow(r);
      const tg = teamGames.get(row.player_id);
      row.teamGames = tg?.games ?? [];
      row.slotTotal = tg?.slotTotal ?? 0;
      return row;
    })
    .filter((r) => r.full_name)
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
}
