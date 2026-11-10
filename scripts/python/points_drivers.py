"""Points-driver analysis for hoopstats (2026-11-10): which variables are associated with / predict player points (PTS per game).

Follows the playbook section "Points-driver analysis (hoopstats)" step by step:
  1 stack check (free Python only: statsmodels, scikit-learn, shap, lightgbm, pandas/duckdb)
  2 Pearson + Spearman screen (screening only)      3 VIF + correlation check, logged drops, standardise
  4 OLS with player-clustered robust SEs, 95% CI    5 elastic net, time-ordered CV, which drivers survive
  6 MixedLM, player random intercept, 95% CI        7 gradient boosting + SHAP, kept only if it clearly beats the best linear model

Two lenses:
  explanatory  same-game box stats (describes how points are produced; NOT pregame predictors)
  pregame      every input is a strictly prior rolling value (last 5 / last 10 / season-to-date BEFORE the game; the game itself excluded)
Cells: nested PPG segments (all/top100/top50/top25/top10) x 6 timespans, reusing scripts/analysis_home_away_b2b.py for the ranks.
Split: by DATE per timespan (train = earlier 80% of game dates, test = last 20%), CV inside train is time-ordered (expanding date chunks).
Baseline (both lenses): the player's prior season-to-date average PTS (leakage-free), scored on the same test rows.
Deterministic: fixed seeds, no run timestamps in the table.

Usage: .venv/bin/python scripts/points_drivers.py [--through 2026-11-09] [--jobs 6] [--only pooled_2023_26:all]
"""
from __future__ import annotations
import argparse, hashlib, json, math, multiprocessing as mp, sys, time, warnings
from pathlib import Path
import duckdb
import numpy as np
import pandas as pd
from scipy import stats

sys.path.insert(0, str(Path(__file__).resolve().parent))
import analysis_home_away_b2b as hab           # segment / timespan / floor logic (identical to the home-away rerun)

ROOT = Path(__file__).resolve().parents[1]
D = ROOT / "data"
BOX, ADV = D / "curated" / "player_game_box.parquet", D / "curated" / "player_game_box_advanced.parquet"
OUT_PARQUET = D / "marts" / "points_drivers.parquet"
OUT_MANIFEST = D / "manifests" / "points_drivers.json"
SEED = 20261110
TEST_FRAC = 0.20
MIN_MIN = 5.0                  # modelling rows: >= 5 minutes (advanced rates are unreliable below that; see warehouse-box-scores.md)
PRIOR_ALL, PRIOR_SEASON = 5, 3  # eligible rows: >= 5 prior games overall and >= 3 prior games this season (same rows for both lenses)
WINDOWS = ["l5", "l10", "std"]
VIF_MAX = 10.0
THIN_PLAYERS, THIN_GAMES = 30, 300
GBM_MIN_GAIN, GBM_BOOT = 0.02, 1000

# ---------------------------------------------------------------- candidate drivers
# base name -> (source description, kind) ; kind decides how the prior rolling version is computed (from TOTALS, never an unweighted mean of rates)
BASE = ["min", "fga", "fta", "fg3a", "usg_pct", "ts_pct", "efg_pct", "pace", "ast_pct", "oreb_pct", "dreb_pct", "tov_pct",
        "def_rating", "off_rating", "net_rating", "pie"]
MIN_WEIGHTED = ["usg_pct", "pace", "ast_pct", "oreb_pct", "dreb_pct", "tov_pct", "pie"]   # window value = sum(rate*min)/sum(min)
POSS_WEIGHTED = ["off_rating", "def_rating"]                                              # window value = sum(rating*poss)/sum(poss)
# priority when VIF > 10: the lower-priority (more derived / composite) variable of the offending set is dropped first
PRIORITY = ["pts", "min", "fga", "fta", "fg3a", "ts_pct", "usg_pct", "pace", "ast_pct", "oreb_pct", "dreb_pct", "tov_pct",
            "efg_pct", "def_rating", "off_rating", "pie", "net_rating"]
DEFN_DROP = {"net_rating": "= off_rating - def_rating exactly (perfect collinearity); keep the two components"}
MECH_DROP_EXPL = {"pie": "same-game PIE contains the player's own PTS by construction (leakage of the target); screen only"}
LABEL = {"min": "minutes", "fga": "FGA", "fta": "FTA", "fg3a": "3PA", "usg_pct": "USG%", "ts_pct": "TS%", "efg_pct": "eFG%", "pace": "pace",
         "ast_pct": "AST%", "oreb_pct": "OREB%", "dreb_pct": "DREB%", "tov_pct": "TOV%", "def_rating": "def rating", "off_rating": "off rating",
         "net_rating": "net rating", "pie": "PIE", "pts": "PTS (prior average)"}
