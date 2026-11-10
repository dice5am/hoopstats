import type { SegmentKey, TimespanKey } from "./timespans";

export type DriverRow = {
  driver: string;
  coef: number | null;
  lo: number | null;
  hi: number | null;
  rank: number;
};

export type DriverModel = {
  drivers: DriverRow[];
  test_r2: number | null;
  test_mae: number | null;
  test_rmse: number | null;
  baseline_mae: number | null;
  baseline_r2: number | null;
};

export type DriverCell = {
  thin: boolean;
  fitted: boolean;
  n_players: number;
  n_games: number;
  models: { mixedlm?: DriverModel; ols?: DriverModel };
};

export type Lens = "pregame" | "explanatory";
export type ModelKey = "mixedlm" | "ols";

export type PointsDriversData = {
  through: string | null;
  pregame_spec: string;
  pregame_beats_baseline_mae: Record<
    ModelKey,
    { beat: number; cells: number }
  >;
  date_split: Record<
    string,
    { n_dates: number; n_test_dates: number; cutoff: string }
  >;
  cells: Record<Lens, Record<TimespanKey, Record<SegmentKey, DriverCell>>>;
};

/** Display labels for the parquet `driver` ids. */
export const DRIVER_LABELS: Record<string, string> = {
  fga: "FGA",
  fta: "FTA",
  fg3a: "3PA",
  min: "Minutes",
  ts_pct: "TS%",
  pace: "Pace",
  ast_pct: "AST%",
  oreb_pct: "OREB%",
  dreb_pct: "DREB%",
  tov_pct: "TOV%",
  def_rating: "Def rating",
  off_rating: "Off rating",
  pie: "PIE",
  pts: "Prior PPG",
};
