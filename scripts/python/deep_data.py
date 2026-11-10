"""Shared dataset for the deep analyses (home/away, B2B, drivers, matchups, tails, tiers).  Everything is PREGAME (strictly prior games, no leakage).

One row per eligible player-game (>= 5 min; >= 5 prior games overall, >= 3 prior this season; opponent with >= 5 prior games = the matchups.py rows).
Columns added on top of matchups.py rows:
  prior_avg     = player's season-to-date prior mean PTS (the baseline, pts__std);  dev = pts - prior_avg
  big5 / big10  = pts >= prior_avg + 5 / + 10 ;  x125 = pts >= 1.25 * prior_avg
  opp_def_u     = (rank_from_worst - 0.5) / n_ranked  in (0, 1): 0 = worst defence by the opponent's as-of season-to-date DRtg (teams with >= 5 games strictly before the date)
  def_tier      = worst5 | worst6_10 | middle | best6_10 | best5   (rank-from-worst fractions 1/6, 1/3, 2/3, 5/6 -> 5/5/10/5/5 teams of 30)
  opp_pace_u    = same for pace: 0 = fastest;  pace_tier = fastest5 | fast6_10 | middle | slow6_10 | slowest5
  usage_tier    from the player's prior season-to-date USG% (minute-weighted):  u1 < .18 <= u2 < .24 <= u3 < .28 <= u4
  min_tier      from the player's prior season-to-date minutes:  m1 < 20 <= m2 < 28 <= m3 < 34 <= m4
  rest_cat      own team rest days 0 / 1 / 2 / 3+ ;  b2b_state = 2nd | 1st | rested (schedule-known before tip-off; same labels as the home/away analysis)
  role          starter if the player started >= 50% of his prior games this season, else bench
"""
from __future__ import annotations
import sys
from pathlib import Path
import duckdb
import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import analysis_home_away_b2b as hab
import points_drivers as P
import matchups as M

ROOT = Path(__file__).resolve().parents[1]
D = ROOT / "data"
USG_CUTS = [0.18, 0.24, 0.28]; MIN_CUTS = [20.0, 28.0, 34.0]
DEF_TIERS = ["worst5", "worst6_10", "middle", "best6_10", "best5"]
PACE_TIERS = ["fastest5", "fast6_10", "middle", "slow6_10", "slowest5"]
USG_TIERS = ["u1_low", "u2_mid", "u3_high", "u4_very_high"]; MIN_TIERS = ["m1_lt20", "m2_20_28", "m3_28_34", "m4_ge34"]


def asof_rank(t: pd.DataFrame, cum_col: str, min_n: int = 5) -> pd.DataFrame:
    """Rank (1 = lowest value) of every team-game's team among the teams with >= min_n games strictly before the date, by the season-to-date value `cum_col` (after-game cumulative)."""
    from scipy import stats
    out = []
    for s, ts in t.groupby("season"):
        dates = np.sort(ts.game_date.unique())
        cum = ts[["team_id", "game_date", cum_col, "cum_n_after"]].sort_values("game_date")
        cols = {}
        for tid, c in cum.groupby("team_id"):
            m = pd.merge_asof(pd.DataFrame({"game_date": dates}), c.sort_values("game_date"), on="game_date", direction="backward", allow_exact_matches=False)
            cols[tid] = m[[cum_col, "cum_n_after"]].to_numpy()
        tids = list(cols)
        V = np.stack([cols[k][:, 0] for k in tids], axis=1); N = np.stack([cols[k][:, 1] for k in tids], axis=1)
        V = np.where(N >= min_n, V, np.nan)
        rank = np.full(V.shape, np.nan); nt = np.sum(~np.isnan(V), axis=1)
        for r in range(V.shape[0]):
            ok = ~np.isnan(V[r])
            if ok.sum() >= 6:
                rank[r, ok] = stats.rankdata(V[r, ok], method="min")
        di = {pd.Timestamp(d): k for k, d in enumerate(dates)}; ti = {k: j for j, k in enumerate(tids)}
        rk = np.array([rank[di[d], ti[tm]] for d, tm in zip(ts.game_date, ts.team_id)]); n = np.array([nt[di[d]] for d in ts.game_date])
        out.append(pd.DataFrame({"game_id": ts.game_id.to_numpy(), "team_id": ts.team_id.to_numpy(), "rank_asc": rk, "n_ranked": n}))
    return pd.concat(out)


def tier5(u: np.ndarray, labels: list[str]) -> np.ndarray:
    """u in (0,1), 0 = 'worst' end; fractions 1/6, 1/3, 2/3, 5/6."""
    b = np.digitize(u, [1 / 6, 1 / 3, 2 / 3, 5 / 6])
    return np.array(labels, dtype=object)[b]