# advanced columns present in the warehouse that are NOT separate candidates, and why
ADV_DISPOSITION = {
    "e_off_rating": "duplicate of off_rating (NBA estimated variant)", "e_def_rating": "duplicate of def_rating (estimated variant)",
    "e_net_rating": "duplicate of net_rating (estimated variant)", "sp_work_off_rating": "duplicate of off_rating (tracking 'work' variant)",
    "sp_work_def_rating": "duplicate of def_rating (tracking variant)", "sp_work_net_rating": "duplicate of net_rating (tracking variant)",
    "e_usg_pct": "duplicate of usg_pct (estimated variant)", "e_tov_pct": "duplicate of tov_pct (estimated variant)",
    "e_pace": "duplicate of pace (estimated variant)", "sp_work_pace": "duplicate of pace (tracking variant)",
    "pace_per40": "pace rescaled to 40 min (same information as pace)", "possessions": "~ minutes x pace / 48 (near-duplicate of min and pace); used only as a weight",
    "reb_pct": "combination of oreb_pct and dreb_pct", "ast_ratio": "near-duplicate of ast_pct (both per-possession assist rates)",
    "ast_to": "unusable as returned: source gives 0 for undefined (0 turnovers) in 18,770 rows",
}
NOT_AVAILABLE = ["opponent / defender matchup features", "game total / spread / betting lines", "injury, lineup and teammate-out context",
                 "shot-location / tracking / play-type data (touches, drives, shot quality)", "team pace or opponent pace as a pregame input (only player-on-floor pace exists)",
                 "starter status as a pregame input (lineups are not known when props are bet; `started` exists but is same-game)"]


# ---------------------------------------------------------------- data
def load_rows(through: str) -> pd.DataFrame:
    adv_cols = ", ".join(f"a.{c} as {c}" for c in ["usg_pct", "ts_pct", "efg_pct", "pace", "pie", "off_rating", "def_rating", "net_rating",
                                                  "ast_pct", "oreb_pct", "dreb_pct", "tov_pct", "possessions"])
    q = f"""select b.season, b.game_id, b.game_date, b.player_id, b.team_id, b.min, b.fgm, b.fga, b.fg3m, b.fg3a, b.ftm, b.fta, b.pts, {adv_cols}
            from '{BOX}' b join '{ADV}' a using (game_id, player_id)
            where b.status = 'played' and substr(b.game_id,1,3) = '002' and b.min >= {MIN_MIN} and b.game_date <= date '{through}'"""
    df = duckdb.sql(q).df()
    df["game_date"] = pd.to_datetime(df["game_date"])
    assert not df.duplicated(["player_id", "game_id"]).any()
    num = [c for c in df.columns if c not in ("season", "game_id", "game_date", "player_id", "team_id")]
    assert not df[num].isna().any().any(), "unexpected nulls in modelling columns"
    return df.sort_values(["player_id", "game_date", "game_id"]).reset_index(drop=True)


def coverage_report(through: str) -> dict:
    q = f"""select b.season, count(*) played_002, sum((a.game_id is not null)::int) with_advanced, sum((b.min >= {MIN_MIN})::int) min_ge5,
                   count(distinct b.game_id) games, sum((a.game_id is null)::int) missing_adv
            from '{BOX}' b left join '{ADV}' a using (game_id, player_id)
            where b.status = 'played' and substr(b.game_id,1,3) = '002' and b.game_date <= date '{through}' group by 1 order by 1"""
    return duckdb.sql(q).df().to_dict(orient="records")


def _prior_sum(x: np.ndarray, lo: np.ndarray) -> np.ndarray:
    E = np.concatenate([[0.0], np.cumsum(x, dtype=float)])
    i = np.arange(len(x))
    return E[i] - E[lo]            # sum of x[lo:i]  (rows strictly before i; the game itself is excluded)


