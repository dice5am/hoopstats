"""Opponent / matchup analysis for hoopstats points (2026-11-10), under the points-driver playbook rules.

Builds (all PREGAME: strictly prior games only, the game itself excluded):
  matchup_opponent_features  one row per team-game: that team's pregame defensive features (drtg, pace, points allowed, points allowed to G/F/C per 36), rest, B2B
  matchups                   tidy model table (same schema as points_drivers, lens = pregame): box-only reference (@l10) vs box + opponent features (@l10+opp, @l10+opp_std)
  matchup_player_splits      per player: PTS vs strong / mid / weak defenses (opponent pregame DRtg terciles), DerSimonian-Laird shrinkage

Opponent features (all from TEAM TOTALS of the box scores, never an average of player ratings):
  opp_drtg         100 * sum(points allowed) / sum(possessions)           possessions = 0.5 * (own + opp estimates), est = FGA + 0.44 FTA - OREB + TOV
  opp_pace         48 * sum(possessions) / sum(game minutes)              game minutes = team minutes / 5 (overtime counted)
  opp_pts_allowed  mean points allowed per game
  opp_pts_pos      36 * sum(points scored against the opponent by the player's position group) / sum(minutes of that group)   position = G/F/C primary roster position
Windows (within the season): l10 = last up to 10 prior games, std = all prior games this season; both need >= 5 prior opponent games (cold start: rows dropped, no carry-over).
Context: is_home, team_rest, team_b2b, opp_rest, opp_b2b (days since previous game from game_meta incl. the Cup final; rest capped at 5; b2b = 0 days).

Usage: .venv/bin/python scripts/matchups.py [--through 2026-11-09] [--jobs 7] [--only pooled_2023_26:all]
"""
from __future__ import annotations
import argparse, json, math, multiprocessing as mp, sys, time, warnings
from pathlib import Path
import duckdb
import numpy as np
import pandas as pd
from scipy import stats

sys.path.insert(0, str(Path(__file__).resolve().parent))
import analysis_home_away_b2b as hab
import points_drivers as P

ROOT = Path(__file__).resolve().parents[1]
D = ROOT / "data"
BOX, META = D / "curated" / "player_game_box.parquet", D / "curated" / "game_meta.parquet"
OUT = {"matchups": D / "marts" / "matchups.parquet", "splits": D / "marts" / "matchup_player_splits.parquet",
       "opp": D / "marts" / "matchup_opponent_features.parquet", "manifest": D / "manifests" / "matchups.json"}
MIN_OPP_PRIOR = 5
REST_CAP = 5
OPP_CORE = ["opp_drtg", "opp_pace", "opp_pts_allowed", "opp_pts_pos"]
CONTEXT = ["is_home", "team_rest", "team_b2b", "opp_rest", "opp_b2b"]
OPP_LABEL = {"opp_drtg": "opponent DRtg", "opp_pace": "opponent pace", "opp_pts_allowed": "opponent points allowed", "opp_pts_pos": "opponent pts allowed to position (per 36)",
             "is_home": "home", "team_rest": "own rest days", "team_b2b": "own back-to-back", "opp_rest": "opponent rest days", "opp_b2b": "opponent back-to-back"}
# VIF drop priority (high -> low): box variables as in points_drivers, opponent / context features slotted before eFG%, def/off rating, PIE
PRIORITY = ["pts", "min", "fga", "fta", "fg3a", "ts_pct", "usg_pct", "pace", "ast_pct", "oreb_pct", "dreb_pct", "tov_pct",
            "is_home", "opp_drtg", "opp_pts_pos", "opp_pace", "team_rest", "opp_rest", "team_b2b", "opp_b2b", "opp_pts_allowed",
            "efg_pct", "def_rating", "off_rating", "pie", "net_rating"]
P.PRIORITY = PRIORITY
TERCILE = {0: "strong", 1: "mid", 2: "weak"}     # strong defense = lowest pregame DRtg tercile among the teams with >= 5 games on that date
Z_WATCH, Q_STRONG = 2.5, 0.10
MIN_SIDE = 5; MIN_SIDE_2026 = 3