def build(through: str = "2026-11-09"):
    G = hab.load_games(through); G["game_date"] = pd.to_datetime(G["game_date"])
    floors = hab.timespan_floors(G, None)
    ps, _ = hab.segments(G)
    pos_map = {(r.season, r.player_id): r.position for r in ps.itertuples()}
    t, tg_all, box = M.team_tables(through)
    pa = M.pos_allowed(box, t, pos_map)
    t = M.add_team_rolling(t, pa)
    # as-of ranks: DRtg (1 = best defence) and pace (cumulative, 1 = slowest)
    cs_q = t.groupby(["team_id", "season"])["poss"].cumsum(); cs_m = t.groupby(["team_id", "season"])["game_min"].cumsum()
    t["cum_pace_after"] = 48.0 * cs_q / cs_m
    rd = asof_rank(t, "cum_drtg_after").rename(columns={"rank_asc": "def_rank_asc", "n_ranked": "def_n"})
    rp = asof_rank(t, "cum_pace_after").rename(columns={"rank_asc": "pace_rank_asc", "n_ranked": "pace_n"})
    t = t.merge(rd, on=["game_id", "team_id"], how="left").merge(rp, on=["game_id", "team_id"], how="left")
    raw = P.load_rows(through)
    started = duckdb.sql(f"select game_id, player_id, started from '{D / 'curated' / 'player_game_box.parquet'}' where status='played' and substr(game_id,1,3)='002'").df()
    raw = raw.merge(started, on=["game_id", "player_id"], how="left")
    raw["started"] = raw["started"].astype(float)
    raw = raw.sort_values(["player_id", "game_date", "game_id"]).reset_index(drop=True)
    cs = raw.groupby(["player_id", "season"])["started"].cumsum() - raw["started"]; cn = raw.groupby(["player_id", "season"]).cumcount()
    raw["prior_start_rate"] = np.where(cn > 0, cs / cn.replace(0, np.nan), np.nan)
    W = P.add_pregame_features(raw)
    assert "prior_start_rate" in W.columns
    CUTS = {}
    for ts, spec in hab.TIMESPANS.items():
        ds = np.sort(W[W.season.isin(spec["seasons"])].game_date.unique()); nt = max(1, int(round(P.TEST_FRAC * len(ds)))); CUTS[ts] = pd.Timestamp(ds[len(ds) - nt])
    WM, info = M.build_matchup_rows(W, t, pos_map)
    # opponent as-of ranks (the opponent's own series)
    T = t.set_index(["game_id", "team_id"])
    opp = T.loc[list(zip(WM.game_id, WM.opp_team_id))]
    n = opp.def_n.to_numpy(float); rk = opp.def_rank_asc.to_numpy(float)
    WM["opp_def_u"] = ((n + 1 - rk) - 0.5) / n                 # 0 = worst defence
    WM["def_tier"] = tier5(WM.opp_def_u.to_numpy(), DEF_TIERS)
    n2 = opp.pace_n.to_numpy(float); rk2 = opp.pace_rank_asc.to_numpy(float)
    WM["opp_pace_u"] = ((n2 + 1 - rk2) - 0.5) / n2             # 0 = fastest (rank_asc 1 = slowest -> n+1-rank = fastest first)
    WM["pace_tier"] = tier5(WM.opp_pace_u.to_numpy(), PACE_TIERS)
    # own schedule state: 2nd / 1st night of a back-to-back, from the schedule (known before tip-off)
    td = hab.team_dates()
    WM["b2b_state"] = [{"b2b_2nd": "2nd", "b2b_1st": "1st", "rested": "rested", "season_opener": "rested"}[hab.rest_label(td[(s, str(tm))], d.date())] for s, tm, d in zip(WM.season, WM.team_id, WM.game_date)]
    WM["rest_cat"] = np.select([WM.team_rest <= 0, WM.team_rest == 1, WM.team_rest == 2], ["r0", "r1", "r2"], "r3plus")
    WM["prior_avg"] = WM["pts__std"]; WM["dev"] = WM.pts - WM.prior_avg
    WM["big5"] = (WM.dev >= 5).astype(int); WM["big10"] = (WM.dev >= 10).astype(int); WM["x125"] = (WM.pts >= 1.25 * WM.prior_avg).astype(int)
    WM["usg_prior"] = WM["usg_pct__std"]; WM["min_prior"] = WM["min__std"]
    WM["usage_tier"] = np.array(USG_TIERS, dtype=object)[np.digitize(WM.usg_prior, USG_CUTS)]
    WM["min_tier"] = np.array(MIN_TIERS, dtype=object)[np.digitize(WM.min_prior, MIN_CUTS)]
    WM["role"] = np.where(WM.prior_start_rate >= 0.5, "starter", "bench")
    WM["home"] = WM.is_home.astype(int)
    keep_nan = WM[["opp_def_u", "opp_pace_u", "prior_start_rate", "usg_prior", "min_prior"]].isna().any(axis=1)
    info["dropped_deep_null"] = int(keep_nan.sum())
    WM = WM[~keep_nan].reset_index(drop=True)
    return dict(WM=WM, G=G, floors=floors, CUTS=CUTS, pos_map=pos_map, t=t, info=info)


if __name__ == "__main__":
    d = build()
    WM = d["WM"]
    WM.to_pickle("/tmp/deep_WM.pkl"); pd.to_pickle({k: d[k] for k in ("floors", "CUTS", "pos_map", "info")}, "/tmp/deep_meta.pkl"); d["G"].to_pickle("/tmp/deep_G.pkl")
    print(len(WM), d["info"])
    for c in ["def_tier", "pace_tier", "usage_tier", "min_tier", "rest_cat", "b2b_state", "role", "pos"]:
        print(WM[c].value_counts(normalize=True).round(3).to_dict())
    print(WM[["big5", "big10", "x125", "dev"]].describe().T[["mean", "std"]])
    print(WM.groupby("def_tier")[["dev", "big5", "big10", "x125"]].mean().round(3))
    print(WM.groupby("usage_tier")[["dev", "big10", "prior_avg"]].mean().round(3))
