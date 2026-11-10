"""Big-nights dataset (hoopstats, 2026-11-10).  One row per eligible player-game of the deep-analysis dataset (deep_data.build) plus:
  baselines   prior_avg_std (season-to-date prior mean PTS) and prior_avg_l10 (mean of the last <=10 prior games, chronological across seasons), prior SDs,
  events      x125 / x150 / x200 / p5 / p10 / z15 against each baseline  (pts >= k*avg, >= avg+5, >= avg+10, (pts-avg)/prior_sd >= 1.5)
  LENS A      pregame-only factors (every one built from games / schedule / inactive lists strictly before tip-off)
  LENS B      same-game factors (describe how the night happened; NOT predictive)
Eligibility (all of): >= 5 min played, >= 5 prior games this season (deep set needs 3; this study 5), >= 5 prior games overall, opponent with >= 5 prior games.
"""
from __future__ import annotations
import sys, re
from pathlib import Path
import duckdb
import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import analysis_home_away_b2b as hab
import points_drivers as P
import deep_data as DD

ROOT = Path(__file__).resolve().parents[1]
D = ROOT / "data"
BOX, META = D / "curated" / "player_game_box.parquet", D / "curated" / "game_meta.parquet"
MIN_PRIOR_SEASON = 5
OUT_REASON_OK = re.compile(r"Injury|Illness|Rest|Personal|Suspension|NWT|Concussion|Reconditioning|Trade|Not With Team", re.I)
REG_MIN_GP, REG_SHARE, REG_MPG = 5, 0.5, 20.0       # a teammate is a "regular" if, before the game: >= 5 GP with the team this season, in >= 50% of the team's games, >= 20 min per game played
WEAK, HOT, BIGLAST = 0.75, 1.25, 1.5


def teammates_out(through: str):
    """Per (game_id, team_id): who among the team's REGULARS (prior-games definition) is out (inactive, or DNP for a non-coach reason)."""
    b = duckdb.sql(f"""select season, game_id, game_date, team_id, player_id, status, dnp_reason, coalesce(started,false) started, coalesce(min,0) min, coalesce(pts,0) pts, coalesce(pf,0) pf
                       from '{BOX}' where substr(game_id,1,3)='002' and game_date <= date '{through}'""").df()
    b["game_date"] = pd.to_datetime(b.game_date)
    b["played"] = b.status.isin(["played", "sub_minute"]).astype(int)
    b = b.sort_values(["season", "team_id", "player_id", "game_date", "game_id"]).reset_index(drop=True)
    g = b.groupby(["season", "team_id", "player_id"])
    for c in ("played", "pts", "min"):
        v = b[c] * (b.played if c != "played" else 1)
        b[f"cum_{c}"] = v.groupby([b.season, b.team_id, b.player_id]).cumsum() - v
    st = (b.started.astype(int) * b.played); b["cum_start"] = st.groupby([b.season, b.team_id, b.player_id]).cumsum() - st
    tg = b[["season", "team_id", "game_id", "game_date"]].drop_duplicates().sort_values(["season", "team_id", "game_date", "game_id"])
    tg["team_prior_games"] = tg.groupby(["season", "team_id"]).cumcount()
    b = b.merge(tg[["season", "team_id", "game_id", "team_prior_games"]], on=["season", "team_id", "game_id"], how="left")
    gp = b.cum_played.replace(0, np.nan)
    b["prior_ppg"] = b.cum_pts / gp; b["prior_mpg"] = b.cum_min / gp; b["prior_start_rate_t"] = b.cum_start / gp
    b["regular"] = (b.cum_played >= REG_MIN_GP) & (b.cum_played >= REG_SHARE * b.team_prior_games) & (b.prior_mpg >= REG_MPG)
    reason_ok = b.dnp_reason.fillna("").map(lambda s: bool(OUT_REASON_OK.search(s)))
    b["out"] = ((b.status == "inactive") | ((b.status == "dnp") & reason_ok)).astype(int)
    b["reg_out"] = ((b.regular) & (b.out == 1))
    r = b[b.regular].copy()
    r["rank_ppg"] = r.groupby(["game_id", "team_id"]).prior_ppg.rank(ascending=False, method="first")
    o = r[r.reg_out]
    agg = o.groupby(["game_id", "team_id"]).agg(out_n=("player_id", "size"), out_ppg=("prior_ppg", "sum"), out_mpg=("prior_mpg", "sum"), out_max_ppg=("prior_ppg", "max"),
                                                 out_starter=("prior_start_rate_t", lambda x: int((x >= 0.5).any())), out_top2=("rank_ppg", lambda x: int((x <= 2).any())),
                                                 out_top1=("rank_ppg", lambda x: int((x <= 1).any()))).reset_index()
    teams = b[["game_id", "team_id"]].drop_duplicates()
    agg = teams.merge(agg, on=["game_id", "team_id"], how="left")
    for c in ("out_n", "out_ppg", "out_mpg", "out_max_ppg", "out_starter", "out_top2", "out_top1"):
        agg[c] = agg[c].fillna(0.0)
    # same-game foul trouble of STARTERS (who started that game): number of starters with >= 5 PF; team total PF
    s = b[b.played == 1]
    ft = s[s.started].groupby(["game_id", "team_id"]).agg(starters_pf5=("pf", lambda x: int((x >= 5).sum())), starters_pf4=("pf", lambda x: int((x >= 4).sum()))).reset_index()
    tpf = s.groupby(["game_id", "team_id"]).agg(team_pf=("pf", "sum")).reset_index()
    ft = ft.merge(tpf, on=["game_id", "team_id"], how="outer").fillna(0)
    return agg, ft, b


