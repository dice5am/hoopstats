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
  /**
   * Data-only provenance of this row (e.g. "basketball-reference"); never
   * rendered. Read from the row field named by SOURCE_FIELD in betting.ts.
   * A missing value means DEFAULT_SOURCE (the loader and the decoder fill it
   * in). On /slots/<id>.json it travels as `c` only when it is not
   * DEFAULT_SOURCE. Optional only so the page payload (last5) can omit it.
   */
  source?: string;
};

/**
 * Default row source (both seasons; Gate 9: 2025-26 v1.3 / 2026-27 v2.4).
 * A row without a source is this; it is never written to /slots — only other
 * sources are. The one place to change it if Data's default changes.
 */
export const DEFAULT_SOURCE = "nba.com";

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
/**
 * Short wording, narrow charts (<1000px) only (Design Lead lock, variant B):
 * "Traded X", "Signed X", "Joined X", "Waived X", "Left X".
 */
export function joinShort(team: string, reason?: JoinReason): string {
  return reason === "trade"
    ? `Traded ${team}`
    : reason === "signed"
      ? `Signed ${team}`
      : `Joined ${team}`;
}
export function exitShort(e: ExitMark): string {
  return e.reason === "waived" ? `Waived ${e.team}` : `Left ${e.team}`;
}
/** One narrow label for an exit and the join right after it ("Waived DAL · Signed DEN"). */
export const mergedText = (exitLabel: string, joinLabel: string) =>
  `${exitLabel} · ${joinLabel}`;

/**
 * One stint marker over the chart: a hairline tick before slot `ci` with its
 * label. `text` is the full wording (≥1000px), `short` the narrow wording.
 */
