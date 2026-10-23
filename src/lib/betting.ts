import fs from "node:fs";
import path from "node:path";

/** One past game, newest first (contract `betting-points-v1`, lastK_*). */
export type PointsGame = {
  pts: number;
  date: string; // NBA local game date, YYYY-MM-DD
  opp: string;
  homeAway: "home" | "away";
};

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
  data_as_of_game_date: string | null;
  pulled_at_utc: string | null;
};

type RawRow = Record<string, unknown>;

const DATA_FILE = path.join(process.cwd(), "data", "betting_points.json");

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
    data_as_of_game_date: str(r.data_as_of_game_date)?.slice(0, 10) ?? null,
    pulled_at_utc: str(r.pulled_at_utc),
  };
}

/** Read the static export committed to the repo. Missing file ⇒ empty list. */
export function loadPointsRows(): PointsRow[] {
  if (!fs.existsSync(DATA_FILE)) return [];
  const raw = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) as RawRow[];
  return raw
    .map(toRow)
    .filter((r) => r.full_name)
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
}
