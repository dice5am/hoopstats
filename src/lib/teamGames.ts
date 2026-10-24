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
  /** Join marker: this slot opens a new team stint (list-form `trade_marker`). */
  tradeMarker?: boolean;
  /** Team named on the join marker (list-form `trade_marker.to_team`); else `team`. */
  tradeTo?: string;
  /** Join reason; absent/unknown → "Joined {team}". */
  joinReason?: JoinReason;
  /** Exit markers drawn before this slot (first Not on team slot after a stint). */
  exits?: ExitMark[];
};

export type JoinReason = "trade" | "signed";
export type ExitMark = { team: string; reason: "waived" | "left" };

const norm = (v: unknown) =>
  typeof v === "string" ? v.trim().toLowerCase().replace(/[\s_]+/g, "_") : "";

/** `trade_marker[].reason` → join wording; null/missing/unknown → undefined ("Joined"). */
export function joinReasonOf(v: unknown): JoinReason | undefined {
  const r = norm(v);
  return r === "trade" ? "trade" : r === "signed" ? "signed" : undefined;
}

const LEFT_REASONS = new Set(["contract_end", "contract_ended", "ten_day_end", "left"]);
/** `exit_marker[].reason` → exit kind; null/missing/unknown → null (no tick, no label). */
export function exitReasonOf(v: unknown): ExitMark["reason"] | null {
  const r = norm(v);
  return r === "waived" ? "waived" : LEFT_REASONS.has(r) ? "left" : null;
}

export function joinText(team: string, reason?: JoinReason): string {
  return reason === "trade"
    ? `Traded to ${team}`
    : reason === "signed"
      ? `Signed with ${team}`
      : `Joined ${team}`;
}
export function exitText(e: ExitMark): string {
  return e.reason === "waived" ? `Waived by ${e.team}` : `Left ${e.team}`;
}

/** One stint marker over the chart: a hairline tick before slot `ci` with its label. */
export type StintTick = { ci: number; team: string; kind: "join" | "exit"; text: string };

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
 * Stint ticks over the dated run. Joins: Data's markers when present
 * (list-form or per-slot), else a team change between consecutive dated
 * slots. In a complete season the new team's Not on team slots (before his
 * debut) already belong to the new stint, so the tick sits at the stint
 * change. Exits: Data's `exit_marker` entries with a known reason only.
 * Within a slot the exit comes before the join.
 */
export function tradeTicks(
  dated: (TeamGame | null)[],
  complete: boolean,
  explicit = false,
): StintTick[] {
  const ticks: StintTick[] = [];
  const useMarkers = explicit || dated.some((g) => g?.tradeMarker);
  let prevTeam: string | null = null;
  dated.forEach((g, i) => {
    for (const e of g?.exits ?? []) {
      ticks.push({ ci: i, team: e.team, kind: "exit", text: exitText(e) });
    }
    if (!g) return;
    if (useMarkers) {
      const team = g.tradeTo ?? g.team;
      if (g.tradeMarker && team) {
        ticks.push({ ci: i, team, kind: "join", text: joinText(team, g.joinReason) });
      }
      return;
    }
    if (!g.team || (!complete && g.status === "not_on_team")) return;
    if (prevTeam && g.team !== prevTeam) {
      ticks.push({ ci: i, team: g.team, kind: "join", text: joinText(g.team) });
    }
    prevTeam = g.team;
  });
  return ticks;
}

/** Empty cells before the Cup · TBD pair. */
export const GAP_CELLS = 2;

export type ChartCell = { ci: number; g: TeamGame | null; key: string };

/**
 * Column layout of a season chart: dated run in date order (padded to
 * slot_total), then after a 2-cell gap the undated Cup · TBD pair. A
 * completed season drops future/tbd rows. `C` = total cells.
 */
export function chartCells(
  games: TeamGame[],
  slotTotal: number,
  complete: boolean,
) {
  const rows = complete
    ? games.filter((g) => g.status !== "scheduled" && g.status !== "tbd")
    : games;
  const tbd = rows.filter((g) => !g.date);
  const dated: (TeamGame | null)[] = rows
    .filter((g) => !!g.date)
    .sort(
      (a, b) =>
        (a.date as string).localeCompare(b.date as string) || a.seq - b.seq,
    );
  // Never draw fewer than Data's slot_total (pads only if the file is short).
  const shortBy = slotTotal - dated.length - tbd.length;
  for (let k = 0; k < shortBy; k++) dated.push(null);
  const D = dated.length;
  const T = tbd.length;
  const cells: ChartCell[] = dated.map((g, i) => ({
    ci: i,
    g,
    key: g?.slotKey ?? `pad-${i}`,
  }));
  let c = D;
  const pairStart = T > 0 ? c + GAP_CELLS : null;
  if (pairStart !== null) {
    tbd.forEach((g, i) => cells.push({ ci: pairStart + i, g, key: g.slotKey }));
    c = pairStart + T;
  }
  return { dated, tbd, cells, D, T, pairStart, C: c };
}

