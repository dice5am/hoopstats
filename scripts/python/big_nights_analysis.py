"""Big-nights analysis (hoopstats, 2026-11-10).  Cells = 5 nested PPG segments x 6 timespans (train-only PPG ranks for membership, as in the deep analyses),
date-based test split per timespan (same cut-off dates as points_drivers / matchups / deep).  Descriptive lifts use ALL eligible rows of the cell with player-clustered SEs
(influence-function / cluster-robust); every out-of-sample number (AUC / Brier / log-loss) is fit on train dates and scored on the later test dates.
Cuts = baseline {std, l10} x event {x125, x150, x200, p5, p10, z15};  floors on the prior average {none(>0), 5, 8 (default), 12}.
Lens A = pregame (knowable before tip-off);  Lens B = same game (explains how it happened; NOT predictive).
"""
from __future__ import annotations
import argparse, math, sys, time, warnings
from multiprocessing import Pool
from pathlib import Path
import numpy as np
import pandas as pd
from scipy import stats
from scipy.special import expit

sys.path.insert(0, str(Path(__file__).resolve().parent))
import analysis_home_away_b2b as hab
import points_drivers as P

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "data" / "cache" / "bn"; (CACHE / "cells").mkdir(parents=True, exist_ok=True)
SEED = 20261110
EVENTS = ["x125", "x150", "x200", "p5", "p10", "z15"]
BASELINES = ["std", "l10"]
FLOORS = [0, 5, 8, 12]; FLOOR_DEFAULT = 8
MODEL_CUTS = [("std", e) for e in EVENTS] + [("l10", "x150"), ("l10", "p10")]
MIN_EVENTS_LIFT = 30           # cell-level: fewer events than this -> no factor lifts
MIN_EVENTS_MODEL = 60          # all rows of the cell
MIN_TRAIN_EV, MIN_TEST_EV = 30, 15
MIN_LEVEL_EV = 10              # level and reference each need >= 10 events to be 'reportable'
SIM_AME = 400
BOOT = 200
WM = None; G_ALL = None; CUTS = None; FLOORS_TS = None

# ------------------------------------------------------------------ factor flags
LENS_A_FLAGS = {   # id -> (dimension, label)
}


def flags(s: pd.DataFrame) -> dict:
    f = {}
    b = lambda c: (s[c] == 1).to_numpy()
    for c in ("bb_last1", "bb_last2", "bb_l3mean", "hot_last1", "hot_l3mean", "hot_l5", "cold_l5", "bignight_last1"): f[c] = b(c)
    dt, pt = s.def_tier, s.pace_tier
    for k in DD_DEF: f[f"deft_{k}"] = (dt == k).to_numpy()
    for k in DD_PACE: f[f"pacet_{k}"] = (pt == k).to_numpy()
    f["def_worst5"] = f["deft_worst5"]; f["def_worst10"] = dt.isin(["worst5", "worst6_10"]).to_numpy(); f["def_best10"] = dt.isin(["best5", "best6_10"]).to_numpy(); f["def_best5"] = f["deft_best5"]
    f["pace_fast10"] = pt.isin(["fastest5", "fast6_10"]).to_numpy(); f["pace_slow10"] = pt.isin(["slowest5", "slow6_10"]).to_numpy()
    for k in ("r0", "r2", "r3plus"): f[f"rest_{k}"] = (s.rest_cat == k).to_numpy()
    f["rest_r1"] = (s.rest_cat == "r1").to_numpy()
    f["b2b_2nd"] = (s.b2b_state == "2nd").to_numpy(); f["b2b_1st"] = (s.b2b_state == "1st").to_numpy(); f["b2b_rested"] = (s.b2b_state == "rested").to_numpy()
    f["opp_b2b"] = b("opp_b2b"); f["home"] = (s.home == 1).to_numpy(); f["away"] = (s.home == 0).to_numpy()
    for c in ("opp_leaky_l5", "opp_tight_l5", "opp_leaky_l1", "opp_tight_l1"): f[c] = b(c)
    f["vac_none"] = (s.vac_tier == "none").to_numpy(); f["vac_small"] = (s.vac_tier == "small_lt10").to_numpy(); f["vac_med"] = (s.vac_tier == "medium_10_20").to_numpy(); f["vac_large"] = (s.vac_tier == "large_ge20").to_numpy()
    f["vac_any"] = b("vac_any"); f["vac_star"] = b("vac_star"); f["out_top1"] = (s.out_top1 == 1).to_numpy(); f["out_starter"] = (s.out_starter == 1).to_numpy(); f["opp_vac_ge10"] = b("opp_vac_ge10")
    f["min_up3"] = b("min_up3"); f["min_dn3"] = b("min_dn3"); f["role_promoted"] = b("role_promoted"); f["role_demoted"] = b("role_demoted")
    f["phase_early"] = (s.phase == "early_oct_nov").to_numpy(); f["phase_mid"] = (s.phase == "mid_dec_feb").to_numpy(); f["phase_late"] = (s.phase == "late_mar_apr").to_numpy(); f["cup_game"] = b("cup_game")
    # lens B
    for c in ("ot", "close_le5", "blowout_win_ge15", "blowout_loss_ge15", "total_hi", "total_lo", "opp_foul_trouble", "opp_pf_hi", "b_min_up5", "b_min_dn5", "b_fga_up4", "b_fta_up3", "b_3pa_up3", "b_usg_up5", "b_ts_up10", "b_ts_dn10"): f[c] = b(c)
    f["win"] = b("win")
    f["total_mid"] = ~(f["total_hi"] | f["total_lo"])
    return f