# ---------------------------------------------------------------- team features
def team_tables(through: str):
    meta = duckdb.sql(f"select season, game_id, game_date, home_team_id, away_team_id from '{META}' where game_date <= date '{through}'").df()
    meta["game_date"] = pd.to_datetime(meta["game_date"])
    tg_all = pd.concat([meta[["season", "game_id", "game_date", "home_team_id", "away_team_id"]].rename(columns={"home_team_id": "team_id", "away_team_id": "opp_team_id"}).assign(is_home=1),
                        meta[["season", "game_id", "game_date", "away_team_id", "home_team_id"]].rename(columns={"away_team_id": "team_id", "home_team_id": "opp_team_id"}).assign(is_home=0)])
    tg_all = tg_all.sort_values(["team_id", "game_date", "game_id"]).reset_index(drop=True)
    prev = tg_all.groupby(["team_id", "season"])["game_date"].shift(1)
    tg_all["rest_days"] = (tg_all["game_date"] - prev).dt.days - 1          # 0 = back-to-back; NaN for the team's first game of the season
    box = duckdb.sql(f"""select season, game_id, team_id, player_id, status, min, pts, fga, fta, oreb, tov
                         from '{BOX}' where status in ('played','sub_minute') and substr(game_id,1,3)='002' and game_date <= date '{through}'""").df()
    t = box.groupby(["season", "game_id", "team_id"]).agg(pts=("pts", "sum"), fga=("fga", "sum"), fta=("fta", "sum"), oreb=("oreb", "sum"), tov=("tov", "sum"), mins=("min", "sum")).reset_index()
    t["poss_est"] = t.fga + 0.44 * t.fta - t.oreb + t.tov
    t = t.merge(tg_all[["game_id", "team_id", "opp_team_id", "game_date", "is_home", "rest_days"]], on=["game_id", "team_id"], how="left")
    o = t[["game_id", "team_id", "pts", "poss_est"]].rename(columns={"team_id": "opp_team_id", "pts": "opp_pts", "poss_est": "opp_poss_est"})
    t = t.merge(o, on=["game_id", "opp_team_id"], how="left")
    assert t.opp_pts.notna().all() and (t.groupby("game_id").size() == 2).all()
    t["poss"] = 0.5 * (t.poss_est + t.opp_poss_est)
    t["game_min"] = t.mins / 5.0
    return t, tg_all, box


def pos_allowed(box: pd.DataFrame, t: pd.DataFrame, pos_map: dict) -> pd.DataFrame:
    """Per (game, DEFENDING team, position group): points and minutes of the attacking team's players of that group."""
    b = box[box.status == "played"].copy()
    b["pos"] = [pos_map.get((s, p)) for s, p in zip(b.season, b.player_id)]
    b = b.merge(t[["game_id", "team_id", "opp_team_id"]], on=["game_id", "team_id"], how="left")
    a = b.groupby(["game_id", "opp_team_id", "pos"]).agg(pts=("pts", "sum"), mins=("min", "sum")).reset_index().rename(columns={"opp_team_id": "def_team_id"})
    return a


def add_team_rolling(t: pd.DataFrame, pa: pd.DataFrame) -> pd.DataFrame:
    t = t.sort_values(["team_id", "game_date", "game_id"]).reset_index(drop=True)
    n = len(t); i = np.arange(n)
    sstart = i - t.groupby(["team_id", "season"]).cumcount().to_numpy()
    los = {"l10": np.maximum(sstart, i - 10), "std": sstart}
    piv = pa.pivot_table(index=["game_id", "def_team_id"], columns="pos", values=["pts", "mins"], aggfunc="sum", fill_value=0.0)
    piv.columns = [f"{a}_{b}" for a, b in piv.columns]
    piv = piv.reset_index().rename(columns={"def_team_id": "team_id"})
    t = t.merge(piv, on=["game_id", "team_id"], how="left").fillna({c: 0.0 for c in piv.columns if c not in ("game_id", "team_id")})
    t["n_prior"] = i - sstart
    new = {}
    a = {c: t[c].to_numpy(float) for c in ["opp_pts", "poss", "game_min"] + [c for c in piv.columns if c.startswith(("pts_", "mins_"))]}
    for w, lo in los.items():
        cnt = (i - lo).astype(float)
        with np.errstate(divide="ignore", invalid="ignore"):
            sp, sq, sm = P._prior_sum(a["opp_pts"], lo), P._prior_sum(a["poss"], lo), P._prior_sum(a["game_min"], lo)
            new[f"opp_drtg__{w}"] = 100.0 * sp / sq
            new[f"opp_pace__{w}"] = 48.0 * sq / sm
            new[f"opp_pts_allowed__{w}"] = sp / cnt
            for pg in ("G", "F", "C"):
                new[f"opp_pts_pos_{pg}__{w}"] = 36.0 * P._prior_sum(a[f"pts_{pg}"], lo) / P._prior_sum(a[f"mins_{pg}"], lo)
    t = pd.concat([t, pd.DataFrame(new, index=t.index)], axis=1)
    # cumulative DRtg INCLUDING the game, for the as-of league ranking used by the opponent-strength terciles
    cs_p = t.groupby(["team_id", "season"])["opp_pts"].cumsum(); cs_q = t.groupby(["team_id", "season"])["poss"].cumsum()
    t["cum_drtg_after"] = 100.0 * cs_p / cs_q
    t["cum_n_after"] = t.groupby(["team_id", "season"]).cumcount() + 1
    return t