def prior_extra(raw: pd.DataFrame) -> pd.DataFrame:
    """From the player's >=5-min game series (same ordering as points_drivers): prior SDs, last-1/2/3 games, starts in last 3.  Returns a frame keyed by (player_id, game_id)."""
    raw = raw.sort_values(["player_id", "game_date", "game_id"]).reset_index(drop=True)
    n = len(raw); i = np.arange(n)
    start = i - raw.groupby("player_id").cumcount().to_numpy(); sstart = i - raw.groupby(["player_id", "season"]).cumcount().to_numpy()
    pts = raw.pts.to_numpy(float); pts2 = pts ** 2; mn = raw["min"].to_numpy(float); stt = raw.started.to_numpy(float)
    out = {"player_id": raw.player_id.to_numpy(), "game_id": raw.game_id.to_numpy()}
    for w, lo in (("std", sstart), ("l10", np.maximum(start, i - 10))):
        cnt = (i - lo).astype(float)
        with np.errstate(divide="ignore", invalid="ignore"):
            s1, s2 = P._prior_sum(pts, lo), P._prior_sum(pts2, lo)
            var = (s2 - s1 ** 2 / cnt) / (cnt - 1)
        out[f"prior_sd_{w}"] = np.where(cnt >= (5 if w == "std" else 10), np.sqrt(np.maximum(var, 0)), np.nan); out[f"n_win_{w}"] = cnt
    same = lambda k: (i - k >= sstart)       # k-th previous game exists AND belongs to the same season
    for k in (1, 2, 3):
        sh = np.full(n, np.nan); ok = same(k); sh[ok] = pts[(i - k)[ok]]; out[f"pts_lag{k}"] = sh
        sm = np.full(n, np.nan); sm[ok] = mn[(i - k)[ok]]; out[f"min_lag{k}"] = sm
        ss = np.full(n, np.nan); ss[ok] = stt[(i - k)[ok]]; out[f"start_lag{k}"] = ss
    return pd.DataFrame(out)