DD_DEF = ["worst5", "worst6_10", "middle", "best6_10", "best5"]; DD_PACE = ["fastest5", "fast6_10", "middle", "slow6_10", "slowest5"]
# (lens, dimension, factor_id, label, level mask id, reference label, reference mask: id | '~' complement | 'not:a,b' neither-of)
SPECS = [
    ("A", "bounce_back", "bb_last1", "last game below 0.75x average", "bb_last1", "other", "~"),
    ("A", "bounce_back", "bb_last2", "last 2 games both below 0.75x", "bb_last2", "other", "~"),
    ("A", "bounce_back", "bb_l3mean", "last-3 mean below 0.75x", "bb_l3mean", "other", "~"),
    ("A", "hot_streak", "hot_last1", "last game at least 1.25x average", "hot_last1", "other", "~"),
    ("A", "hot_streak", "bignight_last1", "last game at least 1.5x average", "bignight_last1", "other", "~"),
    ("A", "hot_streak", "hot_l3mean", "last-3 mean at least 1.25x average", "hot_l3mean", "other", "~"),
    ("A", "hot_streak", "hot_l5", "last-5 average at least 1.15x season average", "hot_l5", "other", "~"),
    ("A", "hot_streak", "cold_l5", "last-5 average below 0.85x season average", "cold_l5", "other", "~"),
    ("A", "opp_defence", "def_worst5", "opponent worst-5 defence", "def_worst5", "other 25 teams", "~"),
    ("A", "opp_defence", "def_worst10", "opponent worst-10 defence", "def_worst10", "other 20 teams", "~"),
    ("A", "opp_defence", "def_best10", "opponent best-10 defence", "def_best10", "other 20 teams", "~"),
    ("A", "opp_defence", "def_best5", "opponent best-5 defence", "def_best5", "other 25 teams", "~"),
    ("A", "opp_defence_tier", "deft_worst5", "worst 5 (vs middle 10)", "deft_worst5", "middle 10", "deft_middle"),
    ("A", "opp_defence_tier", "deft_worst6_10", "worst 6-10 (vs middle 10)", "deft_worst6_10", "middle 10", "deft_middle"),
    ("A", "opp_defence_tier", "deft_best6_10", "best 6-10 (vs middle 10)", "deft_best6_10", "middle 10", "deft_middle"),
    ("A", "opp_defence_tier", "deft_best5", "best 5 (vs middle 10)", "deft_best5", "middle 10", "deft_middle"),
    ("A", "opp_pace", "pace_fast10", "opponent fastest-10 pace", "pace_fast10", "other 20 teams", "~"),
    ("A", "opp_pace", "pace_slow10", "opponent slowest-10 pace", "pace_slow10", "other 20 teams", "~"),
    ("A", "opp_pace_tier", "pacet_fastest5", "fastest 5 (vs middle 10)", "pacet_fastest5", "middle 10", "pacet_middle"),
    ("A", "opp_pace_tier", "pacet_fast6_10", "fast 6-10 (vs middle 10)", "pacet_fast6_10", "middle 10", "pacet_middle"),
    ("A", "opp_pace_tier", "pacet_slow6_10", "slow 6-10 (vs middle 10)", "pacet_slow6_10", "middle 10", "pacet_middle"),
    ("A", "opp_pace_tier", "pacet_slowest5", "slowest 5 (vs middle 10)", "pacet_slowest5", "middle 10", "pacet_middle"),
    ("A", "rest", "b2b_2nd", "own 2nd night of a back-to-back", "b2b_2nd", "rested", "b2b_rested"),
    ("A", "rest", "b2b_1st", "own 1st night of a back-to-back", "b2b_1st", "rested", "b2b_rested"),
    ("A", "rest", "rest_r0", "own rest days 0", "rest_r0", "1 rest day", "rest_r1"),
    ("A", "rest", "rest_r2", "own rest days 2", "rest_r2", "1 rest day", "rest_r1"),
    ("A", "rest", "rest_r3plus", "own rest days 3+", "rest_r3plus", "1 rest day", "rest_r1"),
    ("A", "rest", "opp_b2b", "opponent on a back-to-back", "opp_b2b", "other", "~"),
    ("A", "venue", "home", "home", "home", "away", "away"),
    ("A", "opp_form", "opp_leaky_l5", "opponent last-5 DRtg 3+ worse than its season", "opp_leaky_l5", "neutral band", "not:opp_leaky_l5,opp_tight_l5"),
    ("A", "opp_form", "opp_tight_l5", "opponent last-5 DRtg 3+ better than its season", "opp_tight_l5", "neutral band", "not:opp_leaky_l5,opp_tight_l5"),
    ("A", "opp_form", "opp_leaky_l1", "opponent last-game DRtg 10+ worse than its season", "opp_leaky_l1", "neutral band", "not:opp_leaky_l1,opp_tight_l1"),
    ("A", "opp_form", "opp_tight_l1", "opponent last-game DRtg 10+ better than its season", "opp_tight_l1", "neutral band", "not:opp_leaky_l1,opp_tight_l1"),
    ("A", "teammates_out", "vac_any", "any regular teammate out", "vac_any", "no regular out", "vac_none"),
    ("A", "teammates_out", "vac_small", "regulars out: <10 prior PPG", "vac_small", "no regular out", "vac_none"),
    ("A", "teammates_out", "vac_med", "regulars out: 10-20 prior PPG", "vac_med", "no regular out", "vac_none"),
    ("A", "teammates_out", "vac_large", "regulars out: 20+ prior PPG", "vac_large", "no regular out", "vac_none"),
    ("A", "teammates_out", "vac_star", "a 20+ PPG teammate out", "vac_star", "other", "~"),
    ("A", "teammates_out", "out_top1", "team's top scorer out", "out_top1", "other", "~"),
    ("A", "teammates_out", "out_starter", "a regular starter out", "out_starter", "other", "~"),
    ("A", "teammates_out", "opp_vac_ge10", "opponent missing 10+ PPG of regulars", "opp_vac_ge10", "other", "~"),
    ("A", "minutes_role", "min_up3", "last-5 minutes 3+ above season", "min_up3", "neutral band", "not:min_up3,min_dn3"),
    ("A", "minutes_role", "min_dn3", "last-5 minutes 3+ below season", "min_dn3", "neutral band", "not:min_up3,min_dn3"),
    ("A", "minutes_role", "role_promoted", "recently promoted to the starting five", "role_promoted", "neutral", "not:role_promoted,role_demoted"),
    ("A", "minutes_role", "role_demoted", "recently demoted from the starting five", "role_demoted", "neutral", "not:role_promoted,role_demoted"),
    ("A", "season_phase", "phase_early", "early season (Oct-Nov)", "phase_early", "mid (Dec-Feb)", "phase_mid"),
    ("A", "season_phase", "phase_late", "late season (Mar-Apr)", "phase_late", "mid (Dec-Feb)", "phase_mid"),
    ("A", "season_phase", "cup_game", "NBA Cup group/knockout game", "cup_game", "other", "~"),
    ("B", "overtime", "ot", "game went to overtime", "ot", "regulation", "~"),
    ("B", "game_script", "close_le5", "final margin within 5", "close_le5", "other", "~"),
    ("B", "game_script", "blowout_win_ge15", "own team won by 15+", "blowout_win_ge15", "other", "~"),
    ("B", "game_script", "blowout_loss_ge15", "own team lost by 15+", "blowout_loss_ge15", "other", "~"),
    ("B", "game_script", "total_hi", "combined score 240+", "total_hi", "combined 216-239", "total_mid"),
    ("B", "game_script", "total_lo", "combined score 215 or fewer", "total_lo", "combined 216-239", "total_mid"),
    ("B", "game_script", "win", "own team won", "win", "own team lost", "~"),
    ("B", "opp_fouls", "opp_foul_trouble", "an opposing starter with 5+ fouls", "opp_foul_trouble", "none", "~"),
    ("B", "opp_fouls", "opp_pf_hi", "opponent team fouls 25+", "opp_pf_hi", "fewer", "~"),
    ("B", "spikes", "b_min_up5", "minutes 5+ above prior average", "b_min_up5", "neutral band", "not:b_min_up5,b_min_dn5"),
    ("B", "spikes", "b_min_dn5", "minutes 5+ below prior average", "b_min_dn5", "neutral band", "not:b_min_up5,b_min_dn5"),
    ("B", "spikes", "b_fga_up4", "FGA 4+ above prior average", "b_fga_up4", "other", "~"),
    ("B", "spikes", "b_fta_up3", "FTA 3+ above prior average", "b_fta_up3", "other", "~"),
    ("B", "spikes", "b_3pa_up3", "3PA 3+ above prior average", "b_3pa_up3", "other", "~"),
    ("B", "spikes", "b_usg_up5", "usage 5+ points above prior", "b_usg_up5", "other", "~"),
    ("B", "spikes", "b_ts_up10", "TS% 10+ points above prior", "b_ts_up10", "neutral band", "not:b_ts_up10,b_ts_dn10"),
    ("B", "spikes", "b_ts_dn10", "TS% 10+ points below prior", "b_ts_dn10", "neutral band", "not:b_ts_up10,b_ts_dn10"),
]
SPEC_LABEL = {sp[2]: sp[3] for sp in SPECS}


