import type { RankEntry } from "../playerSplitsTypes";
import { isStrongFlag, isWatchFlag } from "../playerSplitsTypes";
import type { PcCell, PcOutcome, PcProfileRow, PcRow, PcRowsFile, PcProfilesFile } from "../playerConditionsTypes";
import type { SegmentKey, TimespanKey } from "../timespans";
import type { Ctx } from "./types";

/**
 * "Players most affected": one block per insight card, one adapter.
 *
 * Everything the UI needs is `Responder` / `ResponderSet`. Wire a new data source by
 * returning a `ResponderSource` from `respondersFor()`; nothing else changes.
 * Data Engineer's player × condition table plugs in through `buildResponders()`, which takes rows
 * shaped like `PlayerConditionRow` (below).
 */

/** One row of the (future) player × condition table, or anything mappable to it. */
export type PlayerConditionRow = {
  player_id: string;
  name: string;
  team?: string | null;
  /** point estimate of the player's own effect for the condition (units per `unit`) */
  est: number;
  lo: number;
  hi: number;
  unit: "pts" | "pp" | "ratio";
  /** games under the condition / games in the comparison */
  n_cond: number;
  /** null/0 when the estimate is one-sided (e.g. vs the rate expected for his average) */
  n_ref: number | null;
  /** data-labelled flag: "watch" | "strong" | null */
  flag?: "watch" | "strong" | null;
  /** persistence test on held-out games: true = held up, false = did not, null/undefined = not tested */
  held_out?: boolean | null;
  /** the league-wide effect for the condition (same unit as est) and which end of the ranking the row came from */
  league?: number | null;
  side?: "pos" | "neg";
};

export type Responder = {
  id: string;
  name: string;
  team?: string | null;
  est: number;
  lo: number;
  hi: number;
  unit: "pts" | "pp" | "ratio";
  n: number;
  nLabel: string;
  flag: "watch" | "strong" | null;
  heldOut: boolean | null;
  href?: string;
  /** league-wide effect for the condition (same unit as est), and this player's gap to it */
  league: number | null;
  vsLeague: number | null;
};

export type ResponderSet = {
  /** plain-words condition, e.g. "home minus away" */
  condition: string;
  positive: Responder[];
  negative: Responder[];
  /** shown under the lists */
  note?: string;
  /** list headings when the ends mean "above / below the league effect" rather than "above / below zero" */
  labels?: [string, string];
};

/** Data's player × condition study: rows are fetched per segment; stats (verdict, reliability, flagged vs chance) arrive with the page. */
export type ConditionsSource = {
  kind: "conditions";
  conds: string[];
  seg: SegmentKey;
  ts: TimespanKey;
  /** `${condition}|${outcome}` → cell stats, for this segment */
  stats: Record<string, PcCell>;
  /** condition id → plain label */
  labels: Record<string, string>;
  /** leading block (Players / Big nights lead lists): show ten each way */
  lead?: boolean;
};

export type ResponderSource =
  | { kind: "none" }
  | { kind: "na"; text: string }
  | { kind: "ready"; set: ResponderSet }
  | { kind: "async"; key: string; load: () => Promise<ResponderSet> }
  | ConditionsSource;

export const TOP_N = 3;

/** Rows → top positive and top negative responders (by estimate, not by z). Never invents rows. */
export function buildResponders(rows: PlayerConditionRow[], condition: string, opts: { top?: number; note?: string } = {}): ResponderSet {
  const top = opts.top ?? TOP_N;
  const toR = (r: PlayerConditionRow): Responder => ({
    id: r.player_id,
    name: r.name,
    team: r.team ?? null,
    est: r.est,
    lo: r.lo,
    hi: r.hi,
    unit: r.unit,
    n: r.n_ref ? Math.min(r.n_cond, r.n_ref) : r.n_cond,
    nLabel: r.n_ref ? `min side · ${r.n_cond} vs ${r.n_ref} games` : `${r.n_cond} games vs his expected rate`,
    flag: r.flag ?? null,
    heldOut: r.held_out ?? null,
    href: `/players?player=${encodeURIComponent(r.player_id)}`,
    league: r.league ?? null,
    vsLeague: r.league != null ? r.est - r.league : null,
  });
  const ok = rows.filter((r) => Number.isFinite(r.est) && Number.isFinite(r.lo) && Number.isFinite(r.hi));
  // rows that say which end they came from keep Data's order (rank); others split by sign of the estimate
  const sided = ok.some((r) => r.side);
  const pos = sided ? ok.filter((r) => r.side === "pos").slice(0, top).map(toR) : [...ok].filter((r) => r.est > 0).sort((a, b) => b.est - a.est).slice(0, top).map(toR);
  const neg = sided ? ok.filter((r) => r.side === "neg").slice(0, top).map(toR) : [...ok].filter((r) => r.est < 0).sort((a, b) => a.est - b.est).slice(0, top).map(toR);
  return { condition, positive: pos, negative: neg, note: opts.note };
}