def add_asof_ranks(t: pd.DataFrame) -> pd.DataFrame:
    """For every team-game: the team's pregame season-to-date DRtg rank among all teams with >= MIN_OPP_PRIOR prior games strictly before that date -> tercile."""
    out = []
    for s, ts in t.groupby("season"):
        dates = np.sort(ts.game_date.unique())
        cum = ts[["team_id", "game_date", "cum_drtg_after", "cum_n_after"]].sort_values("game_date")
        cols = {}
        for tid, c in cum.groupby("team_id"):
            m = pd.merge_asof(pd.DataFrame({"game_date": dates}), c.sort_values("game_date"), on="game_date", direction="backward", allow_exact_matches=False)
            cols[tid] = m[["cum_drtg_after", "cum_n_after"]].to_numpy()
        tids = list(cols)
        V = np.stack([cols[k][:, 0] for k in tids], axis=1); N = np.stack([cols[k][:, 1] for k in tids], axis=1)
        V = np.where(N >= MIN_OPP_PRIOR, V, np.nan)
        rank = np.full(V.shape, np.nan); nteams = np.sum(~np.isnan(V), axis=1)
        for r in range(V.shape[0]):
            ok = ~np.isnan(V[r])
            if ok.sum() >= 6:
                rank[r, ok] = stats.rankdata(V[r, ok], method="min")
        di = {pd.Timestamp(d): k for k, d in enumerate(dates)}; ti = {k: j for j, k in enumerate(tids)}
        rk = np.array([rank[di[d], ti[tm]] for d, tm in zip(ts.game_date, ts.team_id)])
        nt = np.array([nteams[di[d]] for d in ts.game_date])
        tr = np.where(np.isnan(rk), np.nan, np.minimum(2, np.floor(3.0 * (rk - 1) / nt)))
        out.append(pd.DataFrame({"game_id": ts.game_id.to_numpy(), "team_id": ts.team_id.to_numpy(), "drtg_rank_asof": rk, "n_teams_ranked": nt, "drtg_tercile_code": tr}))
    r = pd.concat(out)
    return t.merge(r, on=["game_id", "team_id"], how="left")


def opponent_features_table(t: pd.DataFrame) -> pd.DataFrame:
    keep = ["season", "game_id", "game_date", "team_id", "opp_team_id", "is_home", "rest_days", "n_prior"] + [c for c in t.columns if "__" in c] + \
           ["drtg_rank_asof", "n_teams_ranked", "drtg_tercile_code"]
    o = t[keep].copy()
    o["b2b"] = np.where(o.rest_days.isna(), np.nan, (o.rest_days == 0).astype(float))
    o["drtg_tercile"] = o.drtg_tercile_code.map(TERCILE)
    o = o.rename(columns={"team_id": "defending_team_id", "opp_team_id": "attacking_team_id", "is_home": "defending_is_home", "n_prior": "n_prior_games_season"})
    o["usable_for_models"] = o.n_prior_games_season >= MIN_OPP_PRIOR
    # features are NULL (not zero) when fewer than MIN_OPP_PRIOR prior games exist (cold start)
    fcols = [c for c in o.columns if "__" in c] + ["drtg_rank_asof", "drtg_tercile_code"]
    o.loc[~o.usable_for_models, fcols] = np.nan
    o["drtg_tercile"] = o.drtg_tercile_code.map(TERCILE)
    return o.drop(columns=["drtg_tercile_code"]).sort_values(["season", "game_date", "game_id", "defending_team_id"]).reset_index(drop=True)