/** Rows a season chart's marker band reserves whenever it draws any tick (Design lock). */
export const MARKER_BAND_ROWS = 3;

/**
 * Pixel metrics the label layout runs on: plot width, the horizontal gap
 * kept between labels (6px at 390, 8px at ≥1000px), and each label's width.
 * The chart measures the real ones after its first layout pass; the
 * defaults are the 390 frame (296px plot, Inter 700 10.5px ≈ 6.4px/char).
 */
export type LabelMetrics = {
  plotPx: number;
  gapPx: number;
  widthPx: (text: string) => number;
};
export const LABEL_METRICS_390: LabelMetrics = {
  plotPx: 296,
  gapPx: 6,
  widthPx: (t) => t.length * 6.4,
};

/** Space between a hairline and the label it ends at. */
const TICK_PAD_PX = 4;

export type TradeLabel = {
  ci: number;
  team: string;
  kind: "join" | "exit";
  text: string;
  /** 0 = the normal marker row; each row above adds 15px. */
  row: number;
  align: "left" | "right";
};

/**
 * Lay out stint labels (joins and exits share rows) over the plot. A lone
 * label sits right of its tick (left of it when it would run past the plot
 * edge). Labels within a label width (+ gap) of another end at their own
 * tick (right-aligned; left-aligned when that would run past the left edge).
 * In tick order each label takes the LOWEST row where it keeps `gapPx` clear
 * of every label already placed. `rows` is what the layout needs; rows past
 * MARKER_BAND_ROWS are not drawn (clamped to the top row) and flagged as
 * `overflow` so they can be reported.
 */
export function layoutTradeLabels(
  trades: { ci: number; team: string; kind?: "join" | "exit"; text?: string }[],
  C: number,
  m: LabelMetrics = LABEL_METRICS_390,
): { labels: TradeLabel[]; rows: number; overflow: boolean } {
  const x = (ci: number) => (C > 0 ? (ci / C) * m.plotPx : 0);
  const items = trades.map((t) => {
    const text = t.text ?? joinText(t.team);
    return {
      ci: t.ci,
      team: t.team,
      kind: t.kind ?? ("join" as const),
      text,
      w: m.widthPx(text),
    };
  });
  const placed: (TradeLabel & { a: number; b: number; need: number })[] = [];
  let need = 0;
  items.forEach((t, i) => {
    const xi = x(t.ci);
    const close = items.some(
      (o, j) => j !== i && Math.abs(x(o.ci) - xi) < Math.max(t.w, o.w) + m.gapPx,
    );
    const fitsRight = xi + TICK_PAD_PX + t.w <= m.plotPx;
    const fitsLeft = xi - TICK_PAD_PX - t.w >= 0;
    const align: "left" | "right" = close
      ? fitsLeft
        ? "right"
        : "left"
      : fitsRight || !fitsLeft
        ? "left"
        : "right";
    const a = align === "left" ? xi + TICK_PAD_PX : xi - TICK_PAD_PX - t.w;
    const b = a + t.w;
    let row = 0;
    while (
      placed.some(
        (p) => p.need === row && a < p.b + m.gapPx && p.a < b + m.gapPx,
      )
    ) {
      row++;
    }
    need = Math.max(need, row + 1);
    placed.push({
      ci: t.ci,
      team: t.team,
      kind: t.kind,
      text: t.text,
      row: Math.min(row, MARKER_BAND_ROWS - 1),
      need: row,
      align,
      a,
      b,
    });
  });
  return {
    labels: placed.map(({ ci, team, kind, text, row, align }) => ({
      ci,
      team,
      kind,
      text,
      row,
      align,
    })),
    rows: Math.max(need, 1),
    overflow: need > MARKER_BAND_ROWS,
  };
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
  /** join reason: t = trade, s = signed */
  r?: "t" | "s";
  /** exit markers before this slot: [team, w = waived | l = left] */
  z?: [string, "w" | "l"][];
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
    if (x.joinReason) w.r = x.joinReason === "trade" ? "t" : "s";
    if (x.exits?.length) {
      w.z = x.exits.map((e) => [e.team, e.reason === "waived" ? "w" : "l"]);
    }
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
    if (x.r) g.joinReason = x.r === "t" ? "trade" : "signed";
    if (x.z?.length) {
      g.exits = x.z.map(([team, r]) => ({ team, reason: r === "w" ? "waived" : "left" }));
    }
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
