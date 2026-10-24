/** Client-safe team-game types (no fs). Loaded server-side in betting.ts. */

/**
 * One slot on his season chart (`player_team_games_2026_27`), oldest first.
 * v1: played | missed. v2: + scheduled. v2.1: + tbd (no date/opponent).
 * `not_on_team`: a team game before/after his stint (completed seasons) —
 * counts toward the slot total, never as missed. Missed only once final;
 * never "injured". Regular season only: the NBA Cup final is never a slot
 * (dropped in the loader); Cup group and knockout games are normal slots.
 */
export type SlotStatus =
  | "played"
  | "missed"
  | "scheduled"
  | "tbd"
  | "not_on_team";

export type TeamGame = {
  seq: number;
  /** Stable column key: game_id for real games, e.g. `OKC-tbd-1` for placeholders. */
  slotKey: string;
  gameId: string | null;
  date: string | null; // YYYY-MM-DD; null for tbd
  opp: string | null;
  homeAway: "home" | "away" | null;
  team: string | null;
  status: SlotStatus;
  pts: number | null; // only when played; a real 0 stays 0
};

/**
 * A dated past game (played or missed) with an opponent and home/away —
 * what the last 5 draws.
 */
export type PastGame = TeamGame & {
  status: "played" | "missed";
  date: string;
  opp: string;
  homeAway: "home" | "away";
};

export function isPastGame(g: TeamGame): g is PastGame {
  return (
    (g.status === "played" || g.status === "missed") &&
    g.date !== null &&
    g.opp !== null &&
    g.homeAway !== null
  );
}