def build_matchup_rows(W: pd.DataFrame, t: pd.DataFrame, pos_map: dict) -> tuple[pd.DataFrame, dict]:
    """Attach opponent + context features to the pregame-eligible player rows (W from points_drivers.add_pregame_features)."""
    T = t.set_index(["game_id", "team_id"])
    own = T.loc[list(zip(W.game_id, W.team_id))]
    W = W.copy()
    W["opp_team_id"] = own.opp_team_id.to_numpy(); W["is_home"] = own.is_home.to_numpy().astype(float)
    W["team_rest"] = own.rest_days.to_numpy()
    opp = T.loc[list(zip(W.game_id, W.opp_team_id))]
    W["opp_rest"] = opp.rest_days.to_numpy(); W["opp_n_prior"] = opp.n_prior.to_numpy()
    W["pos"] = [pos_map.get((s, p)) for s, p in zip(W.season, W.player_id)]
    for w in ("l10", "std"):
        for b in ("opp_drtg", "opp_pace", "opp_pts_allowed"):
            W[f"{b}__{w}"] = opp[f"{b}__{w}"].to_numpy()
        pv = np.stack([opp[f"opp_pts_pos_{g}__{w}"].to_numpy() for g in ("G", "F", "C")], axis=1)
        W[f"opp_pts_pos__{w}"] = [pv[k, "GFC".index(p)] if p in ("G", "F", "C") else np.nan for k, p in enumerate(W.pos)]
    W["drtg_tercile_code"] = opp.drtg_tercile_code.to_numpy() if "drtg_tercile_code" in opp else np.nan
    for c in ("team_rest", "opp_rest"):
        W[c] = W[c].clip(upper=REST_CAP)
    W["team_b2b"] = (W.team_rest == 0).astype(float).where(W.team_rest.notna()); W["opp_b2b"] = (W.opp_rest == 0).astype(float).where(W.opp_rest.notna())
    n0 = len(W)
    cold = int((W.opp_n_prior < MIN_OPP_PRIOR).sum())
    feat = [c for c in W.columns if c.startswith("opp_") and "__" in c] + CONTEXT
    bad = W[feat].isna().any(axis=1) | ~np.isfinite(W[feat].astype(float)).all(axis=1) | (W.opp_n_prior < MIN_OPP_PRIOR)
    info = {"eligible_pregame_rows": n0, "dropped_opp_cold_start_lt5_prior": cold, "dropped_any_null_feature_total": int(bad.sum()),
            "dropped_by_season": W[bad].groupby("season").size().to_dict(), "kept_rows": int((~bad).sum()), "kept_by_season": W[~bad].groupby("season").size().to_dict()}
    return W[~bad].reset_index(drop=True), info


# ---------------------------------------------------------------- model cells
G_ALL = None; W_M = None; FLOORS = None; CUTS = None


def colmaps():
    box = {b: f"{b}__l10" for b in P.BASE}
    ctx = {c: c for c in CONTEXT}
    return {"l10": box,
            "l10+opp": {**box, **{o: f"{o}__l10" for o in OPP_CORE}, **ctx},
            "l10+opp_std": {**box, **{o: f"{o}__std" for o in OPP_CORE}, **ctx}}