const flagOf = (f: string | null | undefined): "watch" | "strong" | null => (isStrongFlag(f) ? "strong" : isWatchFlag(f) ? "watch" : null);

const rankRow = (e: RankEntry): PlayerConditionRow => ({
  player_id: e.player_id,
  name: e.full_name,
  team: e.team,
  est: e.pts.raw,
  lo: e.pts.ci95[0],
  hi: e.pts.ci95[1],
  unit: "pts",
  n_cond: e.n_a,
  n_ref: e.n_b,
  flag: flagOf(e.pts.flag),
  held_out: null,
});

/* ───────── Data's player × condition table ───────── */

export type CondStatusId = "holds" | "season" | "mixed" | "noise" | "few";
export type CondStatus = { id: CondStatusId; label: string; copy: string };

/** Status badge for a condition × outcome × segment, straight from Data's verdict string. */
export function statusOf(verdict: string): CondStatus {
  const v = verdict.toLowerCase();
  if (v.startsWith("persistent"))
    return {
      id: "holds",
      label: "Holds across seasons",
      copy: v.includes("small") ? "Player differences carry to a held-out season, but the effect is small or driven by the player’s scoring level." : "Player differences carry to a held-out season.",
    };
  if (v.startsWith("within-season"))
    return { id: "season", label: "This season only", copy: "Players differ within a season but it doesn’t predict the next one: may reflect the current team situation, not a trait." };
  if (v.startsWith("cross-season")) return { id: "mixed", label: "Across seasons only", copy: "Shows across seasons but not within a season." };
  if (v.startsWith("noise")) return { id: "noise", label: "Looks like noise", copy: "Tested, no player pattern that holds." };
  return { id: "few", label: "Too few players to test", copy: "Too few players with enough games on both sides to test whether any pattern holds." };
}

export const PC_OUTCOMES: { id: PcOutcome; label: string; unit: "pts" | "pp" }[] = [
  { id: "dev", label: "Points vs average", unit: "pts" },
  { id: "x125", label: "×1.25", unit: "pp" },
  { id: "x150", label: "×1.5", unit: "pp" },
  { id: "x200", label: "×2.0", unit: "pp" },
  { id: "p10", label: "+10", unit: "pp" },
];

export const condShort = (label: string) => {
  const t = label.replace(/ \(vs [^)]*\)/, "");
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** Which conditions each card is about. Cards not listed here compare groups or models, not one condition. */
const COND_MAP: Record<string, string[]> = {
  "home-away": ["home"],
  "b2b-2nd": ["b2b_2nd"],
  "b2b-1st": ["b2b_1st"],
  "rest-days": ["rest_r2", "rest_r3plus", "rest_r1"],
  "defence-tiers": ["def_worst5", "def_worst10", "def_best10", "def_best5"],
  "opp-tiers": ["def_worst10", "def_best10", "pace_fast10", "pace_slow10"],
  "role-position": ["role_promoted", "role_demoted"],
  "teammates-out": ["out_top1", "vac_star", "vac_large", "vac_any"],
  "players-out": ["out_top1", "vac_star", "vac_large", "vac_any"],
  "bounce-back": ["bb_last1"],
  "stale-average": ["hot_last1", "min_up3", "role_promoted"],
  "role-change": ["role_promoted", "role_demoted", "min_up3", "min_dn3"],
  tiers: ["def_worst10", "def_best10", "pace_fast10", "pace_slow10"],
  odds: ["def_worst5", "def_worst10", "def_best10", "def_best5"],
  situation: ["home", "b2b_2nd", "b2b_1st"],
  "no-signal": ["home", "b2b_2nd", "b2b_1st", "opp_leaky_l5", "opp_tight_l5", "early_vs_late"],
};

