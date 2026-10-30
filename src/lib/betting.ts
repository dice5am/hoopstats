import fs from "node:fs";
import path from "node:path";

/** One past game, newest first (contract `betting-points-v1`, lastK_*). */
export type PointsGame = {
  pts: number;
  date: string; // NBA local game date, YYYY-MM-DD
  opp: string;
  homeAway: "home" | "away";
};

import {
  DEFAULT_SOURCE,
  sourceNoteOf,
  chartCells,
  isPastGame,
  exitReasonOf,
  joinReasonOf,
  tradeTicks,
} from "./teamGames";
import type {
  PastGame,
  SourceNote,
  PlayerSlots,
  SeasonSlots,
  SlotStatus,
  TeamGame,
} from "./teamGames";

export type {
  PastGame,
  PlayerSlots,
  SeasonSlots,
  SlotStatus,
  TeamGame,
} from "./teamGames";

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
  /**
   * His team's last 5 dated past games (played or missed) while on the
   * roster, oldest first — from the 2026-27 slots, precomputed so the last-5
   * chart renders with the tiles. The season charts load /slots/<id>.json.
   */
  last5: PastGame[];
  /** His team has a final 2026-27 game (played or missed) on his chart. */
  teamPlayed: boolean;
  /**
   * His 2025-26 slot_total. `null` = no 2025-26 slot file at build (section
   * hidden); `0` = no 2025-26 games ("No 2025-26 games"); `> 0` = chart,
   * even if every slot is Out. Drives the 2025-26 tile before any fetch.
   */
  slotTotal2526: number | null;
  /** Legend/header shape of each chart, so the loading frame keeps its size. */
  shape: { cur: ChartShape; prev: ChartShape | null };
  data_as_of_game_date: string | null;
  pulled_at_utc: string | null;
};

/** What decides the season chart's header and legend rows. */
export type ChartShape = {
  played: boolean;
  notOn: boolean;
  /** Draws at least one stint tick → the marker band reserves MARKER_BAND_ROWS. */
  hasMarkers: boolean;
  /**
   * 2025-26 only: the chart draws a source footnote under its legend (key
   * absent for no note, so the payload stays compact). Lets the loading and
   * failed frames reserve the line.
   */
  sourceNote?: SourceNote;
};

type RawRow = Record<string, unknown>;

const DATA_FILE = path.join(process.cwd(), "data", "betting_points.json");
/**
 * Team-games export. Swap point: copy Data's gated file here and record its
 * sha in data/SOURCES.md, or point HOOPSTATS_TEAM_GAMES_2026_27 at it at build
 * time (e.g. to test an ungated file). Only this loader reads it.
 */
const TEAM_GAMES_FILE =
  process.env.HOOPSTATS_TEAM_GAMES_2026_27 ||
  path.join(process.cwd(), "data", "player_team_games.json");
/**
 * 2025-26 team-games export (complete season, same row shape plus
 * `not_on_team` slots and `trade_marker`). Swap point: drop Data's gated file
 * here, or point HOOPSTATS_TEAM_GAMES_2025_26 at it at build time. Missing
 * file ⇒ no 2025-26 chart.
 */
const TEAM_GAMES_2025_26_FILE =
  process.env.HOOPSTATS_TEAM_GAMES_2025_26 ||
  path.join(process.cwd(), "data", "player_team_games_2025_26.json");
/**
 * Per-row provenance field in both seasons' team-games exports (from
 * 2025-26 v1.3 / 2026-27 v2.4 every row has one: DEFAULT_SOURCE in
 * teamGames.ts, or e.g. "basketball-reference"; missing → DEFAULT_SOURCE).
 * The one place to rename it if Data changes the key. Data-only: carried to
 * /slots (non-default only), never drawn.
 */
export const SOURCE_FIELD = "source";
/** Fallback only while the file has no `slot_total` (v1): 82 regular-season games. */
const V1_SEASON_GAMES = 82;
const STATUSES: readonly SlotStatus[] = [
  "played",
  "missed",
  "scheduled",
  "tbd",
  "not_on_team",
];
/** Status aliases seen in draft/gated exports. */
const STATUS_ALIASES: Record<string, SlotStatus> = {
  out: "missed",
  offteam: "not_on_team",
};

/**
 * Normalise one player row's `games` into chart slots. Played counts come
 * only from `status === "played"` (0-minute rows arrive as non-played).
 * `trade_marker` may be per-slot (`true`) or, from v1.1/v2.2, a per-player
 * list of `{game_seq, game_date, from_team, to_team}` — one entry for the
 * first slot on each new team (1-based `game_seq`); `[]` = never traded.
 */