def thin_level(n_games, n_players):
    return bool(n_players < P.THIN_PLAYERS or n_games < P.THIN_GAMES)


def mean_infl(y, mask, cl, C):
    n = int(mask.sum())
    if n == 0: return None
    m = float(y[mask].mean())
    u = np.bincount(cl[mask], weights=y[mask] - m, minlength=C) / n
    return m, n, u, int((np.bincount(cl[mask], minlength=C) > 0).sum())


def contrast(y, ma, mb, cl, C):
    a, b = mean_infl(y, ma, cl, C), mean_infl(y, mb, cl, C)
    if a is None or b is None: return None
    out = dict(rate_level=a[0], rate_ref=b[0], n_level=a[1], n_ref=b[1], n_players_level=a[3], n_players_ref=b[3], events_level=int(round(a[0] * a[1])), events_ref=int(round(b[0] * b[1])))
    d = a[0] - b[0]; se = float(np.sqrt(((a[2] - b[2]) ** 2).sum()))
    out.update(rd=d, rd_lo=d - 1.96 * se, rd_hi=d + 1.96 * se)
    if a[0] > 0 and b[0] > 0:
        sl = float(np.sqrt(((a[2] / a[0] - b[2] / b[0]) ** 2).sum())); lr = math.log(a[0] / b[0])
        out.update(rr=a[0] / b[0], rr_lo=math.exp(lr - 1.96 * sl), rr_hi=math.exp(lr + 1.96 * sl))
    if 0 < a[0] < 1 and 0 < b[0] < 1:
        sl = float(np.sqrt(((a[2] / (a[0] * (1 - a[0])) - b[2] / (b[0] * (1 - b[0]))) ** 2).sum())); lo = math.log(a[0] / (1 - a[0])) - math.log(b[0] / (1 - b[0]))
        out.update(odds_ratio=math.exp(lo), or_lo=math.exp(lo - 1.96 * sl), or_hi=math.exp(lo + 1.96 * sl))
    return out