export type StintTick = {
  ci: number;
  team: string;
  kind: "join" | "exit";
  text: string;
  short: string;
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
      ticks.push({ ci: i, team: e.team, kind: "exit", text: exitText(e), short: exitShort(e) });
    }
    if (!g) return;
    if (useMarkers) {
      const team = g.tradeTo ?? g.team;
      if (g.tradeMarker && team) {
        ticks.push({
          ci: i,
          team,
          kind: "join",
          text: joinText(team, g.joinReason),
          short: joinShort(team, g.joinReason),
        });
      }
      return;
    }
    if (!g.team || (!complete && g.status === "not_on_team")) return;
    if (prevTeam && g.team !== prevTeam) {
      ticks.push({
        ci: i,
        team: g.team,
        kind: "join",
        text: joinText(g.team),
        short: joinShort(g.team),
      });
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
 * kept between labels (6px at 390, 8px at ≥1000px), the maple pad on each
 * side of a label (2px / 3px), each label's text width, and whether the
 * chart is narrow (<1000px, the 390 frame: short wording, exit + join merge
 * on overflow). The chart measures the real ones before paint; the defaults
 * are the 390 frame (296px plot, Inter 700 10.5px ≈ 6.4px/char).
 */
export type LabelMetrics = {
  plotPx: number;
  gapPx: number;
  narrow: boolean;
  padPx: number;
  /** Rendered text width, without the pad. */
  widthPx: (text: string) => number;
};
export const LABEL_METRICS_390: LabelMetrics = {
  plotPx: 296,
  gapPx: 6,
  narrow: true,
  padPx: 2,
  widthPx: (t) => t.length * 6.4,
};

/** Space between a hairline and the start (or end) of its label text. */
export const TICK_PAD_PX = 4;

export type TradeLabel = {
  /** Tick the label belongs to (the exit tick for a merged label). */
  ci: number;
  team: string;
  kind: "join" | "exit";
  text: string;
  /** 0 = the normal marker row; each row above adds 15px. */
  row: number;
  /** Side of its tick the label sits on. */
  side: "right" | "left";
  /**
   * "tick": text starts/ends TICK_PAD_PX from the tick. "start"/"end":
   * neither side fits inside the plot, so it is pinned to that plot edge.
   */
  pin: "tick" | "start" | "end";
  /** An exit and the join right after it in one label (narrow overflow only). */
  merged: boolean;
  /** Padded (maple) box, px from the plot's left edge. */
  x0: number;
  x1: number;
};

/** Every hairline. `row` is its label's row; null = no label (a join merged into its exit). */
export type MarkerTick = { ci: number; kind: "join" | "exit"; row: number | null };

type LayoutInput = {
  ci: number;
  team: string;
  kind?: "join" | "exit";
  text?: string;
  short?: string;
};
type Item = {
  ci: number;
  team: string;
  kind: "join" | "exit";
  text: string;
  merged: boolean;
  /** Source tick indexes this label speaks for. */
  src: number[];
};

const labelOf = (t: LayoutInput, narrow: boolean) =>
  narrow
    ? (t.short ?? t.text ?? joinShort(t.team))
    : (t.text ?? joinText(t.team));

/**
 * Variant B placement. In tick order each label tries the RIGHT side of its
 * tick, then the LEFT, in the lowest row where that side fits inside the plot
 * and keeps `gapPx` clear of every padded label already in that row; only if
 * neither side fits does it move up a row.
 */
function place(items: Item[], C: number, m: LabelMetrics) {
  const x = (ci: number) => (C > 0 ? (ci / C) * m.plotPx : 0);
  const placed: (TradeLabel & { need: number; src: number[] })[] = [];
  const free = (row: number, a: number, b: number) =>
    !placed.some((p) => p.need === row && a < p.x1 + m.gapPx && p.x0 < b + m.gapPx);
  for (const t of items) {
    const xi = x(t.ci);
    const W = m.widthPx(t.text) + 2 * m.padPx;
    type Opt = { side: "right" | "left"; pin: TradeLabel["pin"]; x0: number };
    const right: Opt = { side: "right", pin: "tick", x0: xi + TICK_PAD_PX - m.padPx };
    const left: Opt = { side: "left", pin: "tick", x0: xi - TICK_PAD_PX + m.padPx - W };
    let opts = [right, left].filter((o) => o.x0 >= 0 && o.x0 + W <= m.plotPx);
    if (opts.length === 0) {
      // Wider than either side of its tick: pin it inside the plot instead.
      const toRight = m.plotPx - xi >= xi;
      opts = [
        toRight
          ? { side: "right", pin: "end", x0: Math.max(0, m.plotPx - W) }
          : { side: "left", pin: "start", x0: 0 },
      ];
    }
    let row = 0;
    let pick: Opt | undefined;
    for (;;) {
      pick = opts.find((o) => free(row, o.x0, o.x0 + W));
      if (pick) break;
      row++;
    }
    placed.push({
      ci: t.ci,
      team: t.team,
      kind: t.kind,
      text: t.text,
      row,
      need: row,
      side: pick.side,
      pin: pick.pin,
      merged: t.merged,
      x0: pick.x0,
      x1: pick.x0 + W,
      src: t.src,
    });
  }
  const need = placed.reduce((n, p) => Math.max(n, p.need + 1), 1);
  return { placed, need };
}

/** An exit and the join right after it (indexes into the tick list). */
export type MergePair = { exit: number; join: number };

/** Every exit immediately followed by a join in tick order. */
function mergePairs(kinds: ("join" | "exit")[]): MergePair[] {
  const out: MergePair[] = [];
  kinds.forEach((k, i) => {
    if (k === "exit" && kinds[i + 1] === "join") out.push({ exit: i, join: i + 1 });
  });
  return out;
}

function combinations<T>(xs: T[], k: number): T[][] {
  if (k === 0) return [[]];
  return xs.flatMap((x, i) => combinations(xs.slice(i + 1), k - 1).map((c) => [x, ...c]));
}

/**
 * Merge tie-break (Design Lead lock, 2026-10-24) — the one place to change it.
 * Among the pair sets that clear the overflow (all the same, smallest size):
 * 1. exit and join ticks closest together (sum of slot distances);
 * 2. then nearest the label that overflowed (0 if the pair holds it);
 * 3. then left to right.
 */
export function pickMerge(
  options: MergePair[][],
  ciOf: (tick: number) => number,
  overflowCi: number,
): MergePair[] {
  const rank = (set: MergePair[]) => [
    set.reduce((s, q) => s + Math.abs(ciOf(q.join) - ciOf(q.exit)), 0),
    set.reduce(
      (s, q) =>
        s + Math.min(Math.abs(ciOf(q.exit) - overflowCi), Math.abs(ciOf(q.join) - overflowCi)),
      0,
    ),
    Math.min(...set.map((q) => ciOf(q.exit))),
  ];
  return options
    .map((set) => ({ set, r: rank(set) }))
    .sort((a, b) => a.r[0] - b.r[0] || a.r[1] - b.r[1] || a.r[2] - b.r[2])[0].set;
}

/**
 * Lay out stint labels (joins and exits share rows) over the plot: variant B
 * placement (see `place`), full wording at ≥1000px and short wording below.
 * Narrow only: if that still needs more than MARKER_BAND_ROWS rows, an exit
 * is merged with the join right after it into one label on the EXIT tick
 * ("Waived DAL · Signed DEN"); the join keeps its tick with no label, and
 * the labels are placed again. Fewest pairs that fit; `pickMerge` breaks
 * ties. Rows past MARKER_BAND_ROWS are never drawn as
 * a 4th row: they are clamped to the top row and flagged as `overflow`.
 */
export function layoutTradeLabels(
  trades: LayoutInput[],
  C: number,
  m: LabelMetrics = LABEL_METRICS_390,
): {
  labels: TradeLabel[];
  ticks: MarkerTick[];
  rows: number;
  overflow: boolean;
  merged: boolean;
} {
  const kindOf = (t: LayoutInput) => t.kind ?? ("join" as const);
  const single: Item[] = trades.map((t, i) => ({
    ci: t.ci,
    team: t.team,
    kind: kindOf(t),
    text: labelOf(t, m.narrow),
    merged: false,
    src: [i],
  }));
  let out = place(single, C, m);
  let merged = false;
  if (m.narrow && out.need > MARKER_BAND_ROWS) {
    const over = out.placed.find((p) => p.need >= MARKER_BAND_ROWS)!;
    const pairs = mergePairs(trades.map(kindOf));
    const layoutWith = (chosen: MergePair[]) => {
      const items: Item[] = [];
      for (let i = 0; i < trades.length; i++) {
        const pair = chosen.find((q) => q.exit === i);
        if (pair) {
          items.push({
            ci: trades[i].ci,
            team: trades[i].team,
            kind: "exit",
            text: mergedText(labelOf(trades[i], true), labelOf(trades[pair.join], true)),
            merged: true,
            src: [i, pair.join],
          });
          i = pair.join;
        } else {
          items.push(single[i]);
        }
      }
      return place(items, C, m);
    };
    // Fewest pairs that clear the overflow; among those, pickMerge decides.
    let best: { chosen: MergePair[]; res: ReturnType<typeof place> } | null = null;
    for (let k = 1; k <= pairs.length && !best; k++) {
      const fits = combinations(pairs, k)
        .map((chosen) => ({ chosen, res: layoutWith(chosen) }))
        .filter((o) => o.res.need <= MARKER_BAND_ROWS);
      if (fits.length) {
        const pick = pickMerge(
          fits.map((f) => f.chosen),
          (i) => trades[i].ci,
          over.ci,
        );
        best = fits.find((f) => f.chosen === pick)!;
      }
    }
    // Nothing clears it: merge every pair, still flagged as overflow below.
    if (!best && pairs.length) best = { chosen: pairs, res: layoutWith(pairs) };
    if (best) {
      merged = true;
      out = best.res;
    }
  }
  const { placed, need } = out;
  const labels: TradeLabel[] = placed.map((p) => ({
    ci: p.ci,
    team: p.team,
    kind: p.kind,
    text: p.text,
    row: Math.min(p.need, MARKER_BAND_ROWS - 1),
    side: p.side,
    pin: p.pin,
    merged: p.merged,
    x0: p.x0,
    x1: p.x1,
  }));
  const ticks: MarkerTick[] = trades.map((t, i) => {
    const k = placed.findIndex((p) => p.src[0] === i);
    return { ci: t.ci, kind: kindOf(t), row: k >= 0 ? labels[k].row : null };
  });
  return { labels, ticks, rows: need, overflow: need > MARKER_BAND_ROWS, merged };
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
  /** source (data-only provenance), only when it is not DEFAULT_SOURCE */
  c?: string;
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
    if (x.source && x.source !== DEFAULT_SOURCE) w.c = x.source;
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
    g.source = typeof x.c === "string" && x.c ? x.c : DEFAULT_SOURCE;
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