def add_pregame_features(df: pd.DataFrame) -> pd.DataFrame:
    """Strictly prior rolling inputs per player, chronological across seasons: l5, l10 (<= last 10 prior games) and std (this season's prior games).
    Counts are plain per-game means; rates are built from totals (TS, eFG) or minute-/possession-weighted pooling (usg, pace, ratings, ...)."""
    n = len(df); i = np.arange(n)
    start = i - df.groupby("player_id").cumcount().to_numpy()
    sstart = i - df.groupby(["player_id", "season"]).cumcount().to_numpy()
    los = {"l5": np.maximum(start, i - 5), "l10": np.maximum(start, i - 10), "std": sstart}
    df = df.copy()
    df["n_prior_all"], df["n_prior_season"] = i - start, i - sstart
    a = {c: df[c].to_numpy(dtype=float) for c in df.columns if df[c].dtype.kind in "fi"}
    new = {}
    for w, lo in los.items():
        cnt = (i - lo).astype(float)
        with np.errstate(divide="ignore", invalid="ignore"):
            S = {c: _prior_sum(a[c], lo) for c in ["pts", "min", "fga", "fta", "fg3a", "fgm", "fg3m", "ftm", "possessions"]}
            for c in ["pts", "min", "fga", "fta", "fg3a"]:
                new[f"{c}__{w}"] = S[c] / cnt
            new[f"ts_pct__{w}"] = S["pts"] / (2.0 * (S["fga"] + 0.44 * S["fta"]))
            new[f"efg_pct__{w}"] = (S["fgm"] + 0.5 * S["fg3m"]) / S["fga"]
            for c in MIN_WEIGHTED:
                new[f"{c}__{w}"] = _prior_sum(a[c] * a["min"], lo) / S["min"]
            for c in POSS_WEIGHTED:
                new[f"{c}__{w}"] = _prior_sum(a[c] * a["possessions"], lo) / S["possessions"]
            new[f"net_rating__{w}"] = new[f"off_rating__{w}"] - new[f"def_rating__{w}"]
    df = pd.concat([df, pd.DataFrame(new, index=df.index)], axis=1)
    df = df[(df.n_prior_all >= PRIOR_ALL) & (df.n_prior_season >= PRIOR_SEASON)].copy()
    feat = [c for c in df.columns if "__" in c]
    df = df[~df[feat].isna().any(axis=1) & np.isfinite(df[feat]).all(axis=1)].reset_index(drop=True)
    return df


# ---------------------------------------------------------------- modelling helpers
def fisher_ci(r: float, n: int, spearman=False):
    if n <= 4 or abs(r) >= 1:
        return None, None
    se = (1.06 if spearman else 1.0) / math.sqrt(n - 3)
    z = np.arctanh(r)
    return float(np.tanh(z - 1.96 * se)), float(np.tanh(z + 1.96 * se))


def vif_table(Z: np.ndarray) -> np.ndarray:
    c = np.corrcoef(Z, rowvar=False)
    if Z.shape[1] == 1:
        return np.array([1.0])
    try:
        return np.diag(np.linalg.inv(c))
    except np.linalg.LinAlgError:
        return np.full(Z.shape[1], np.inf)


def vif_prune(Z: pd.DataFrame, order: list[str]):
    """Iteratively: take the variable with the largest VIF (> VIF_MAX); among it and the variables it is strongly correlated with (|r| >= 0.6)
    drop the one lowest in PRIORITY (the more derived / composite one). Returns kept list, drop log, final vif dict."""
    cols, log = list(Z.columns), []
    while True:
        v = dict(zip(cols, vif_table(Z[cols].to_numpy())))
        worst = max(cols, key=lambda c: v[c])
        if v[worst] <= VIF_MAX or len(cols) <= 2:
            return cols, log, v
        cm = Z[cols].corr()
        cluster = [worst] + [c for c in cols if c != worst and abs(cm.loc[worst, c]) >= 0.6]
        drop = max(cluster, key=lambda c: order.index(c))
        log.append({"driver": drop, "vif": float(v[drop]), "trigger": worst, "trigger_vif": float(v[worst]), "vs": [c for c in cluster if c != drop]})
        cols.remove(drop)