export function toTeamGames(
  raw: unknown,
  tradeList?: unknown,
  exitList?: unknown,
): TeamGame[] {
  if (!Array.isArray(raw)) return [];
  const out: TeamGame[] = [];
  for (const g of raw as RawRow[]) {
    // Regular season only: the NBA Cup final never counts (Cup group and
    // knockout games do). Dropped defensively until Data ships files without it.
    if (g.is_cup_final === true) continue;
    const rawStatus = String(g.status ?? "");
    const status = (STATUS_ALIASES[rawStatus] ?? rawStatus) as SlotStatus;
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
      ...(g.trade_marker === true ? { tradeMarker: true } : {}),
      source: sourceOf(g[SOURCE_FIELD]),
    });
  }
  // File order is the season order (tbd slots have no date), so keep it by seq.
  out.sort((a, b) => a.seq - b.seq);
  if (Array.isArray(tradeList)) applyTradeList(out, tradeList as RawRow[]);
  if (Array.isArray(exitList)) applyExitList(out, exitList as RawRow[]);
  return out;
}

/** "2026-02-07" or "02-07" (month-day) — does `iso` fall on that date? */
function sameDate(iso: string | null, d: string | null): boolean {
  if (!iso || !d) return false;
  return d.length <= 5 ? iso.slice(5) === d.padStart(5, "0") : iso === d.slice(0, 10);
}

/**
 * List-form markers replace any per-slot flags: each entry marks the slot at
 * `game_seq` (cross-checked with `game_date` when given; if they disagree
 * the date wins, else the next slot from that seq), labelled `to_team`.
 */
function findSlot(games: TeamGame[], t: RawRow): TeamGame | undefined {
  const seq = num(t.game_seq);
  const date = str(t.game_date);
  let hit = seq !== null ? games.find((g) => g.seq === seq) : undefined;
  if (date && (!hit || (hit.date && !sameDate(hit.date, date)))) {
    hit = games.find((g) => sameDate(g.date, date)) ?? hit;
  }
  if (!hit && seq !== null) hit = games.find((g) => g.seq >= seq);
  return hit;
}

function applyTradeList(games: TeamGame[], list: RawRow[]): void {
  for (const g of games) {
    delete g.tradeMarker;
    delete g.tradeTo;
    delete g.joinReason;
  }
  for (const t of list) {
    const hit = findSlot(games, t);
    if (!hit) continue;
    hit.tradeMarker = true;
    const to = str(t.to_team) ?? hit.team;
    if (to) hit.tradeTo = to;
    const reason = joinReasonOf(t.reason);
    if (reason) hit.joinReason = reason;
  }
}

/**
 * `exit_marker`: per-player list of `{game_seq, game_date, team, reason}`,
 * each the first Not on team slot after a stint. Only known reasons draw
 * (waived → "Waived by", contract end / ten-day end / left → "Left");
 * a null, missing or unknown reason draws nothing.
 */
function applyExitList(games: TeamGame[], list: RawRow[]): void {
  for (const t of list) {
    const reason = exitReasonOf(t.reason);
    const team = str(t.team);
    if (!reason || !team) continue;
    const hit = findSlot(games, t);
    if (!hit) continue;
    (hit.exits ??= []).push({ team, reason });
  }
}

type TeamGamesEntry = SeasonSlots;

function seasonOf(r: RawRow, games: TeamGame[], slotTotal: number): SeasonSlots {
  return Array.isArray(r.trade_marker)
    ? { games, slotTotal, explicitTrades: true }
    : { games, slotTotal };
}

/**
 * A completed season (2025-26): slots are exactly what Data ships, no
 * padding. `null` when the file is not there.
 */
function loadCompleteSeason(file: string): Map<string, TeamGamesEntry> | null {
  if (!fs.existsSync(file)) return null;
  const m = new Map<string, TeamGamesEntry>();
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as RawRow[];
  for (const r of raw) {
    const games = toTeamGames(r.games, r.trade_marker, r.exit_marker).filter(
      (g) => g.status !== "scheduled" && g.status !== "tbd",
    );
    // Every player has an entry (v1.1); slot_total 0 means "No 2025-26
    // games". An entry with every slot Out still draws (all-Out chart).
    const slotTotal = Math.max(num(r.slot_total) ?? 0, games.length);
    if (slotTotal === 0 || games.length === 0) continue;
    m.set(String(r.player_id), seasonOf(r, games, slotTotal));
  }
  return m;
}