def cell_members(ts, seg):
    spec = hab.TIMESPANS[ts]; cut = CUTS[ts]
    g = G_ALL[G_ALL.season.isin(spec["seasons"])]; share = len(g[g.game_date < cut]) / len(g)
    floor_tr = None if FLOORS_TS[ts] is None else max(1, int(math.ceil(FLOORS_TS[ts] * share)))
    return hab.segment_members(hab.rank_table(G_ALL[G_ALL.game_date < cut], ts, floor_tr))[seg]


def event_rows(sub: pd.DataFrame, baseline: str, ev: str, floor: float):
    col = f"e_{ev}_{baseline}"
    m = (sub[f"avg_{baseline}"] >= floor) & (sub[f"avg_{baseline}"] > 0) & sub[col].notna()
    return sub[m.to_numpy()].reset_index(drop=True), col


# ------------------------------------------------------------------ models
CTRL = ["lavg", "cv", "usg", "mins", "prog"]


def add_model_cols(s: pd.DataFrame, baseline: str) -> pd.DataFrame:
    s = s.copy(); a = s[f"avg_{baseline}"]
    s["lavg"] = np.log(a); s["cv"] = s[f"prior_sd_{baseline}"] / a if baseline == "std" else s.prior_sd_l10 / a; s["cv"] = s.cv.fillna(s.cv.median())
    s["usg"] = s.usg_prior; s["mins"] = s.min_prior; s["prog"] = np.log(s.n_prior_season.astype(float))
    s["vac_small_f"] = (s.vac_tier == "small_lt10").astype(float); s["vac_med_f"] = (s.vac_tier == "medium_10_20").astype(float); s["vac_large_f"] = (s.vac_tier == "large_ge20").astype(float)
    s["def_worst10_f"] = s.def_tier.isin(["worst5", "worst6_10"]).astype(float); s["def_best10_f"] = s.def_tier.isin(["best5", "best6_10"]).astype(float)
    s["pace_fast10_f"] = s.pace_tier.isin(["fastest5", "fast6_10"]).astype(float); s["pace_slow10_f"] = s.pace_tier.isin(["slowest5", "slow6_10"]).astype(float)
    s["b2b_2nd_f"] = (s.b2b_state == "2nd").astype(float); s["b2b_1st_f"] = (s.b2b_state == "1st").astype(float)
    s["phase_early_f"] = (s.phase == "early_oct_nov").astype(float); s["phase_late_f"] = (s.phase == "late_mar_apr").astype(float)
    s["pos_G"] = (s.pos == "G").astype(float); s["pos_F"] = (s.pos == "F").astype(float); s["starter_rate"] = s.prior_start_rate
    s["d_min"] = s["min"] - s.min__std; s["d_fga"] = s.fga - s.fga__std; s["d_fta"] = s.fta - s.fta__std; s["d_3pa"] = s.fg3a - s.fg3a__std
    s["d_usg"] = (s.usg_pct - s.usg_pct__std) * 100; s["d_ts"] = (s.ts_game - s.ts_pct__std).fillna(0) * 100; s["abs_margin"] = s.margin.abs()
    return s