const NA_TEXT: Record<string, string> = {
  swing: "This card measures a spread, not a condition, so there is no condition to rank players on. See the home, back-to-back and rest cards.",
  stars: "This card compares groups of players, not one condition. Group comparisons carry no per-player list; see the cards for each condition.",
  stability: "This card checks whether a league-wide effect repeats season to season, not who responds. The persistence of each condition shows on its own card.",
  "stars-vs-others": "This card compares star and non-star players as groups, so there is no single condition to rank players on.",
  "how-it-happened": "This card explains the night after the fact (same game); it is not a pregame condition, so no player ranking applies.",
  "no-forecast": "This card is about a pregame model, not one condition, so no player ranking applies.",
  skill: "This card scores a model, not a condition, so no player ranking applies.",
  flags: "This card counts flagged players against chance across all comparisons; the per-condition lists are on the condition cards.",
  heatmap: "This card compares segments by condition; the per-condition player lists are on the condition cards.",
  "player-effect": "This card tests whether any player-specific effect exists at all; the lists are on the condition cards.",
  drivers: "Box-score drivers are not a condition players respond to, so no player ranking applies.",
  baseline: "This card scores a model, not a condition, so no player ranking applies.",
  shape: "Fitted curves are league-wide shapes, not a condition; see the defence and pace cards for who responds.",
};

const CMP_COND: Record<string, string> = { home_away: "home", b2b_second_vs_rested: "b2b_2nd", b2b_first_vs_rested: "b2b_1st" };

function conditionsSource(cardId: string, conds: string[], ctx: Ctx): ResponderSource {
  const { f, data } = ctx;
  const cells = data.pc.cells[f.seg] ?? {};
  const stats: Record<string, PcCell> = {};
  for (const c of conds) for (const o of PC_OUTCOMES) if (cells[`${c}|${o.id}`]) stats[`${c}|${o.id}`] = cells[`${c}|${o.id}`];
  const labels: Record<string, string> = {};
  for (const c of conds) labels[c] = condShort(data.pc.conditions[c]?.label ?? c);
  return { kind: "conditions", conds, seg: f.seg, ts: f.ts, stats, labels, lead: cardId === "players-out" || cardId === "teammates-out" };
}

const cache = new Map<string, Promise<unknown>>();
function fetchOnce<T>(url: string): Promise<T> {
  let p = cache.get(url) as Promise<T> | undefined;
  if (!p) {
    p = fetch(url).then((r) => {
      if (!r.ok) throw new Error(String(r.status));
      return r.json() as Promise<T>;
    });
    p.catch(() => cache.delete(url));
    cache.set(url, p);
  }
  return p;
}
export const loadCondRows = (seg: string) => fetchOnce<PcRowsFile>(`/player-conditions/${encodeURIComponent(seg)}.json`);
export const loadProfiles = () => fetchOnce<PcProfilesFile>("/player-conditions/profiles.json");

/** Units: dev is in points, event outcomes are stored as a fraction (×100 = percentage points). */
export const scaleOf = (o: string) => (o === "dev" ? 1 : 100);
export const unitOfOutcome = (o: string): "pts" | "pp" => (o === "dev" ? "pts" : "pp");

/** One condition × outcome cell's rows → the shared ResponderSet. */
export function setFromCondRows(cond: string, outcome: string, condLabel: string, cell: PcCell | undefined, rows: { pos: PcRow[]; neg: PcRow[] } | undefined, top: number): ResponderSet {
  const sc = scaleOf(outcome);
  const unit = unitOfOutcome(outcome);
  const league = cell?.lm != null ? cell.lm * sc : null;
  const toRow = (r: PcRow, side: "pos" | "neg"): PlayerConditionRow => ({
    player_id: String(r[0]),
    name: String(r[1]),
    est: (r[5] as number) * sc,
    lo: (r[6] as number) * sc,
    hi: (r[7] as number) * sc,
    unit,
    n_cond: r[2] as number,
    n_ref: r[3] as number,
    flag: flagOf(r[8] as string | null),
    held_out: r[10] == null ? null : r[10] === 1,
    league,
    side,
  });
  const all = [...(rows?.pos ?? []).map((r) => toRow(r, "pos")), ...(rows?.neg ?? []).map((r) => toRow(r, "neg"))];
  const set = buildResponders(all, condLabel, { top });
  set.labels = ["Most responsive", "Least responsive"];
  return set;
}