function loadTeamGames(): Map<string, TeamGamesEntry> {
  const m = new Map<string, TeamGamesEntry>();
  if (!fs.existsSync(TEAM_GAMES_FILE)) return m;
  const raw = JSON.parse(fs.readFileSync(TEAM_GAMES_FILE, "utf8")) as RawRow[];
  for (const r of raw) {
    const games = toTeamGames(r.games, r.trade_marker, r.exit_marker);
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
          source: DEFAULT_SOURCE,
        });
      }
      slotTotal = games.length;
    }
    m.set(String(r.player_id), seasonOf(r, games, slotTotal));
  }
  return m;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** Row provenance: trimmed non-empty string; missing/blank → DEFAULT_SOURCE. */
function sourceOf(v: unknown): string {
  return (typeof v === "string" && v.trim()) || DEFAULT_SOURCE;
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
    last5: [],
    teamPlayed: false,
    slotTotal2526: null,
    shape: { cur: { played: false, notOn: false, hasMarkers: false }, prev: null },
    data_as_of_game_date: str(r.data_as_of_game_date)?.slice(0, 10) ?? null,
    pulled_at_utc: str(r.pulled_at_utc),
  };
}

function shapeOf(s: SeasonSlots | undefined, complete: boolean): ChartShape {
  const g = s?.games ?? [];
  const { dated } = chartCells(g, s?.slotTotal ?? 0, complete);
  const trades = tradeTicks(dated, complete, s?.explicitTrades);
  return {
    played: g.some((x) => x.status === "played"),
    notOn: g.some((x) => x.status === "not_on_team"),
    hasMarkers: trades.length > 0,
  };
}

/** 2025-26 shape: plus the source footnote flag, only when there is one. */
function prevShapeOf(s: SeasonSlots): ChartShape {
  const shape = shapeOf(s, true);
  const note = sourceNoteOf(s);
  return note ? { ...shape, sourceNote: note } : shape;
}

/** The page payload never carries row provenance (it lives in /slots only). */
function withoutSource<T extends TeamGame>(g: T): T {
  if (g.source === undefined) return g;
  const c = { ...g };
  delete c.source;
  return c;
}

const EMPTY_SEASON: SeasonSlots = { games: [], slotTotal: 0 };

/**
 * Every player's season-chart slots, keyed by player_id — what
 * scripts/build-player-slots.mjs writes to public/slots/<id>.json. Same
 * loaders and normalisation the page used to embed.
 */
export function loadPlayerSlots(): Map<string, PlayerSlots> {
  const out = new Map<string, PlayerSlots>();
  if (!fs.existsSync(DATA_FILE)) return out;
  const raw = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) as RawRow[];
  const teamGames = loadTeamGames();
  const season2526 = loadCompleteSeason(TEAM_GAMES_2025_26_FILE);
  for (const r of raw) {
    if (!r.full_name) continue;
    const id = String(r.player_id);
    out.set(id, {
      cur: teamGames.get(id) ?? EMPTY_SEASON,
      prev: season2526 ? (season2526.get(id) ?? EMPTY_SEASON) : null,
    });
  }
  return out;
}

/**
 * Page payload: search index + tiles + last 5. Season-chart slots are not
 * embedded (fetched per player from /slots/<id>.json).
 */
export function loadPointsRows(): PointsRow[] {
  if (!fs.existsSync(DATA_FILE)) return [];
  const raw = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) as RawRow[];
  const teamGames = loadTeamGames();
  const season2526 = loadCompleteSeason(TEAM_GAMES_2025_26_FILE);
  return raw
    .map((r) => {
      const row = toRow(r);
      const tg = teamGames.get(row.player_id);
      const games = tg?.games ?? [];
      row.teamPlayed = games.some(
        (g) => g.status === "played" || g.status === "missed",
      );
      row.last5 = games
        .filter(isPastGame)
        .sort((a, b) => a.date.localeCompare(b.date) || a.seq - b.seq)
        .slice(-5)
        .map(withoutSource);
      const s25 = season2526?.get(row.player_id);
      row.slotTotal2526 = season2526 ? (s25?.slotTotal ?? 0) : null;
      row.shape = {
        cur: shapeOf(tg, false),
        prev: s25 ? prevShapeOf(s25) : null,
      };
      return row;
    })
    // Cavin 2026-10-30: only players who have played minutes in 2026-27.
    .filter((r) => r.full_name && r.has_season_games)
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
}