def team_form(t: pd.DataFrame) -> pd.DataFrame:
    """Defensive form of every team-game from prior games only: DRtg of the last game, last 5 games (pooled), season-to-date; form_l1 / form_l5 = recent minus season-to-date (positive = recently WORSE defence)."""
    t = t.sort_values(["team_id", "game_date", "game_id"]).reset_index(drop=True)
    n = len(t); i = np.arange(n); sstart = i - t.groupby(["team_id", "season"]).cumcount().to_numpy()
    op, q = t.opp_pts.to_numpy(float), t.poss.to_numpy(float)
    res = {"game_id": t.game_id.to_numpy(), "team_id": t.team_id.to_numpy()}
    with np.errstate(divide="ignore", invalid="ignore"):
        d_std = 100 * P._prior_sum(op, sstart) / P._prior_sum(q, sstart)
        for k, nm in ((1, "l1"), (5, "l5")):
            lo = np.maximum(sstart, i - k); d = 100 * P._prior_sum(op, lo) / P._prior_sum(q, lo)
            ok = (i - lo) >= k
            res[f"opp_form_{nm}"] = np.where(ok, d - d_std, np.nan)
    res["opp_prior_n"] = (i - sstart)
    pa = np.full(n, np.nan); ok = i - 1 >= sstart; pa[ok] = op[(i - 1)[ok]]
    res["opp_pts_allowed_lag1"] = pa
    return pd.DataFrame(res)