def run_cell(task):
    ts, seg = task
    t0 = time.time(); warnings.filterwarnings("ignore")
    spec = hab.TIMESPANS[ts]; w = W_M[W_M.season.isin(spec["seasons"])]; cut = CUTS[ts]
    g = G_ALL[G_ALL.season.isin(spec["seasons"])]
    share = len(g[g.game_date < cut]) / len(g)
    floor_tr = None if FLOORS[ts] is None else max(1, int(math.ceil(FLOORS[ts] * share)))
    mem = hab.segment_members(hab.rank_table(G_ALL[G_ALL.game_date < cut], ts, floor_tr))[seg]    # train-only membership (no look-ahead), as in points_drivers
    sub = w[w.player_id.isin(mem)]
    tr, te = sub[sub.game_date < cut], sub[sub.game_date >= cut]
    n_games, n_players = int(len(sub)), int(sub.player_id.nunique())
    thin = bool(n_players < P.THIN_PLAYERS or n_games < P.THIN_GAMES)
    out_rows, logs, lifts = [], [], []
    cms = colmaps()
    ok = len(tr) >= max(60, 6 * len(cms["l10+opp"])) and tr.player_id.nunique() >= 8 and len(te) >= 10
    if not ok:
        out_rows.append(dict(lens="pregame", segment=seg, timespan=ts, model="none", driver=None, coef_std=None, ci_low=None, ci_high=None, rank_in_cell=None, kept_after_vif=None,
                             shap_mean_abs=None, test_r2=None, test_mae=None, test_rmse=None, baseline_mae=None, n_games=n_games, n_players=n_players, thin_flag=True,
                             notes=f"not fitted: too few rows (train={len(tr)}, test={len(te)}, train players={tr.player_id.nunique()}); cutoff {cut.date()}"))
        return ts, seg, out_rows, [dict(ts=ts, seg=seg, fitted=False, n_games=n_games, n_players=n_players)], [], time.time() - t0
    res = {}
    for win, cmap in cms.items():
        rows, lg = P.fit_spec(tr, te, cmap, "pregame", win, {}, keep_preds=True)
        res[win] = (rows, lg)
    # lift of the opponent specs over the box-only reference (same rows) and over the prior-average baseline
    yt = te["pts"].to_numpy(float); pl = te["player_id"].to_numpy(); bsl = te["pts__std"].to_numpy(float)
    for ow in ("l10+opp", "l10+opp_std"):
        for m in ("ols_cluster", "enet", "mixedlm", "gbm_shap"):
            pb, po = res["l10"][1]["_preds"].get(m), res[ow][1]["_preds"].get(m)
            if pb is None or po is None:
                continue
            ab, ao = np.abs(yt - pb), np.abs(yt - po)
            gain, lo, hi = P.cluster_gain(ab, ao, pl)
            sb, so = P.score(yt, pb), P.score(yt, po)
            gb_, go_, gbl = lo, hi, None
            _, blo, bhi = P.cluster_gain(np.abs(yt - bsl), ao, pl)
            lifts.append(dict(ts=ts, seg=seg, spec=ow, model=m, thin=thin, n_games=n_games, n_players=n_players, mae_box=sb["mae"], mae_opp=so["mae"], mae_gain=gain, mae_gain_ci=[lo, hi],
                              r2_box=sb["r2"], r2_opp=so["r2"], rmse_box=sb["rmse"], rmse_opp=so["rmse"], mae_base=float(np.abs(yt - bsl).mean()),
                              mae_gain_vs_base=float(np.abs(yt - bsl).mean() - ao.mean()), mae_gain_vs_base_ci=[blo, bhi]))
            txt = (f"; lift vs box-only @l10 (same rows): MAE {gain:+.3f} pts, player-cluster bootstrap 95% CI [{lo:+.3f}, {hi:+.3f}] (positive = opponent features help); "
                   f"R2 {sb['r2']:.4f} -> {so['r2']:.4f}; RMSE {sb['rmse']:.3f} -> {so['rmse']:.3f}")
            for r in res[ow][0]:
                if r["model"].split("@")[0] == m:
                    r["notes"] += txt
    for win, (rows, lg) in res.items():
        lg.pop("_preds", None)
        lg.update(ts=ts, seg=seg, fitted=True, n_games=n_games, n_players=n_players, thin=thin, cutoff=str(cut.date()), spec=win)
        logs.append(lg)
        for r in rows:
            if thin:
                r["rank_in_cell"] = None
            r.update(lens="pregame", segment=seg, timespan=ts, n_games=n_games, n_players=n_players, thin_flag=thin)
            r["notes"] = f"train/test rows={len(tr)}/{len(te)}, test = game dates >= {cut.date()}; " + r["notes"] + ("; THIN cell: drivers not ranked" if thin else "")
            out_rows.append(r)
    return ts, seg, out_rows, logs, lifts, time.time() - t0