CONT_A = ["lavg", "cv", "usg", "mins", "prog", "starter_rate"]
BIN_A = {  # model term -> column
    "bb_last1": "bb_last1", "bb_last2": "bb_last2", "hot_last1": "hot_last1", "hot_l5": "hot_l5", "cold_l5": "cold_l5",
    "def_worst10": "def_worst10_f", "def_best10": "def_best10_f", "pace_fast10": "pace_fast10_f", "pace_slow10": "pace_slow10_f",
    "home": "home", "b2b_2nd": "b2b_2nd_f", "b2b_1st": "b2b_1st_f", "opp_b2b": "opp_b2b",
    "opp_leaky_l5": "opp_leaky_l5", "opp_tight_l5": "opp_tight_l5", "opp_leaky_l1": "opp_leaky_l1", "opp_tight_l1": "opp_tight_l1",
    "vac_small": "vac_small_f", "vac_med": "vac_med_f", "vac_large": "vac_large_f", "out_top1": "out_top1", "opp_vac_ge10": "opp_vac_ge10",
    "min_up3": "min_up3", "min_dn3": "min_dn3", "role_promoted": "role_promoted", "role_demoted": "role_demoted",
    "phase_early": "phase_early_f", "phase_late": "phase_late_f", "cup_game": "cup_game"}
CTRL_BIN = ["pos_G", "pos_F"]
CONT_B = {"d_min": "minutes vs prior (per SD)", "d_fga": "FGA vs prior (per SD)", "d_fta": "FTA vs prior (per SD)", "d_3pa": "3PA vs prior (per SD)", "d_usg": "usage vs prior (per SD)", "d_ts": "TS% vs prior (per SD)"}
BIN_B = {"ot": "ot", "close_le5": "close_le5", "blowout_win_ge15": "blowout_win_ge15", "blowout_loss_ge15": "blowout_loss_ge15", "opp_foul_trouble": "opp_foul_trouble"}
TERM_NOTE = {"lavg": "log prior average (per SD)", "cv": "volatility = prior SD / prior average (per SD)", "usg": "prior usage (per SD)", "mins": "prior minutes (per SD)", "prog": "log prior games (per SD)", "starter_rate": "prior start rate (per SD)"}


def design(df: pd.DataFrame, lens: str, st: dict | None = None):
    X = pd.DataFrame(index=df.index); st = st or {}
    conts = CONT_A + (list(CONT_B) if lens == "B" else [])
    for c in conts:
        if c not in st: st[c] = (float(df[c].mean()), float(df[c].std() or 1.0))
        X[c] = (df[c] - st[c][0]) / (st[c][1] or 1.0)
    for c in CTRL_BIN: X[c] = df[c].astype(float)
    bins = BIN_A if lens == "A" else BIN_B
    for t, c in bins.items(): X[t] = df[c].astype(float)
    X.insert(0, "const", 1.0)
    return X, st


def drop_const(X):
    keep = [c for c in X.columns if c == "const" or X[c].nunique() > 1]
    # drop near-empty binary terms (< 15 ones) in this fit
    keep = [c for c in keep if c == "const" or X[c].nunique() > 2 or X[c].sum() >= 15]
    return X[keep]


def fit_logit(X, y, cl):
    import statsmodels.api as sm
    m = sm.Logit(y, X.to_numpy())
    try: r = m.fit(disp=0, maxiter=200, cov_type="cluster", cov_kwds={"groups": cl})
    except Exception: r = m.fit(disp=0, maxiter=500, method="bfgs", cov_type="cluster", cov_kwds={"groups": cl})
    return r


def ame(X, res, col, rng, binary, n_max=10000):
    j = list(X.columns).index(col); A = X.to_numpy()
    if len(A) > n_max: A = A[rng.choice(len(A), n_max, replace=False)]
    A1, A0 = A.copy(), A.copy()
    if binary: A1[:, j] = 1; A0[:, j] = 0
    else: A1[:, j] = A[:, j] + 1
    B = rng.multivariate_normal(res.params, res.cov_params(), size=SIM_AME).T
    d = (expit(A1 @ B) - expit(A0 @ B)).mean(0)
    pt = float((expit(A1 @ res.params) - expit(A0 @ res.params)).mean())
    return pt, float(np.percentile(d, 2.5)), float(np.percentile(d, 97.5))


def logit_rows(s, lens, y, key, rng):
    X, _ = design(s, lens); X = drop_const(X); cl = pd.factorize(s.player_id)[0]
    res = fit_logit(X, y, cl)
    if not np.all(np.isfinite(res.bse)) or np.abs(res.params).max() > 12:
        return [dict(key, lens=lens, term=None, notes="not reported: non-finite SE or separation")]
    rows = []
    for i, c in enumerate(X.columns):
        if c == "const": continue
        binary = X[c].nunique() <= 2
        pt, lo, hi = ame(X, res, c, rng, binary)
        rows.append(dict(key, lens=lens, term=c, term_label=SPEC_LABEL.get(c) or CONT_B.get(c) or TERM_NOTE.get(c) or c, term_kind="binary" if binary else "per_sd", is_control=c in CONT_A + CTRL_BIN,
                         odds_ratio=float(np.exp(res.params[i])), or_lo=float(np.exp(res.params[i] - 1.96 * res.bse[i])), or_hi=float(np.exp(res.params[i] + 1.96 * res.bse[i])),
                         p_value=float(res.pvalues[i]), ame=pt, ame_lo=lo, ame_hi=hi, base_rate=float(y.mean()), n_games=len(s), n_events=int(y.sum()), notes=""))
    return rows