def build(through: str = "2026-11-09") -> dict:
    d = DD.build(through)
    WM, t = d["WM"].copy(), d["t"]
    raw = P.load_rows(through)
    started = duckdb.sql(f"select game_id, player_id, started from '{BOX}' where status='played' and substr(game_id,1,3)='002'").df()
    raw = raw.merge(started, on=["game_id", "player_id"], how="left"); raw["started"] = raw.started.astype(float)
    ex = prior_extra(raw)
    WM = WM.merge(ex, on=["player_id", "game_id"], how="left", validate="1:1")
    WM = WM[WM.n_prior_season >= MIN_PRIOR_SEASON].reset_index(drop=True)
    n_elig = len(WM)
    # ---------------- baselines + events
    for w in ("std", "l10"):
        a = WM[f"pts__{w}"].to_numpy(float); sd = WM[f"prior_sd_{w}"].to_numpy(float); y = WM.pts.to_numpy(float)
        WM[f"avg_{w}"] = a
        with np.errstate(divide="ignore", invalid="ignore"):
            WM[f"dev_{w}"] = y - a
            ok = a > 0
            for nm, mult in (("x125", 1.25), ("x150", 1.5), ("x200", 2.0)):
                WM[f"e_{nm}_{w}"] = np.where(ok, (y >= mult * a).astype(float), np.nan)
            WM[f"e_p5_{w}"] = (y >= a + 5).astype(float); WM[f"e_p10_{w}"] = (y >= a + 10).astype(float)
            z = (y - a) / sd
            WM[f"z_{w}"] = np.where(sd > 0.5, z, np.nan)
            WM[f"e_z15_{w}"] = np.where(sd > 0.5, (z >= 1.5).astype(float), np.nan)
    # ---------------- LENS A
    a = WM.avg_std.to_numpy(float)
    for k in (1, 2, 3):
        WM[f"r_lag{k}"] = WM[f"pts_lag{k}"] / a
    WM["bb_last1"] = (WM.r_lag1 < WEAK).astype(float)                                              # last game below 0.75x the (season-to-date) average
    WM["bb_last2"] = ((WM.r_lag1 < WEAK) & (WM.r_lag2 < WEAK)).astype(float)                       # each of the last 2 games below 0.75x
    WM["bb_l3mean"] = (((WM.pts_lag1 + WM.pts_lag2 + WM.pts_lag3) / 3) / a < WEAK).astype(float)    # mean of the last 3 games below 0.75x
    WM["hot_last1"] = (WM.r_lag1 >= HOT).astype(float); WM["hot_l3mean"] = (((WM.pts_lag1 + WM.pts_lag2 + WM.pts_lag3) / 3) / a >= HOT).astype(float)
    WM["bignight_last1"] = (WM.r_lag1 >= BIGLAST).astype(float)
    WM["hot_l5"] = (WM.pts__l5 / a >= 1.15).astype(float)                                           # last-5 average >= 1.15x the season average (sustained heat)
    WM["cold_l5"] = (WM.pts__l5 / a < 0.85).astype(float)
    WM["r_l5"] = WM.pts__l5 / a
    # opponent form
    f = team_form(t)
    of = f.rename(columns={"team_id": "opp_team_id"})
    WM = WM.merge(of[["game_id", "opp_team_id", "opp_form_l1", "opp_form_l5", "opp_pts_allowed_lag1"]], on=["game_id", "opp_team_id"], how="left")
    WM["opp_leaky_l5"] = (WM.opp_form_l5 >= 3).astype(float); WM["opp_tight_l5"] = (WM.opp_form_l5 <= -3).astype(float)
    WM["opp_leaky_l1"] = (WM.opp_form_l1 >= 10).astype(float); WM["opp_tight_l1"] = (WM.opp_form_l1 <= -10).astype(float)
    # role / minutes trend
    WM["min_trend_l5"] = WM.min__l5 - WM.min__std
    WM["min_up3"] = (WM.min_trend_l5 >= 3).astype(float); WM["min_dn3"] = (WM.min_trend_l5 <= -3).astype(float)
    sl3 = WM[["start_lag1", "start_lag2", "start_lag3"]].sum(axis=1, min_count=3)
    WM["starts_l3"] = sl3
    WM["role_promoted"] = ((sl3 >= 2) & (WM.prior_start_rate < 0.5)).astype(float); WM["role_demoted"] = ((sl3 == 0) & (WM.prior_start_rate >= 0.5)).astype(float)
    # season phase
    mo = WM.game_date.dt.month
    WM["phase"] = np.select([mo.isin([10, 11]), mo.isin([12, 1, 2])], ["early_oct_nov", "mid_dec_feb"], "late_mar_apr")
    cup = duckdb.sql(f"select game_id, game_type from '{META}'").df()
    WM = WM.merge(cup, on="game_id", how="left")
    WM["cup_game"] = WM.game_type.isin(["cup_group", "cup_knockout"]).astype(float)
    WM["month"] = mo
    # teammates out (usage vacuum)
    tmo, ft, _ = teammates_out(through)
    WM = WM.merge(tmo, on=["game_id", "team_id"], how="left", validate="m:1")
    opp_tmo = tmo.rename(columns={"team_id": "opp_team_id", **{c: f"opp_{c}" for c in ("out_n", "out_ppg", "out_mpg", "out_max_ppg", "out_starter", "out_top2", "out_top1")}})
    WM = WM.merge(opp_tmo[["game_id", "opp_team_id", "opp_out_n", "opp_out_ppg"]], on=["game_id", "opp_team_id"], how="left", validate="m:1")
    WM["vac_tier"] = np.select([WM.out_ppg <= 0, WM.out_ppg < 10, WM.out_ppg < 20], ["none", "small_lt10", "medium_10_20"], "large_ge20")
    WM["vac_any"] = (WM.out_n > 0).astype(float)
    WM["vac_ge10"] = (WM.out_ppg >= 10).astype(float); WM["vac_ge20"] = (WM.out_ppg >= 20).astype(float)
    WM["vac_star"] = (WM.out_max_ppg >= 20).astype(float)
    WM["opp_vac_ge10"] = (WM.opp_out_ppg >= 10).astype(float)
    # ---------------- LENS B (same game)
    tt = t[["game_id", "team_id", "pts", "opp_pts", "game_min"]].rename(columns={"pts": "team_pts"})
    WM = WM.merge(tt, on=["game_id", "team_id"], how="left", validate="m:1")
    WM["margin"] = WM.team_pts - WM.opp_pts; WM["total_pts"] = WM.team_pts + WM.opp_pts
    WM["ot"] = (WM.game_min > 48.5).astype(float)
    WM["close_le5"] = (WM.margin.abs() <= 5).astype(float); WM["blowout_win_ge15"] = (WM.margin >= 15).astype(float); WM["blowout_loss_ge15"] = (WM.margin <= -15).astype(float)
    WM["win"] = (WM.margin > 0).astype(float)
    WM["total_hi"] = (WM.total_pts >= 240).astype(float); WM["total_lo"] = (WM.total_pts <= 215).astype(float)
    oft = ft.rename(columns={"team_id": "opp_team_id", "starters_pf5": "opp_starters_pf5", "starters_pf4": "opp_starters_pf4", "team_pf": "opp_team_pf"})
    WM = WM.merge(oft, on=["game_id", "opp_team_id"], how="left")
    WM["opp_foul_trouble"] = (WM.opp_starters_pf5 >= 1).astype(float); WM["opp_pf_hi"] = (WM.opp_team_pf >= 25).astype(float)
    WM["min_delta"] = WM["min"] - WM.min__std
    WM["tsa"] = WM.fga + 0.44 * WM.fta; WM["tsa_prior"] = WM.fga__std + 0.44 * WM.fta__std
    WM["b_min_up5"] = (WM.min_delta >= 5).astype(float); WM["b_min_dn5"] = (WM.min_delta <= -5).astype(float)
    WM["b_fga_up4"] = (WM.fga - WM.fga__std >= 4).astype(float); WM["b_fta_up3"] = (WM.fta - WM.fta__std >= 3).astype(float); WM["b_3pa_up3"] = (WM.fg3a - WM.fg3a__std >= 3).astype(float)
    WM["b_usg_up5"] = (WM.usg_pct - WM.usg_pct__std >= 0.05).astype(float)
    WM["b_ts_up10"] = (WM.ts_pct - WM.ts_pct__std >= 0.10).astype(float); WM["b_ts_dn10"] = (WM.ts_pct - WM.ts_pct__std <= -0.10).astype(float)
    # exact ratio decomposition pts = minutes x (TSA per minute) x (2 TS%)  (log shares)
    with np.errstate(divide="ignore", invalid="ignore"):
        WM["ts_game"] = WM.pts / (2 * WM.tsa)
        r_min = WM["min"] / WM.min__std; r_rate = (WM.tsa / WM["min"]) / (WM.tsa_prior / WM.min__std); r_eff = WM.ts_game / WM.ts_pct__std
        WM["lg_min"], WM["lg_rate"], WM["lg_eff"] = np.log(r_min), np.log(r_rate), np.log(r_eff)
        WM["lg_tot"] = WM.lg_min + WM.lg_rate + WM.lg_eff
    # control: volatility (coefficient of variation of prior PTS), prior usage, minutes
    WM["cv_prior"] = WM.prior_sd_std / WM.avg_std
    keep_nan = WM[["opp_form_l5", "opp_form_l1", "out_n", "r_lag1", "r_lag2", "r_lag3", "pos"]].isna().any(axis=1)
    info = dict(d["info"]); info.update(n_after_min_prior5=n_elig, dropped_other_null=int(keep_nan.sum()))
    WM = WM[~keep_nan].reset_index(drop=True)
    info["rows_final"] = int(len(WM))
    d.update(WM=WM, info=info)
    return d


if __name__ == "__main__":
    import time; t0 = time.time()
    d = build()
    WM = d["WM"]
    WM.to_pickle(D / "cache" / "bn" / "bn_WM.pkl")
    pd.to_pickle({k: d[k] for k in ("floors", "CUTS", "pos_map", "info")}, D / "cache" / "bn" / "bn_meta.pkl"); d["G"].to_pickle(D / "cache" / "bn" / "bn_G.pkl")
    print(f"{time.time() - t0:.0f}s rows", len(WM), d["info"])