/** Player-page profile (Data's per-player rows). */
export type ProfileRow = {
  outcome: string;
  side: "pos" | "neg";
  rank: number;
  cond: string;
  nCond: number;
  nRef: number;
  est: number;
  lo: number;
  hi: number;
  league: number;
  vsLeague: number;
  flag: "watch" | "strong" | null;
  verdict: string;
  heldOut: boolean | null;
};
export function profileRows(r: PcProfileRow[]): ProfileRow[] {
  return r.map((x) => {
    const sc = scaleOf(x[0] as string);
    return {
      outcome: x[0] as string,
      side: x[1] as "pos" | "neg",
      rank: x[2] as number,
      cond: x[3] as string,
      nCond: x[4] as number,
      nRef: x[5] as number,
      est: (x[7] as number) * sc,
      lo: (x[8] as number) * sc,
      hi: (x[9] as number) * sc,
      league: (x[10] as number) * sc,
      vsLeague: (x[11] as number) * sc,
      flag: flagOf(x[12] as string | null),
      verdict: x[13] as string,
      heldOut: x[14] == null ? null : x[14] === 1,
    };
  });
}


/**
 * THE adapter. One place that says, per card, where its per-player rows come from:
 *   - conditions: Data's player × condition table (shrunk effects, vs-league flags, persistence verdict)
 *   - async / ready: older per-player exports (player_deep_splits, flagged list, big-nights credible cases)
 *   - na: the card compares groups or models, so there is no condition to rank players on
 */
export function respondersFor(cardId: string, ctx: Ctx, extra?: { cmp?: string; cond?: string; out?: string }): ResponderSource {
  const { f, data } = ctx;
  if (cardId === "rankings") {
    const c = CMP_COND[extra?.cmp ?? "home_away"];
    return conditionsSource(cardId, [c], ctx);
  }
  if (cardId === "watch-list") {
    const flagged = data.splits.flagged.filter((x) => x.scope === f.ts);
    if (flagged.length === 0) return { kind: "none" };
    const rows = flagged.map(rankRow);
    return { kind: "ready", set: buildResponders(rows, "flagged comparisons (all)", { note: "Direction is the sign of each flagged raw gap. Flags are nominal, not confirmed." }) };
  }
  if (cardId === "player-splits" && extra?.cond && extra.out && f.ts !== "2026_27") {
    const { cond, out } = extra;
    return {
      kind: "async",
      key: `${f.ts}|${f.seg}|${cond}|${out}`,
      load: async () => {
        const r = await fetch(`/deep-players/${encodeURIComponent(f.ts)}.json`);
        if (!r.ok) throw new Error(String(r.status));
        const file = (await r.json()) as {
          players: Record<string, [string, string, number]>;
          rows: Record<string, Record<string, (string | number | null)[][]>>;
        };
        const bit = f.seg === "top100" ? 8 : f.seg === "top50" ? 4 : 0;
        const sc = out === "dev" ? 1 : 100;
        const rows: PlayerConditionRow[] = (file.rows[cond]?.[out] ?? [])
          .filter((r) => !bit || ((r[11] as number) & bit))
          .map((r) => ({
            player_id: String(r[0]),
            name: file.players[String(r[0])]?.[0] ?? String(r[0]),
            est: (r[4] as number) * sc,
            lo: (r[5] as number) * sc,
            hi: (r[6] as number) * sc,
            unit: out === "dev" ? ("pts" as const) : ("pp" as const),
            n_cond: r[1] as number,
            n_ref: r[2] as number,
            flag: flagOf(r[9] as string | null),
            held_out: null,
          }));
        return buildResponders(rows, cond, { note: "Shrunk estimates: they sit close to the league-wide figure, so read the interval, not the rank." });
      },
    };
  }
  const conds = COND_MAP[cardId];
  if (conds) return conditionsSource(cardId, conds, ctx);
  if (NA_TEXT[cardId]) return { kind: "na", text: NA_TEXT[cardId] };
  return { kind: "none" };
}