def time_folds(dates: np.ndarray, n_chunks: int = 5):
    """Expanding time-ordered folds on date chunks inside train. Returns list of (train_idx, val_idx)."""
    ud = np.unique(dates)
    n_chunks = max(2, min(n_chunks, len(ud) // 2))
    bounds = np.array_split(ud, n_chunks)
    chunk = np.zeros(len(dates), dtype=int)
    for k, b in enumerate(bounds):
        chunk[np.isin(dates, b)] = k
    folds = []
    for k in range(1, n_chunks):
        tr, va = np.where(chunk < k)[0], np.where(chunk == k)[0]
        if len(tr) >= 30 and len(va) >= 10:
            folds.append((tr, va))
    return folds


def score(y, p):
    e = y - p
    sst = float(((y - y.mean()) ** 2).sum())
    return {"r2": float(1 - (e ** 2).sum() / sst) if sst > 0 else None, "mae": float(np.abs(e).mean()), "rmse": float(math.sqrt((e ** 2).mean()))}


def cluster_gain(abs_lin, abs_gbm, players, seed=SEED):
    """Paired player-cluster bootstrap of mean(|e_linear| - |e_gbm|); positive = boosting better."""
    uc, inv = np.unique(players, return_inverse=True)
    d = abs_lin - abs_gbm
    s = np.bincount(inv, weights=d, minlength=len(uc)); c = np.bincount(inv, minlength=len(uc))
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, len(uc), size=(GBM_BOOT, len(uc)))
    m = s[idx].sum(1) / c[idx].sum(1)
    return float(d.mean()), float(np.percentile(m, 2.5)), float(np.percentile(m, 97.5))


def fit_spec(tr: pd.DataFrame, te: pd.DataFrame, colmap: dict[str, str], lens: str, window: str | None, meta: dict, keep_preds: bool = False) -> tuple[list[dict], dict]:
    """colmap: base name -> dataframe column. Returns tidy rows (without cell keys filled) and a log dict for the manifest."""
    import statsmodels.api as sm
    from sklearn.linear_model import ElasticNetCV
    import lightgbm as lgb, shap
    tag = f"@{window}" if window else ""
    log = {"lens": lens, "window": window, "n_train": int(len(tr)), "n_test": int(len(te)), "drops": []}
    y, yt = tr["pts"].to_numpy(float), te["pts"].to_numpy(float)
    base_std, base_l10 = te["pts__std"].to_numpy(float), te["pts__l10"].to_numpy(float)
    sb = score(yt, base_std)
    base = {"baseline_mae": sb["mae"]}
    bnote = f"baseline_r2={sb['r2']:.4f}; baseline_rmse={sb['rmse']:.4f}; baseline_l10_mae={float(np.abs(yt - base_l10).mean()):.4f}" if sb["r2"] is not None else \
        f"baseline_rmse={sb['rmse']:.4f}"
    rows: list[dict] = []
    cand = list(colmap)   # every key of colmap is a candidate (BASE + pts for points_drivers; plus opponent/context features for matchups.py)
    # --- clip (winsorise train 0.5/99.5 pct) + standardise; constants dropped
    X = tr[[colmap[b] for b in cand]].copy(); X.columns = cand
    Xt = te[[colmap[b] for b in cand]].copy(); Xt.columns = cand
    lo, hi = X.quantile(0.005), X.quantile(0.995)
    Xc, Xtc = X.clip(lo, hi, axis=1), Xt.clip(lo, hi, axis=1)
    mu, sd = Xc.mean(), Xc.std(ddof=0)
    const = [c for c in cand if not sd[c] > 1e-12]
    for c in const:
        log["drops"].append({"driver": c, "reason": "constant in train"})
    cand = [c for c in cand if c not in const]
    Z, Zt = (Xc[cand] - mu[cand]) / sd[cand], (Xtc[cand] - mu[cand]) / sd[cand]
    # --- step 2 screen (train only, raw values)
    screen = {}
    for c in cand:
        pr = stats.pearsonr(X[c], y)[0]; sr = stats.spearmanr(X[c], y)[0]
        screen[c] = (float(pr), float(sr))
    # --- step 3 definition / mechanical drops, then VIF
    reasons = {}
    for c in cand:
        if c in DEFN_DROP:
            reasons[c] = f"definition drop: {DEFN_DROP[c]}"
        elif lens == "explanatory" and c in MECH_DROP_EXPL:
            reasons[c] = f"mechanical drop: {MECH_DROP_EXPL[c]}"
    pool = [c for c in cand if c not in reasons]
    kept, vlog, vfin = vif_prune(Z[pool], PRIORITY)
    for d in vlog:
        reasons[d["driver"]] = (f"VIF drop: {d['trigger']} had VIF {d['trigger_vif']:.1f} > {VIF_MAX:g}; {d['driver']} (VIF {d['vif']:.1f}) is the lowest-priority of its correlated set "
                                f"({', '.join(d['vs']) if d['vs'] else 'none'}) so it was dropped")
    for c, r in reasons.items():
        log["drops"].append({"driver": c, "reason": r})
    log["kept"], log["vif_final"] = kept, {k: float(v) for k, v in vfin.items()}
    log["max_corr_kept"] = float(np.max(np.abs(np.corrcoef(Z[kept].to_numpy(), rowvar=False) - np.eye(len(kept))))) if len(kept) > 1 else 0.0
    # initial VIF before pruning (all non-excluded candidates), for the manifest
    log["vif_initial"] = {k: float(v) for k, v in zip(pool, vif_table(Z[pool].to_numpy()))}
    lbl = "same-game measure (describes how points are produced; not a pregame predictor)" if lens == "explanatory" else "prior rolling input"
    for c in cand:
        for nm, r in zip(("screen_pearson", "screen_spearman"), screen[c]):
            ci = fisher_ci(r, len(y), spearman=(nm == "screen_spearman"))
            rows.append(dict(model=nm + tag, driver=c, coef_std=r, ci_low=ci[0], ci_high=ci[1], rank_in_cell=None, kept_after_vif=c in kept,
                             shap_mean_abs=None, test_r2=None, test_mae=None, test_rmse=None, baseline_mae=None,
                             notes=f"screening only (correlation with PTS on train rows; naive CI ignores player clustering); {lbl}; "
                                   + ("kept" if c in kept else reasons.get(c, "dropped")) + f"; vif={log['vif_initial'].get(c, float('nan')):.1f}" if c in pool else
                                   f"screening only (correlation with PTS on train rows; naive CI ignores player clustering); {lbl}; " + reasons.get(c, "dropped")))
    Zk, Ztk = Z[kept].to_numpy(), Zt[kept].to_numpy()
    players_tr = tr["player_id"].to_numpy()
    codes = pd.factorize(players_tr)[0]
    preds, model_rows = {}, {}

    def add_model(name, coefs, cis, extra_note, pred, rank_ok=True):
        s = score(yt, pred)
        preds[name] = pred
        order = None
        mags = {d: abs(v) for d, v in coefs.items() if v is not None and abs(v) > 0}
        if rank_ok and mags:
            order = {d: k + 1 for k, d in enumerate(sorted(mags, key=lambda d: -mags[d]))}
        model_rows[name] = dict(score=s, rows=[dict(model=name + tag, driver=d, coef_std=coefs[d], ci_low=(cis[d][0] if cis else None),
                                                    ci_high=(cis[d][1] if cis else None), rank_in_cell=(order or {}).get(d), kept_after_vif=True,
                                                    shap_mean_abs=None, test_r2=s["r2"], test_mae=s["mae"], test_rmse=s["rmse"], baseline_mae=base["baseline_mae"],
                                                    notes=f"{extra_note}; {lbl}; {bnote}") for d in kept])
    # --- step 4 OLS, cluster-robust by player
    try:
        A = sm.add_constant(Zk); At = sm.add_constant(Ztk, has_constant="add")
        ols = sm.OLS(y, A).fit(cov_type="cluster", cov_kwds={"groups": codes})
        ci = ols.conf_int(); b = np.asarray(ols.params)
        names = ["const"] + kept
        add_model("ols_cluster", {n: float(b[k + 1]) for k, n in enumerate(kept)},
                  {n: (float(ci[k + 1][0]), float(ci[k + 1][1])) for k, n in enumerate(kept)},
                  f"OLS on train, std predictors (PTS per +1 SD), player-cluster robust 95% CI ({len(np.unique(codes))} clusters)", At @ b)
    except Exception as e:
        log["ols_error"] = repr(e)
    # --- step 5 elastic net, time-ordered CV inside train
    try:
        od = np.argsort(tr["game_date"].to_numpy(), kind="stable")
        folds = time_folds(tr["game_date"].to_numpy()[od])
        en = ElasticNetCV(l1_ratio=[0.3, 0.6, 1.0], alphas=40, cv=folds, max_iter=20000, random_state=SEED, selection="cyclic")
        en.fit(Zk[od], y[od])
        coefs = {n: float(c) for n, c in zip(kept, en.coef_)}
        add_model("enet", coefs, None,
                  f"elastic net, time-ordered CV on train ({len(folds)} expanding folds), alpha={en.alpha_:.4g}, l1_ratio={en.l1_ratio_:g}; no CI for penalised fits; "
                  f"survivors={sum(1 for v in coefs.values() if v != 0)}/{len(kept)}", en.predict(Ztk))
        log["enet"] = {"alpha": float(en.alpha_), "l1_ratio": float(en.l1_ratio_), "survivors": [k for k, v in coefs.items() if v != 0]}
    except Exception as e:
        log["enet_error"] = repr(e)
    # --- step 6 MixedLM (player random intercept)
    try:
        A = sm.add_constant(Zk)
        md = sm.MixedLM(y, A, groups=players_tr)
        res = md.fit(reml=True, method=["bfgs", "powell"], maxiter=300)
        fe = np.asarray(res.fe_params); ci = np.asarray(res.conf_int())
        pv = float(np.asarray(res.cov_re)[0, 0])
        try:
            re = {g: float(np.asarray(v)[0]) for g, v in res.random_effects.items()}
        except Exception:
            re = {}      # player variance on the boundary (~0): the model reduces to the fixed-effects regression
        pred = sm.add_constant(Ztk, has_constant="add") @ fe + te["player_id"].map(re).fillna(0.0).to_numpy()
        known = float(te["player_id"].isin(re).mean())
        sing = (not re) or pv < 1e-6
        add_model("mixedlm", {n: float(fe[k + 1]) for k, n in enumerate(kept)},
                  {n: (float(ci[k + 1, 0]), float(ci[k + 1, 1])) for k, n in enumerate(kept)},
                  f"MixedLM, player random intercept (REML), fixed effects (PTS per +1 SD) with 95% CI; test = fixed + player intercept for players seen in train "
                  f"({known:.1%} of test rows); converged={bool(res.converged)}; player var={pv:.3f}"
                  + ("; player variance on the boundary (~0): reduces to the fixed-effects regression, CIs may be unreliable" if sing else ""), pred)
        log["mixedlm"] = {"converged": bool(res.converged), "player_var": pv, "resid_var": float(res.scale), "singular": bool(sing)}
    except Exception as e:
        log["mixedlm_error"] = repr(e)
    # --- step 7 gradient boosting + SHAP, keep only if clearly better than best linear
    try:
        od = np.argsort(tr["game_date"].to_numpy(), kind="stable")
        Zs, ys = Zk[od], y[od]
        folds = time_folds(tr["game_date"].to_numpy()[od])
        mcs = int(max(10, min(50, len(y) // 20)))
        prm = dict(learning_rate=0.05, num_leaves=15, min_child_samples=mcs, subsample=0.8, subsample_freq=1, colsample_bytree=0.8,
                   reg_lambda=1.0, random_state=SEED, n_jobs=1, verbose=-1)
        NMAX = 400
        curves = []
        for a_, b_ in folds:
            m = lgb.LGBMRegressor(n_estimators=NMAX, **prm).fit(Zs[a_], ys[a_], eval_set=[(Zs[b_], ys[b_])], eval_metric="l1")
            curves.append(np.array(m.evals_result_["valid_0"]["l1"]))
        best_n = int(np.argmin(np.mean(curves, axis=0)) + 1) if curves else 150
        gb = lgb.LGBMRegressor(n_estimators=best_n, **prm).fit(Zs, ys)
        pg = gb.predict(Ztk)
        rs = np.random.default_rng(SEED)
        samp = rs.choice(len(Ztk), size=min(3000, len(Ztk)), replace=False)
        sv = np.abs(shap.TreeExplainer(gb).shap_values(Ztk[samp])).mean(0)
        s = score(yt, pg); preds["gbm_shap"] = pg
        lin = [m for m in ("ols_cluster", "enet", "mixedlm") if m in model_rows]
        best = min(lin, key=lambda m: model_rows[m]["score"]["mae"]) if lin else None
        kept_gbm, gnote = False, "no linear model to compare"
        if best:
            gain, glo, ghi = cluster_gain(np.abs(yt - preds[best]), np.abs(yt - pg), te["player_id"].to_numpy())
            rel = gain / model_rows[best]["score"]["mae"]
            kept_gbm = bool(rel >= GBM_MIN_GAIN and glo > 0 and s["r2"] is not None and s["r2"] > (model_rows[best]["score"]["r2"] or -9))
            gnote = (f"vs best linear ({best}): MAE gain {gain:+.3f} pts ({rel:+.1%}), player-cluster bootstrap 95% CI [{glo:+.3f}, {ghi:+.3f}]; "
                     f"rule: keep if gain >= {GBM_MIN_GAIN:.0%} of MAE with CI above 0 and higher R2")
            log["gbm"] = {"best_linear": best, "gain": gain, "gain_ci": [glo, ghi], "rel_gain": rel, "kept": kept_gbm, "n_estimators": best_n}
        order = {d: k + 1 for k, d in enumerate(sorted(kept, key=lambda d: -sv[kept.index(d)]))}
        model_rows["gbm_shap"] = dict(score=s, rows=[dict(model="gbm_shap" + tag, driver=d, coef_std=None, ci_low=None, ci_high=None,
                                                         rank_in_cell=order[d] if kept_gbm else None, kept_after_vif=True, shap_mean_abs=float(sv[k]),
                                                         test_r2=s["r2"], test_mae=s["mae"], test_rmse=s["rmse"], baseline_mae=base["baseline_mae"],
                                                         notes=(f"LightGBM ({best_n} trees, time-ordered CV) + SHAP (mean |SHAP| in PTS, <=3000 test rows); "
                                                                + ("KEPT: clearly beats linear; " if kept_gbm else "NOT kept: linear is enough; ") + gnote + f"; {lbl}; {bnote}"))
                                                    for k, d in enumerate(kept)])
    except Exception as e:
        log["gbm_error"] = repr(e)
    for name, mr in model_rows.items():
        rows.extend(mr["rows"])
    if keep_preds:
        log["_preds"] = {k: np.asarray(v, dtype=float) for k, v in preds.items()}
    log["scores"] = {k: v["score"] for k, v in model_rows.items()}
    log["baseline"] = {"mae": sb["mae"], "r2": sb["r2"], "rmse": sb["rmse"]}
    return rows, log


# ---------------------------------------------------------------- cells
G_ALL = None; W_ALL = None; FLOORS = None; DATES = None; CUTS = None


def run_cell(task):
    ts, seg = task
    t0 = time.time()
    warnings.filterwarnings("ignore")
    spec = hab.TIMESPANS[ts]
    w = W_ALL[W_ALL.season.isin(spec["seasons"])]
    cut = CUTS[ts]
    g = G_ALL[G_ALL.season.isin(spec["seasons"])]
    # membership: explanatory = the app's segments (ranked on the whole window, as in the home/away rerun)
    mem_full = hab.segment_members(hab.rank_table(G_ALL, ts, FLOORS[ts]))[seg]
    # pregame = ranked on the TRAIN portion only (no look-ahead); games floor scaled by the train share of player-games
    gtr = g[g.game_date < cut]
    share = len(gtr) / len(g)
    floor_tr = None if FLOORS[ts] is None else max(1, int(math.ceil(FLOORS[ts] * share)))
    mem_tr = hab.segment_members(hab.rank_table(G_ALL[G_ALL.game_date < cut], ts, floor_tr))[seg]
    out_rows, logs = [], []
    for lens in ("explanatory", "pregame"):
        mem = mem_full if lens == "explanatory" else mem_tr
        sub = w[w.player_id.isin(mem)]
        tr, te = sub[sub.game_date < cut], sub[sub.game_date >= cut]
        n_games, n_players = int(len(sub)), int(sub.player_id.nunique())
        thin = bool(n_players < THIN_PLAYERS or n_games < THIN_GAMES)
        specs = [("explanatory", None, {b: b for b in BASE})] if lens == "explanatory" else \
            [("pregame", win + suffix, {**{b: f"{b}__{win}" for b in BASE}, **({"pts": f"pts__{win}"} if suffix else {})}) for win in WINDOWS for suffix in ("", "+ppg")]
        for _, win, cmap in specs:
            p = len(cmap)
            ok = len(tr) >= max(60, 6 * p) and tr.player_id.nunique() >= 8 and len(te) >= 10
            if not ok:
                logs.append(dict(ts=ts, seg=seg, lens=lens, window=win, fitted=False, n_train=int(len(tr)), n_test=int(len(te)), n_games=n_games, n_players=n_players))
                out_rows.append(dict(lens=lens, segment=seg, timespan=ts, model="none" + (f"@{win}" if win else ""), driver=None, coef_std=None, ci_low=None, ci_high=None,
                                     rank_in_cell=None, kept_after_vif=None, shap_mean_abs=None, test_r2=None, test_mae=None, test_rmse=None, baseline_mae=None,
                                     n_games=n_games, n_players=n_players, thin_flag=True,
                                     notes=f"not fitted: too few rows (train={len(tr)}, test={len(te)}, train players={tr.player_id.nunique()}); cutoff {cut.date()}"))
                continue
            try:
                rows, lg = fit_spec(tr, te, cmap, lens, win, {})
            except Exception as e:
                logs.append(dict(ts=ts, seg=seg, lens=lens, window=win, fitted=False, error=repr(e), n_games=n_games, n_players=n_players))
                continue
            lg.update(ts=ts, seg=seg, fitted=True, n_games=n_games, n_players=n_players, thin=thin, cutoff=str(cut.date()))
            logs.append(lg)
            for r in rows:
                if thin:
                    r["rank_in_cell"] = None
                r.update(lens=lens, segment=seg, timespan=ts, n_games=n_games, n_players=n_players, thin_flag=thin)
                r["notes"] = f"train/test rows={len(tr)}/{len(te)}, test = game dates >= {cut.date()}; " + r["notes"] + ("; THIN cell: drivers not ranked" if thin else "")
                out_rows.append(r)
    return ts, seg, out_rows, logs, time.time() - t0


COLS = ["lens", "segment", "timespan", "model", "driver", "coef_std", "ci_low", "ci_high", "rank_in_cell", "kept_after_vif", "shap_mean_abs",
        "test_r2", "test_mae", "test_rmse", "baseline_mae", "n_games", "n_players", "thin_flag", "notes"]


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def main():
    global G_ALL, W_ALL, FLOORS, CUTS
    ap = argparse.ArgumentParser()
    ap.add_argument("--through", default="2026-11-09"); ap.add_argument("--jobs", type=int, default=6)
    ap.add_argument("--only", default=None, help="timespan:segment, e.g. pooled_2023_26:all (test run; does not write the mart)")
    ap.add_argument("--out", default=str(OUT_PARQUET))
    args = ap.parse_args()
    import statsmodels, sklearn, shap, lightgbm
    stack = {"statsmodels": statsmodels.__version__, "scikit-learn": sklearn.__version__, "shap": shap.__version__, "lightgbm": lightgbm.__version__,
             "pandas": pd.__version__, "duckdb": duckdb.__version__}
    print("stack:", stack, flush=True)
    cov = coverage_report(args.through)
    print("coverage:", cov, flush=True)
    raw = load_rows(args.through)
    W_ALL = add_pregame_features(raw)
    print(f"modelling rows (>= {MIN_MIN:g} min, advanced joined): {len(raw)}; eligible (>= {PRIOR_ALL} prior games, >= {PRIOR_SEASON} prior this season): {len(W_ALL)}", flush=True)
    G_ALL = hab.load_games(args.through)
    G_ALL["game_date"] = pd.to_datetime(G_ALL["game_date"])
    FLOORS = hab.timespan_floors(G_ALL, None)
    CUTS, ncut = {}, {}
    for ts, spec in hab.TIMESPANS.items():
        ds = np.sort(W_ALL[W_ALL.season.isin(spec["seasons"])].game_date.unique())
        ntest = max(1, int(round(TEST_FRAC * len(ds))))
        CUTS[ts] = pd.Timestamp(ds[len(ds) - ntest]); ncut[ts] = dict(n_dates=int(len(ds)), n_test_dates=ntest, cutoff=str(CUTS[ts].date()),
                                                                     first=str(pd.Timestamp(ds[0]).date()), last=str(pd.Timestamp(ds[-1]).date()))
    print("cutoffs:", ncut, "floors:", FLOORS, flush=True)
    tasks = [(ts, sid) for ts in ["pooled_2023_27", "pooled_2023_26", "2025_26", "2024_25", "2023_24", "2026_27"] for sid in hab.SEGMENT_IDS]
    if args.only:
        a, b = args.only.split(":"); tasks = [(a, b)]
    ctx = mp.get_context("fork")
    results = []
    with ctx.Pool(min(args.jobs, len(tasks))) as pool:
        for r in pool.imap_unordered(run_cell, tasks):
            print(f"cell {r[0]} x {r[1]} done in {r[4]:.0f}s ({len(r[2])} rows)", flush=True)
            results.append(r)
    results.sort(key=lambda r: (list(hab.TIMESPANS).index(r[0]), hab.SEGMENT_IDS.index(r[1])))
    rows = [x for r in results for x in r[2]]
    logs = [x for r in results for x in r[3]]
    df = pd.DataFrame(rows)[COLS]
    for c in ["coef_std", "ci_low", "ci_high", "shap_mean_abs", "test_r2", "test_mae", "test_rmse", "baseline_mae"]:
        df[c] = pd.to_numeric(df[c], errors="coerce").replace([np.inf, -np.inf], np.nan)
    df["rank_in_cell"] = df["rank_in_cell"].astype("Int64")
    df["kept_after_vif"] = df["kept_after_vif"].astype("boolean")
    df["thin_flag"] = df["thin_flag"].astype(bool)
    df["n_games"] = df["n_games"].astype("Int64"); df["n_players"] = df["n_players"].astype("Int64")
    if args.only:
        print(df.head(40).to_string()); json.dump(logs, open("/tmp/pd_only_logs.json", "w"), indent=1, default=str); return
    df = df.sort_values(["lens", "timespan", "segment", "model", "rank_in_cell", "driver"], key=lambda s: s.map({k: i for i, k in enumerate(list(hab.TIMESPANS) + hab.SEGMENT_IDS)}) if s.name in ("timespan", "segment") else s,
                        na_position="last", kind="stable").reset_index(drop=True)
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(args.out, index=False)
    con = duckdb.connect(str(D / "marts" / "nba_phase1.duckdb"))
    con.execute(f"CREATE OR REPLACE VIEW points_drivers AS SELECT * FROM read_parquet('{Path(args.out).resolve()}')")
    con.close()
    manifest = dict(script="scripts/points_drivers.py", through=args.through, stack=stack, seed=SEED, inputs={"box": sha(BOX), "advanced": sha(ADV)},
                    coverage=cov, modelling_rows=int(len(raw)), eligible_rows=int(len(W_ALL)), date_split=ncut, floors=FLOORS,
                    adv_not_used=ADV_DISPOSITION, not_available=NOT_AVAILABLE, rules=dict(min_minutes=MIN_MIN, prior_games_all=PRIOR_ALL, prior_games_season=PRIOR_SEASON,
                    test_frac=TEST_FRAC, vif_max=VIF_MAX, thin=[THIN_PLAYERS, THIN_GAMES], gbm_rule=f"MAE gain >= {GBM_MIN_GAIN:.0%} with player-cluster bootstrap CI > 0 and higher R2"),
                    cells=logs, parquet_sha256=sha(Path(args.out)), n_rows=int(len(df)))
    OUT_MANIFEST.parent.mkdir(exist_ok=True)
    json.dump(manifest, open(OUT_MANIFEST, "w"), indent=1, default=str)
    print("wrote", args.out, len(df), "rows")


if __name__ == "__main__":
    main()