# ---------------------------------------------------------------- per-player opponent splits
def dl_tau2(d, se):
    m = se > 0; d, w = d[m], 1.0 / se[m] ** 2; k = len(d)
    if k < 2: return 0.0
    mu = (w * d).sum() / w.sum(); q = (w * (d - mu) ** 2).sum()
    return float(max(0.0, (q - (k - 1)) / (w.sum() - (w ** 2).sum() / w.sum())))


def bh(p):
    out = np.full(len(p), np.nan); m = ~np.isnan(p); pv = p[m]; n = len(pv)
    if n == 0: return out
    o = np.argsort(pv, kind="mergesort"); qv = np.minimum.accumulate((pv[o] * n / np.arange(1, n + 1))[::-1])[::-1]
    r = np.empty(n); r[o] = np.minimum(qv, 1.0); out[m] = r
    return out


def player_splits(g: pd.DataFrame, t: pd.DataFrame, floors: dict, ranks: dict, members: dict, pos_map: dict) -> tuple[pd.DataFrame, dict]:
    """Points vs strong / mid / weak defenses. g = all minutes>0 regular-season player-games (the app's games). Raw = mean PTS vs weak - mean PTS vs strong
    (positive = scores more against weak defenses). SE uses the player's SD over ALL his games in the timespan (as in the home/away splits)."""
    tt = t[["game_id", "team_id", "drtg_tercile_code"]].rename(columns={"team_id": "opp_team_id"})
    own = t[["game_id", "team_id", "opp_team_id"]]
    x = g.merge(own, on=["game_id", "team_id"], how="left").merge(tt, on=["game_id", "opp_team_id"], how="left")
    x["tercile"] = x.drtg_tercile_code.map(TERCILE)
    rows, tinfo = [], {}
    for ts, spec in hab.TIMESPANS.items():
        xs = x[x.season.isin(spec["seasons"])]
        floor = floors[ts]; side_min = MIN_SIDE_2026 if ts == "2026_27" else MIN_SIDE
        rk = ranks[ts].set_index("player_id")
        part = []
        for pid, xp in xs.groupby("player_id"):
            gp = len(xp)
            if gp < floor:
                continue
            c = {k: xp[xp.tercile == k] for k in ("strong", "mid", "weak")}
            r = dict(timespan=ts, player_id=pid, player_name=xp.full_name.iloc[-1], position=pos_map.get((xp.season.iloc[-1], pid)), gp=gp, gp_with_tercile=int(xp.tercile.notna().sum()),
                     n_strong=len(c["strong"]), n_mid=len(c["mid"]), n_weak=len(c["weak"]),
                     ppg_strong=c["strong"].pts.mean() if len(c["strong"]) else np.nan, ppg_mid=c["mid"].pts.mean() if len(c["mid"]) else np.nan,
                     ppg_weak=c["weak"].pts.mean() if len(c["weak"]) else np.nan, ppg_all=xp.pts.mean(), ppg_rank=rk.loc[pid, "rank"] if pid in rk.index else np.nan)
            r["qualifies"] = bool(len(c["strong"]) >= side_min and len(c["weak"]) >= side_min and gp > 2)
            if r["qualifies"]:
                d = r["ppg_weak"] - r["ppg_strong"]
                sd = xp.pts.std(ddof=1); se = sd * math.sqrt(1 / len(c["weak"]) + 1 / len(c["strong"])); tq = stats.t.ppf(0.975, gp - 1)
                r.update(raw_diff=d, se=se, ci_low=d - tq * se, ci_high=d + tq * se)
            part.append(r)
        q = pd.DataFrame(part)
        qq = q[q.qualifies].copy()
        mu = qq.raw_diff.mean(); tau2 = dl_tau2(qq.raw_diff.to_numpy(), qq.se.to_numpy())
        w = np.where(qq.se > 0, tau2 / (tau2 + qq.se ** 2), 1.0)
        qq["shrunk_diff"] = mu + w * (qq.raw_diff - mu); qq["shrink_weight"] = w
        qq["z"] = (qq.raw_diff - mu) / qq.se; qq["p"] = 2 * stats.norm.sf(qq.z.abs()); qq["q"] = bh(qq.p.to_numpy())
        # shrunk interval: posterior-style, SE_shrunk = sqrt(w * se^2) around the shrunk value (normal-normal)
        sse = np.sqrt(w) * qq.se
        qq["shrunk_ci_low"] = qq.shrunk_diff - 1.96 * sse; qq["shrunk_ci_high"] = qq.shrunk_diff + 1.96 * sse
        lvl = np.where(qq.q < Q_STRONG, "strong", np.where(qq.z.abs() >= Z_WATCH, "watch", None))
        qq["flag"] = [None if l is None else f"{'weak_better' if d > mu else 'weak_worse'}_{l}" for l, d in zip(lvl, qq.raw_diff)]
        q = q.merge(qq[["player_id", "shrunk_diff", "shrink_weight", "shrunk_ci_low", "shrunk_ci_high", "z", "p", "q", "flag"]], on="player_id", how="left")
        q["league_mean_diff"] = mu if len(qq) else np.nan; q["tau"] = math.sqrt(tau2) if len(qq) else np.nan
        for sid, mm in members[ts].items():
            q[f"in_{sid}"] = q.player_id.isin(mm)
        q["provisional"] = ts == "2026_27"; q["min_games_floor"] = floor; q["min_side_games"] = side_min
        rows.append(q)
        tinfo[ts] = {"floor": floor, "min_side": side_min, "players_with_floor": int(len(q)), "players_qualify": int(len(qq)), "league_mean_diff_weak_minus_strong": float(mu) if len(qq) else None,
                     "tau": float(math.sqrt(tau2)) if len(qq) else None, "n_flag_strong": int((qq.flag.fillna("").str.endswith("strong")).sum()), "n_flag_watch": int((qq.flag.fillna("").str.endswith("watch")).sum()),
                     "expected_watch_by_chance": float(len(qq) * 2 * stats.norm.sf(Z_WATCH)),
                     "games_with_tercile_share": float(xs.tercile.notna().mean())}
    R = pd.concat(rows, ignore_index=True)
    return R, tinfo