def auc_boot(y, preds: dict, players, rng):
    """AUC / Brier / log-loss per model + paired player-cluster bootstrap CIs of the AUC and log-loss differences for the two comparisons that matter:
    pregame logistic vs controls-only, and boosting vs the pregame logistic."""
    from sklearn.metrics import roc_auc_score, brier_score_loss, log_loss
    names = list(preds); out = {}
    for n in names:
        p = np.clip(preds[n], 1e-6, 1 - 1e-6)
        out[n] = dict(auc=float(roc_auc_score(y, p)), brier=float(brier_score_loss(y, p)), logloss=float(log_loss(y, p)))
    pairs = {"logit_pregame": "logit_controls", "boosting_pregame": "logit_pregame", "logit_same_game": "logit_controls"}
    uc, inv = np.unique(players, return_inverse=True); idx_by = [np.where(inv == k)[0] for k in range(len(uc))]
    A = {n: [] for n in names}; LL = {n: [] for n in names}
    for _ in range(BOOT):
        pick = rng.integers(0, len(uc), len(uc)); ii = np.concatenate([idx_by[k] for k in pick]); yy = y[ii]
        if yy.sum() < 3 or yy.sum() == len(yy):
            for n in names: A[n].append(np.nan); LL[n].append(np.nan)
            continue
        for n in names:
            p = np.clip(preds[n][ii], 1e-6, 1 - 1e-6); A[n].append(roc_auc_score(yy, p)); LL[n].append(log_loss(yy, p))
    A = {n: np.array(v) for n, v in A.items()}; LL = {n: np.array(v) for n, v in LL.items()}
    for n in names:
        a = A[n][~np.isnan(A[n])]
        out[n]["auc_lo"], out[n]["auc_hi"] = (float(np.percentile(a, 2.5)), float(np.percentile(a, 97.5))) if len(a) > 20 else (None, None)
        r = pairs.get(n)
        if r in A and len(a) > 20:
            da = A[n] - A[r]; dl = LL[n] - LL[r]; da = da[~np.isnan(da)]; dl = dl[~np.isnan(dl)]
            out[n].update(ref_model=r, dauc_vs_ref=float(out[n]["auc"] - out[r]["auc"]), dauc_lo=float(np.percentile(da, 2.5)), dauc_hi=float(np.percentile(da, 97.5)),
                          dlogloss_vs_ref=float(out[n]["logloss"] - out[r]["logloss"]), dll_lo=float(np.percentile(dl, 2.5)), dll_hi=float(np.percentile(dl, 97.5)))
    return out


GBM_COLS_A = ["lavg", "cv", "usg", "mins", "prog", "starter_rate", "pos_G", "pos_F", "r_lag1", "r_lag2", "r_l5", "opp_def_u", "opp_pace_u", "home", "team_rest", "opp_b2b", "opp_form_l5", "opp_form_l1", "out_n", "out_ppg", "out_max_ppg", "out_top1", "opp_out_ppg", "min_trend_l5", "starts_l3", "month", "cup_game"]


def gbm_fit_predict(tr, te, y_tr, ydate_tr):
    import lightgbm as lgb
    X_tr, X_te = tr[GBM_COLS_A].astype(float), te[GBM_COLS_A].astype(float)
    ud = np.sort(np.unique(ydate_tr)); cutd = ud[int(len(ud) * 0.85)]; va = ydate_tr >= cutd; fit = ~va
    params = dict(objective="binary", learning_rate=0.03, num_leaves=15, min_child_samples=100, subsample=0.8, subsample_freq=1, colsample_bytree=0.8, reg_lambda=5.0, n_estimators=600, random_state=SEED, verbose=-1, n_jobs=1)
    m = lgb.LGBMClassifier(**params)
    m.fit(X_tr[fit], y_tr[fit], eval_set=[(X_tr[va], y_tr[va])], callbacks=[lgb.early_stopping(40, verbose=False)])
    return m, m.predict_proba(X_te)[:, 1]


