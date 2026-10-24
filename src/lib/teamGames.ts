/** Client-safe team-game types and helpers (no fs). Loaded server-side in betting.ts. */

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
  /** Data's trade marker: this slot opens a new team stint ("Traded to {team}"). */
  tradeMarker?: boolean;
  /** Team named on the marker (list-form `trade_marker.to_team`); else `team`. */
  tradeTo?: string;
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

/**
 * One season's slots for the chart. `explicitTrades`: Data shipped a
 * per-player trade list (possibly empty), so the chart draws exactly those
 * markers and never infers trades from team changes.
 */
export type SeasonSlots = {
  games: TeamGame[];
  slotTotal: number;
  explicitTrades?: boolean;
};

/** Both season charts for one player (what /slots/<id>.json decodes to). */
export type PlayerSlots = {
  cur: SeasonSlots;
  /** `null` = no 2025-26 file at build (section hidden). */
  prev: SeasonSlots | null;
};

/**
 * Trade ticks over the dated run: Data's markers when present (list-form or
 * per-slot), else a team change between consecutive dated slots. In a
 * complete season the new team's Not on team slots (before his debut)
 * already belong to the new stint, so the tick sits at the stint change.
 */
export function tradeTicks(
  dated: (TeamGame | null)[],
  complete: boolean,
  explicit = false,
): { ci: number; team: string }[] {
  const trades: { ci: number; team: string }[] = [];
  if (explicit || dated.some((g) => g?.tradeMarker)) {
    dated.forEach((g, i) => {
      const team = g?.tradeTo ?? g?.team;
      if (g?.tradeMarker && team) trades.push({ ci: i, team });
    });
    return trades;
  }
  let prevTeam: string | null = null;
  dated.forEach((g, i) => {
    if (!g?.team || (!complete && g.status === "not_on_team")) return;
    if (prevTeam && g.team !== prevTeam) trades.push({ ci: i, team: g.team });
    prevTeam = g.team;
  });
  return trades;
}

/* ---- /slots/<id>.json wire format (compact; decoded on the client) ---- */

const CODE = {
  played: "p",
  missed: "o",
  scheduled: "s",
  tbd: "t",
  not_on_team: "n",
} as const satisfies Record<SlotStatus, string>;
type StatusCode = (typeof CODE)[SlotStatus];
const FROM_CODE = Object.fromEntries(
  Object.entries(CODE).map(([k, v]) => [v, k]),
) as Record<StatusCode, SlotStatus>;

/** One slot on the wire. Omitted keys are null/false/defaults. */
export type WireSlot = {
  s: StatusCode;
  /** seq, only when it is not index + 1 */
  q?: number;
  /** game_id */
  i?: string;
  /** slot_key, only when it differs from game_id */
  k?: string;
  d?: string;
  o?: string;
  h?: "h" | "a";
  m?: string;
  p?: number;
  x?: 1;
  /** trade-to team, only when it differs from `m` */
  y?: string;
};
export type WireSeason = { t: number; g: WireSlot[]; e?: 1 };
export type WireFile = { v: 1; a: WireSeason; b: WireSeason | null };

function encodeSeason(s: SeasonSlots): WireSeason {
  const g = s.games.map((x, idx): WireSlot => {
    const w: WireSlot = { s: CODE[x.status] };
    if (x.seq !== idx + 1) w.q = x.seq;
    if (x.gameId) w.i = x.gameId;
    if (x.slotKey !== x.gameId) w.k = x.slotKey;
    if (x.date) w.d = x.date;
    if (x.opp) w.o = x.opp;
    if (x.homeAway) w.h = x.homeAway === "home" ? "h" : "a";
    if (x.team) w.m = x.team;
    if (x.pts !== null) w.p = x.pts;
    if (x.tradeMarker) w.x = 1;
    if (x.tradeTo && x.tradeTo !== x.team) w.y = x.tradeTo;
    return w;
  });
  return { t: s.slotTotal, g, ...(s.explicitTrades ? { e: 1 as const } : {}) };
}

function decodeSeason(w: WireSeason): SeasonSlots {
  const games = w.g.map((x, idx): TeamGame => {
    const status = FROM_CODE[x.s];
    const g: TeamGame = {
      seq: x.q ?? idx + 1,
      slotKey: x.k ?? x.i ?? `slot-${idx + 1}`,
      gameId: x.i ?? null,
      date: x.d ?? null,
      opp: x.o ?? null,
      homeAway: x.h === "h" ? "home" : x.h === "a" ? "away" : null,
      team: x.m ?? null,
      status,
      pts: status === "played" ? (x.p ?? null) : null,
    };
    if (x.x) g.tradeMarker = true;
    if (x.y || (x.x && x.m)) g.tradeTo = x.y ?? x.m;
    return g;
  });
  return { games, slotTotal: w.t, ...(w.e ? { explicitTrades: true } : {}) };
}

export function encodePlayerSlots(p: PlayerSlots): WireFile {
  return {
    v: 1,
    a: encodeSeason(p.cur),
    b: p.prev ? encodeSeason(p.prev) : null,
  };
}

export function decodePlayerSlots(w: WireFile): PlayerSlots {
  if (!w || w.v !== 1 || !w.a) throw new Error("bad slots file");
  return {
    cur: decodeSeason(w.a),
    prev: w.b ? decodeSeason(w.b) : null,
  };
}
