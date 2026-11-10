/** Shapes of src/generated/player_conditions.json (stats) and public/player-conditions/*.json (player rows). */
export type PcOutcome = "dev" | "x125" | "x150" | "x200" | "p10";

export type PcCell = {
  verdict: string;
  pclass: string;
  rankOk: boolean;
  /** players in the cell */
  np: number;
  /** league mean effect (points for dev, fraction for event outcomes) */
  lm: number | null;
  tau: number | null;
  /** EB reliability: share of a player's raw estimate that is signal */
  rel: number | null;
  strong: number;
  watch: number;
  expStrong: number | null;
  expWatch: number | null;
  permP: number | null;
  /** temporal persistence: [r, lo, hi, n pairs, BH q] */
  tr: (number | null)[];
  slope: number | null;
  oe: number | null;
  /** flags vs league in the 2023-25 → 2025-26 test: [flagged, significance repeated, sign repeat rate] */
  fl: (number | null)[];
};

export type PlayerConditionsData = {
  timespan: string;
  through: string;
  provisional_timespans: string[];
  conditions: Record<string, { label: string; group: string }>;
  min_n_both_sides: number;
  min_n_rank: number;
  caveats: string[];
  flag_rules: { strong: string; watch: string; note: string };
  insights: { id: string; kind: string; title: string; text: string }[];
  cells: Record<string, Record<string, PcCell>>;
};

/** [player_id, name, n_cond, n_ref, raw, shrunk, lo, hi, flag_vs_league, dev_from_league, held(0/1/null), shrunk_2023_25, raw_2025_26] */
export type PcRow = (string | number | null)[];
export type PcRowsFile = { timespan: string; segment: string; through: string; cells: Record<string, { pos: PcRow[]; neg: PcRow[] }> };

/** [outcome, side, rank, condition, n_cond, n_ref, raw, shrunk, lo, hi, league_mean, dev_from_league, flag_vs_league, verdict, held(0/1/null)] */
export type PcProfileRow = (string | number | null)[];
export type PcProfilesFile = {
  timespan: string;
  through: string;
  conditions: Record<string, { label: string; group: string }>;
  players: Record<string, { name: string; star: boolean; top50: boolean; avail: number; rows: PcProfileRow[] }>;
};