def model_perf(tr, te, ycol, key, rng, shap_out):
    """Train on earlier dates, score on later dates.  Models: M0 controls only, M1 pregame (lens A) logistic, GBM on the lens-A inputs, M2 same-game (lens B) logistic (explanatory)."""
    ytr, yte = tr[ycol].to_numpy(int), te[ycol].to_numpy(int)
    if ytr.sum() < MIN_TRAIN_EV or yte.sum() < MIN_TEST_EV or yte.sum() == len(yte):
        return [], f"{ycol}: train events {int(ytr.sum())}, test events {int(yte.sum())} -> not scored"
    preds = {}; notes = []
    def lg(lens, cols_only_ctrl=False):
        Xtr, st = design(tr, lens)
        if cols_only_ctrl: Xtr = Xtr[["const"] + CONT_A + CTRL_BIN]
        Xtr = drop_const(Xtr); Xte, _ = design(te, lens, st); Xte = Xte[Xtr.columns]
        r = fit_logit(Xtr, ytr, pd.factorize(tr.player_id)[0])
        return expit(Xte.to_numpy() @ r.params)
    for name, fn in (("logit_controls", lambda: lg("A", True)), ("logit_pregame", lambda: lg("A")), ("logit_same_game", lambda: lg("B"))):
        try: preds[name] = fn()
        except Exception as e: notes.append(f"{name} failed {type(e).__name__}")
    gm = None
    try:
        gm, pg = gbm_fit_predict(tr, te, ytr, tr.game_date.to_numpy()); preds["boosting_pregame"] = pg
    except Exception as e: notes.append(f"boosting failed {type(e).__name__}: {e}")
    if "logit_controls" not in preds: return [], "; ".join(notes)
    o = {"logit_controls": preds.pop("logit_controls")}; o.update(preds)
    res = auc_boot(yte, o, te.player_id.to_numpy(), rng)
    rows = []
    for n, v in res.items():
        rows.append(dict(key, model=n, lens={"logit_same_game": "B"}.get(n, "A"), n_train=len(tr), n_test=len(te), train_events=int(ytr.sum()), test_events=int(yte.sum()), test_base_rate=float(yte.mean()),
                         train_base_rate=float(ytr.mean()), **v, predictive=(n != "logit_same_game"), notes="same-game inputs: explains the night, NOT a pregame model" if n == "logit_same_game" else ""))
    # SHAP only if boosting beats the pregame logistic on the date-split test (AUC gain with CI above 0 and a lower log-loss)
    if "boosting_pregame" in res and "logit_pregame" in res:
        g, l = res["boosting_pregame"], res["logit_pregame"]
        # 'clearly beats': AUC gain >= 0.005 with the paired player-cluster 95% CI above 0, log-loss CI below 0, and a lower Brier score
        beats = bool(g.get("dauc_lo") is not None and g["dauc_lo"] > 0 and g["dauc_vs_ref"] >= 0.005 and g["dll_hi"] < 0 and g["brier"] < l["brier"])
        for r in rows:
            if r["model"] == "boosting_pregame": r["beats_logistic_pregame"] = beats; r["notes"] = "kept: clearly beats the pregame logistic (paired CI) on the test split" if beats else "not kept: does not clearly beat the pregame logistic on the test split (linear is enough)"
        if beats and gm is not None:
            try:
                import shap
                te_s = te[GBM_COLS_A].astype(float); te_s = te_s.sample(min(len(te_s), 3000), random_state=SEED)
                sv = shap.TreeExplainer(gm).shap_values(te_s); sv = sv[1] if isinstance(sv, list) else sv
                for c, v in zip(GBM_COLS_A, np.abs(sv).mean(0)): shap_out.append(dict(key, feature=c, shap_mean_abs=float(v)))
            except Exception as e: notes.append(f"shap failed {type(e).__name__}")
    return rows, "; ".join(notes)


# ------------------------------------------------------------------ same-game profile (lens B, descriptive)
def profile_rows(s, ycol, key):
    y = s[ycol].to_numpy() == 1; rows = []
    if y.sum() < 10: return rows
    for nm, m in (("big_night", y), ("other", ~y)):
        x = s[m]
        tot = x.lg_tot.sum()
        rows.append(dict(key, group=nm, n_games=int(len(x)), mean_pts=float(x.pts.mean()), mean_prior_avg=float(x[[c for c in x.columns if c == 'avg_std'][0]].mean()), d_min=float(x["min"].sub(x.min__std).mean()),
                         d_fga=float(x.fga.sub(x.fga__std).mean()), d_fta=float(x.fta.sub(x.fta__std).mean()), d_3pa=float(x.fg3a.sub(x.fg3a__std).mean()), d_usg_pp=float((x.usg_pct - x.usg_pct__std).mean() * 100),
                         d_ts_pp=float((x.ts_game - x.ts_pct__std).mean() * 100), share_minutes=float(x.lg_min.sum() / tot) if tot else None, share_shot_rate=float(x.lg_rate.sum() / tot) if tot else None,
                         share_efficiency=float(x.lg_eff.sum() / tot) if tot else None, mean_margin=float(x.margin.mean()), pct_ot=float(x.ot.mean()), pct_close=float(x.close_le5.mean()), pct_blowout_win=float(x.blowout_win_ge15.mean()),
                         pct_blowout_loss=float(x.blowout_loss_ge15.mean()), pct_opp_foul_trouble=float(x.opp_foul_trouble.mean())))
    return rows


# ------------------------------------------------------------------ cell
def level_masks(s_, fl):
    out = []
    n = len(s_)
    for lens, dim, fid, label, lm, reflab, ref in SPECS:
        a = fl[lm]
        if ref == "~": b = ~a
        elif ref.startswith("not:"): b = ~np.any([fl[k] for k in ref[4:].split(",")], axis=0)
        else: b = fl[ref]
        out.append((lens, dim, fid, label, reflab, a, b))
    return out