def main():
    global G_ALL, W_M, FLOORS, CUTS
    ap = argparse.ArgumentParser(); ap.add_argument("--through", default="2026-11-09"); ap.add_argument("--jobs", type=int, default=7); ap.add_argument("--only", default=None)
    args = ap.parse_args()
    G_ALL = hab.load_games(args.through); G_ALL["game_date"] = pd.to_datetime(G_ALL["game_date"])
    FLOORS = hab.timespan_floors(G_ALL, None)
    ps, _ = hab.segments(G_ALL)
    pos_map = {(r.season, r.player_id): r.position for r in ps.itertuples()}
    t, tg_all, box = team_tables(args.through)
    pa = pos_allowed(box, t, pos_map)
    t = add_team_rolling(t, pa)
    t = add_asof_ranks(t)
    raw = P.load_rows(args.through)
    W = P.add_pregame_features(raw)
    # same date cut-offs as points_drivers (computed on the box-only eligible rows)
    CUTS = {}
    for ts, spec in hab.TIMESPANS.items():
        ds = np.sort(W[W.season.isin(spec["seasons"])].game_date.unique()); nt = max(1, int(round(P.TEST_FRAC * len(ds)))); CUTS[ts] = pd.Timestamp(ds[len(ds) - nt])
    W_M, info = build_matchup_rows(W, t, pos_map)
    print("matchup rows:", info, flush=True)
    # ---- checks
    chk = {}
    tf = opponent_features_table(t)
    pace_game = (48 * t.poss / t.game_min)
    chk["team_pace_game_mean"] = float(pace_game.mean()); chk["team_drtg_game_mean"] = float((100 * t.opp_pts / t.poss).mean()); chk["team_pts_mean"] = float(t.pts.mean())
    a = duckdb.sql(f"select b.season, b.game_id, b.team_id, sum(a.pace*a.min)/sum(a.min) ap from '{BOX}' b join '{D/'curated'/'player_game_box_advanced.parquet'}' a using (game_id, player_id) where b.status='played' and substr(b.game_id,1,3)='002' and b.game_date <= date '{args.through}' group by all").df()
    mm = t.merge(a, on=["game_id", "team_id"]); mm["tp"] = 48 * mm.poss / mm.game_min
    chk["team_pace_vs_minute_weighted_player_pace"] = {"corr": float(np.corrcoef(mm.tp, mm.ap)[0, 1]), "mean_diff": float((mm.tp - mm.ap).mean()), "mean_abs_diff": float((mm.tp - mm.ap).abs().mean())}
    print("checks:", chk, flush=True)
    tasks = [(ts, sid) for ts in ["pooled_2023_27", "pooled_2023_26", "2025_26", "2024_25", "2023_24", "2026_27"] for sid in hab.SEGMENT_IDS]
    if args.only:
        a_, b_ = args.only.split(":"); tasks = [(a_, b_)]
    results = []
    with mp.get_context("fork").Pool(min(args.jobs, len(tasks))) as pool:
        for r in pool.imap_unordered(run_cell, tasks):
            print(f"cell {r[0]} x {r[1]} done in {r[5]:.0f}s ({len(r[2])} rows)", flush=True); results.append(r)
    results.sort(key=lambda r: (list(hab.TIMESPANS).index(r[0]), hab.SEGMENT_IDS.index(r[1])))
    rows = [x for r in results for x in r[2]]; logs = [x for r in results for x in r[3]]; lifts = [x for r in results for x in r[4]]
    df = pd.DataFrame(rows)[P.COLS]
    for c in ["coef_std", "ci_low", "ci_high", "shap_mean_abs", "test_r2", "test_mae", "test_rmse", "baseline_mae"]:
        df[c] = pd.to_numeric(df[c], errors="coerce").replace([np.inf, -np.inf], np.nan)
    df["rank_in_cell"] = df["rank_in_cell"].astype("Int64"); df["kept_after_vif"] = df["kept_after_vif"].astype("boolean"); df["thin_flag"] = df["thin_flag"].astype(bool)
    df["n_games"] = df["n_games"].astype("Int64"); df["n_players"] = df["n_players"].astype("Int64")
    if args.only:
        print(df.groupby("model").first()[["test_r2", "test_mae", "baseline_mae"]]); json.dump(lifts, open("/tmp/mu_lifts.json", "w"), indent=1, default=str); json.dump(logs, open("/tmp/mu_logs.json", "w"), indent=1, default=str); return
    order = {k: i for i, k in enumerate(list(hab.TIMESPANS) + hab.SEGMENT_IDS)}
    df = df.sort_values(["timespan", "segment", "model", "rank_in_cell", "driver"], key=lambda s: s.map(order) if s.name in ("timespan", "segment") else s, na_position="last", kind="stable").reset_index(drop=True)
    # per-player splits
    g = G_ALL.sort_values(["player_id", "game_date", "game_id"]).reset_index(drop=True)
    ranks = {ts: hab.rank_table(g, ts, FLOORS[ts]) for ts in hab.TIMESPANS}
    members = {ts: hab.segment_members(ranks[ts]) for ts in hab.TIMESPANS}
    S, sinfo = player_splits(g, t, FLOORS, ranks, members, pos_map)
    for pth in OUT.values():
        pth.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(OUT["matchups"], index=False)
    S = S.astype({c: "float64" for c in S.columns if S[c].dtype.kind == "f"}); S.replace([np.inf, -np.inf], np.nan).to_parquet(OUT["splits"], index=False)
    tf.replace([np.inf, -np.inf], np.nan).to_parquet(OUT["opp"], index=False)
    con = duckdb.connect(str(D / "marts" / "nba_phase1.duckdb"))
    for v, k in (("matchups", "matchups"), ("matchup_player_splits", "splits"), ("matchup_opponent_features", "opp")):
        con.execute(f"CREATE OR REPLACE VIEW {v} AS SELECT * FROM read_parquet('{OUT[k].resolve()}')")
    con.close()
    manifest = dict(script="scripts/matchups.py", through=args.through, checks=chk, matchup_rows=info, min_opp_prior=MIN_OPP_PRIOR, rest_cap=REST_CAP, floors=FLOORS,
                    date_cuts={k: str(v.date()) for k, v in CUTS.items()}, lifts=lifts, cells=logs, splits=sinfo, n_rows=int(len(df)),
                    tables={k: {"path": str(v.relative_to(ROOT)), "sha256": P.sha(v)} for k, v in OUT.items() if k != "manifest" and v.exists()})
    json.dump(manifest, open(OUT["manifest"], "w"), indent=1, default=str)
    print("wrote", {k: str(v) for k, v in OUT.items()}, len(df), "model rows;", len(S), "split rows")


if __name__ == "__main__":
    main()