def run_cell(task):
    ts, seg = task; t0 = time.time(); warnings.filterwarnings("ignore")
    rng = np.random.default_rng(SEED + (abs(hash((ts, seg))) % 10000)); cut = CUTS[ts]
    spec = hab.TIMESPANS[ts]; w = WM[WM.season.isin(spec["seasons"])]; mem = cell_members(ts, seg); sub0 = w[w.player_id.isin(mem)].reset_index(drop=True)
    prov = ts in ("2026_27", "pooled_2023_27")
    out = dict(counts=[], lift=[], model=[], perf=[], shap=[], profile=[], log=dict(ts=ts, seg=seg, cutoff=str(cut.date()), notes=[]))
    L = out["log"]["notes"]
    for floor in FLOORS:
        for bl in BASELINES:
            for ev in EVENTS:
                s, col = event_rows(sub0, bl, ev, floor)
                n, npl = len(s), int(s.player_id.nunique()); thin = thin_level(n, npl)
                key = dict(floor=floor, baseline=bl, event=ev, timespan=ts, segment=seg, provisional=prov)
                nev = int(s[col].sum()) if n else 0
                tr_n = int((s.game_date < cut).sum()); te_n = n - tr_n
                out["counts"].append(dict(key, n_games=n, n_players=npl, n_events=nev, base_rate=(nev / n if n else None), n_players_with_event=int(s[s[col] == 1].player_id.nunique()) if n else 0,
                                          n_train_games=tr_n, n_test_games=te_n, n_test_events=int(s[s.game_date >= cut][col].sum()) if n else 0, thin_flag=thin, low_events=nev < MIN_EVENTS_LIFT, default_floor=floor == FLOOR_DEFAULT))
                if n < 100 or nev < MIN_EVENTS_LIFT or nev > n - MIN_EVENTS_LIFT: continue
                y = s[col].to_numpy(float); cl = pd.factorize(s.player_id)[0]; C = cl.max() + 1; fl = flags(s)
                for lens, dim, fid, label, reflab, ma, mb in level_masks(s, fl):
                    c = contrast(y, ma, mb, cl, C)
                    if c is None: continue
                    lvl_thin = thin_level(c["n_level"], c["n_players_level"])
                    c.update(key); c.update(lens=lens, dimension=dim, factor=fid, label=label, reference=reflab, thin_cell=thin, thin_level=lvl_thin,
                                            reportable=bool((not thin) and (not lvl_thin) and c["events_level"] >= MIN_LEVEL_EV and c["events_ref"] >= MIN_LEVEL_EV and c["n_ref"] >= 100),
                                            n_cell_games=n, n_cell_events=nev, base_rate=nev / n)
                    out["lift"].append(c)
                if floor == FLOOR_DEFAULT:
                    pr = profile_rows(s.assign(avg_std=s.avg_std), col, key)
                    out["profile"] += pr
                    if (bl, ev) in MODEL_CUTS:
                        try:
                            sm_ = add_model_cols(s, bl); s_tr, s_te = sm_[sm_.game_date < cut].reset_index(drop=True), sm_[sm_.game_date >= cut].reset_index(drop=True)
                            if nev >= MIN_EVENTS_MODEL and n >= 300 and npl >= 15:
                                for lens in ("A", "B"):
                                    out["model"] += logit_rows(sm_, lens, y.astype(int), dict(key, n_cell_games=n, thin_flag=thin), rng)
                            else: L.append(f"{bl}:{ev}: {nev} events -> logistic not fitted")
                            if nev >= MIN_EVENTS_MODEL and len(s_tr) >= 300 and len(s_te) >= 100:
                                pf, note = model_perf(s_tr, s_te, col, dict(key, thin_flag=thin), rng, out["shap"]); out["perf"] += pf
                                if note: L.append(f"{bl}:{ev}: {note}")
                        except Exception as e: L.append(f"{bl}:{ev}: model failed {type(e).__name__}: {e}")
    return out, time.time() - t0


def work(task):
    f = CACHE / "cells" / f"{task[0]}__{task[1]}.pkl"
    if f.exists(): return task, None, 0.0
    out, dt = run_cell(task); pd.to_pickle(out, f); return task, None, dt


def init(through="2026-11-09"):
    global WM, G_ALL, CUTS, FLOORS_TS
    WM = pd.read_pickle(CACHE / "bn_WM.pkl"); meta = pd.read_pickle(CACHE / "bn_meta.pkl"); G_ALL = pd.read_pickle(CACHE / "bn_G.pkl")
    CUTS, FLOORS_TS = meta["CUTS"], meta["floors"]


if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("--workers", type=int, default=6); ap.add_argument("--only", default=""); a = ap.parse_args()
    init(); t0 = time.time()
    tasks = [(ts, sg) for ts in hab.TIMESPANS for sg in hab.SEGMENT_IDS if not a.only or a.only in f"{ts}:{sg}"]
    size = lambda t: len(WM[WM.season.isin(hab.TIMESPANS[t[0]]["seasons"])]) * {"all": 1, "top100": .6, "top50": .4, "top25": .25, "top10": .12}[t[1]]
    tasks.sort(key=lambda t: -size(t))
    with Pool(a.workers) as pool:
        for k, _, dt in pool.imap_unordered(work, tasks):
            print("done", k, f"{dt:.0f}s", f"{time.time() - t0:.0f}s elapsed", flush=True)
