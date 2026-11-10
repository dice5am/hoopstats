"""Deep analyses (hoopstats): tiers / splines, tails, dispersion, interactions, random slopes, per-player depth.  All PREGAME; see deep_data.py for the dataset.
Cells = 5 PPG segments x 6 timespans, membership = train-only PPG ranks (no look-ahead), date-based test split per cell (same cut-offs as points_drivers/matchups).
Descriptive effects (tier tables, odds ratios, quantile shifts, dispersion) use ALL eligible rows of the cell with player-clustered SEs; every out-of-sample number
(mean-model lift, logistic/GBM/quantile skill, calibration) is fit on train dates and scored on the later test dates.
"""
from __future__ import annotations
import argparse, json, math, sys, time, warnings, hashlib
from multiprocessing import Pool
from pathlib import Path
import duckdb
import numpy as np
import pandas as pd
from scipy import stats
from scipy.special import expit

sys.path.insert(0, str(Path(__file__).resolve().parent))
import analysis_home_away_b2b as hab
import points_drivers as P
import deep_data as DD

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "marts"; MAN = ROOT / "data" / "manifests"
SEED = 20261110
OUTCOMES = ["dev", "big5", "big10", "x125"]
BIG = ["big5", "big10", "x125"]
BOOT_Q, BOOT_SD, SIM_AME = 100, 500, 400
Z_WATCH, Q_STRONG = 2.5, 0.10
MIN_EVENTS_FULL, MIN_EVENTS_NESTED = 120, 60

WM = None; G_ALL = None; FLOORS = None; CUTS = None; META = None


# ------------------------------------------------------------------ helpers
def mean_infl(y, mask, cl, C):
    n = int(mask.sum())
    if n == 0:
        return None
    m = float(y[mask].mean())
    u = np.bincount(cl[mask], weights=y[mask] - m, minlength=C) / n
    return m, n, u, int((np.bincount(cl[mask], minlength=C) > 0).sum())


def contrast(y, ma, mb, cl, C, ratio=False):
    a, b = mean_infl(y, ma, cl, C), mean_infl(y, mb, cl, C)
    if a is None or b is None:
        return None
    d = a[0] - b[0]; se = float(np.sqrt(((a[2] - b[2]) ** 2).sum()))
    out = dict(est_level=a[0], est_ref=b[0], diff=d, se=se, ci_low=d - 1.96 * se, ci_high=d + 1.96 * se, n_level=a[1], n_ref=b[1], n_players_level=a[3], n_players_ref=b[3])
    if ratio and a[0] > 0 and b[0] > 0:
        sl = float(np.sqrt(((a[2] / a[0] - b[2] / b[0]) ** 2).sum())); lr = math.log(a[0] / b[0])
        out.update(ratio=a[0] / b[0], ratio_ci_low=math.exp(lr - 1.96 * sl), ratio_ci_high=math.exp(lr + 1.96 * sl))
    return out


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


def thin_level(n_games, n_players):
    return bool(n_players < P.THIN_PLAYERS or n_games < P.THIN_GAMES)


# ------------------------------------------------------------------ 1. tier effects (descriptive, all rows of the cell)
def level_specs(s):
    """[(dimension, level, mask, reference_label, ref_mask)] — exclusive levels vs a named reference, nested groups vs the complement."""
    out = []
    def excl(dim, col, levels, ref):
        rm = (s[col] == ref).to_numpy()
        for l in levels:
            if l != ref:
                out.append((dim, l, (s[col] == l).to_numpy(), ref, rm))
    def nest(dim, name, mask):
        out.append((dim, name, mask, "complement", ~mask))
    excl("opp_defence_tier", "def_tier", DD.DEF_TIERS, "middle")
    dt = s.def_tier
    nest("opp_defence_nested", "worst5", (dt == "worst5").to_numpy()); nest("opp_defence_nested", "worst10", dt.isin(["worst5", "worst6_10"]).to_numpy())
    nest("opp_defence_nested", "best10", dt.isin(["best5", "best6_10"]).to_numpy()); nest("opp_defence_nested", "best5", (dt == "best5").to_numpy())
    excl("opp_pace_tier", "pace_tier", DD.PACE_TIERS, "middle")
    pt = s.pace_tier
    nest("opp_pace_nested", "fastest10", pt.isin(["fastest5", "fast6_10"]).to_numpy()); nest("opp_pace_nested", "slowest10", pt.isin(["slowest5", "slow6_10"]).to_numpy())
    excl("usage_tier", "usage_tier", DD.USG_TIERS, "u2_mid"); excl("minutes_tier", "min_tier", DD.MIN_TIERS, "m2_20_28")
    excl("rest_days", "rest_cat", ["r0", "r1", "r2", "r3plus"], "r1")
    excl("b2b_state", "b2b_state", ["2nd", "1st", "rested"], "rested")
    nest("venue", "home", (s.home == 1).to_numpy()); excl("role", "role", ["starter", "bench"], "bench")
    for p in ("G", "F", "C"):
        nest("position", p, (s.pos == p).to_numpy())
    return out


def tier_rows(s, key):
    cl = pd.factorize(s.player_id)[0]; C = cl.max() + 1; rows = []
    ys = {o: s[o].to_numpy(float) for o in OUTCOMES}
    for dim, lvl, ma, ref, mb in level_specs(s):
        for o in OUTCOMES:
            c = contrast(ys[o], ma, mb, cl, C, ratio=o != "dev")
            if c is None: continue
            c.update(key); c.update(dimension=dim, level=lvl, reference=ref, outcome=o, thin_level=thin_level(c["n_level"], c["n_players_level"]))
            rows.append(c)
    return rows


# ------------------------------------------------------------------ 2. mean models: linear vs tiers vs splines (test) + nonlinearity Wald tests + curves
def _dm(formula, tr, te=None):
    import patsy
    X = patsy.dmatrix(formula, tr, return_type="dataframe")
    if te is None:
        return X
    return X, patsy.build_design_matrices([X.design_info], te, return_type="dataframe")[0]


CTRL = "prior_avg + usg_prior + min_prior + prog_log + C(role)"
B2B = "C(b2b_state, Treatment('rested')) + opp_b2b + home"
FORMS = {"controls": CTRL, "linear": f"{CTRL} + opp_def_u + opp_pace_u + {B2B}",
         "tiers": f"{CTRL} + C(def_tier, Treatment('middle')) + C(pace_tier, Treatment('middle')) + {B2B}",
         "spline": f"{CTRL} + cr(opp_def_u, df=4) + cr(opp_pace_u, df=4) + {B2B}",
         "spline_plus_player": f"prior_avg + cr(usg_prior, df=4) + cr(min_prior, df=4) + C(role) + cr(opp_def_u, df=4) + cr(opp_pace_u, df=4) + {B2B}"}


def mean_model_compare(tr, te, key):
    rows = []
    y, yt = tr.dev.to_numpy(float), te.dev.to_numpy(float); pl = te.player_id.to_numpy()
    preds = {"prior_average": np.zeros(len(te))}
    for name, f in FORMS.items():
        X, Xt = _dm(f, tr, te)
        beta = np.linalg.lstsq(X.to_numpy(), y, rcond=None)[0]; preds[name] = Xt.to_numpy() @ beta
    ytrue = te.pts.to_numpy(float); base = te.prior_avg.to_numpy(float)
    ae = {k: np.abs(yt - v) for k, v in preds.items()}
    for k, v in preds.items():
        sc = P.score(ytrue, base + v)
        r = dict(key, kind="mean_model", variable="all_context", model=k, test_mae=sc["mae"], test_rmse=sc["rmse"], test_r2=sc["r2"], n_train=len(tr), n_test=len(te))
        for ref in ("prior_average", "controls", "linear"):
            if k == ref or (ref == "linear" and k in ("prior_average", "controls")): continue
            g, lo, hi = P.cluster_gain(ae[ref], ae[k], pl); r[f"mae_gain_vs_{ref}"] = g; r[f"mae_gain_vs_{ref}_lo"] = lo; r[f"mae_gain_vs_{ref}_hi"] = hi
        rows.append(r)
    return rows


def nonlinearity_tests(s, key):
    import statsmodels.api as sm, patsy
    rows = []; cl = pd.factorize(s.player_id)[0]
    base = _dm(f"{FORMS['linear']}", s).drop(columns=[]); y = s.dev.to_numpy(float)
    for v in ["opp_def_u", "opp_pace_u", "usg_prior", "min_prior", "prior_avg"]:
        Bs = patsy.dmatrix(f"cr({v}, df=5) - 1", s, return_type="dataframe").to_numpy()
        Xl = base.to_numpy()
        R = Bs - Xl @ np.linalg.lstsq(Xl, Bs, rcond=None)[0]
        U, S_, _ = np.linalg.svd(R, full_matrices=False); r = int((S_ > 1e-6 * S_[0]).sum()); Rn = U[:, :r] * S_[:r]
        Xf = np.column_stack([Xl, Rn]); k0 = Xl.shape[1]
        try:
            res = sm.OLS(y, Xf).fit(cov_type="cluster", cov_kwds={"groups": cl})
            R_ = np.zeros((r, Xf.shape[1])); R_[:, k0:] = np.eye(r)
            w = res.wald_test(R_, scalar=True, use_f=False)
            rows.append(dict(key, kind="nonlinearity_wald", variable=v, model="spline_df5_vs_linear", wald_chi2=float(w.statistic), wald_df=r, wald_p=float(w.pvalue), n_train=len(s)))
        except Exception as e:
            rows.append(dict(key, kind="nonlinearity_wald", variable=v, model="spline_df5_vs_linear", notes=f"failed: {type(e).__name__}"))
    return rows


def curves(s, key):
    import statsmodels.api as sm, patsy
    rows = []; cl = pd.factorize(s.player_id)[0]; y = s.dev.to_numpy(float)
    grids = {"opp_def_u": ("opp_defence_rank_from_worst", (np.arange(1, 31) - 0.5) / 30), "opp_pace_u": ("opp_pace_rank_from_fastest", (np.arange(1, 31) - 0.5) / 30),
             "usg_prior": ("prior_usg", np.quantile(s.usg_prior, np.linspace(0.05, 0.95, 10))), "min_prior": ("prior_minutes", np.quantile(s.min_prior, np.linspace(0.05, 0.95, 10)))}
    for v, (lab, grid) in grids.items():
        others = [c for c in ("opp_def_u", "opp_pace_u", "usg_prior", "min_prior", "prior_avg") if c != v]
        f = f"cr({v}, df=5) + " + " + ".join(others) + f" + home + opp_b2b + C(b2b_state, Treatment('rested')) + C(role)"
        X = patsy.dmatrix(f, s, return_type="dataframe")
        res = sm.OLS(y, X).fit(cov_type="cluster", cov_kwds={"groups": cl})
        g = pd.DataFrame({v: grid})
        for c in others + ["home", "opp_b2b"]: g[c] = float(s[c].mean())
        g["b2b_state"] = "rested"; g["role"] = "starter" if (s.role == "starter").mean() >= 0.5 else "bench"
        Xg = patsy.build_design_matrices([X.design_info], g, return_type="dataframe")[0].to_numpy()
        fit = Xg @ res.params.to_numpy(); se = np.sqrt(np.einsum("ij,jk,ik->i", Xg, res.cov_params().to_numpy(), Xg))
        for x, xl, ft, sd in zip(range(len(grid)), grid, fit, se):
            rows.append(dict(key, kind="curve", variable=v, model="cr_df5", x_label=lab, x=float(xl) if lab not in ("opp_defence_rank_from_worst", "opp_pace_rank_from_fastest") else float(x + 1),
                             fit_pts_vs_prior_avg=float(ft), ci_low=float(ft - 1.96 * sd), ci_high=float(ft + 1.96 * sd), n_train=len(s)))
    return rows


# ------------------------------------------------------------------ 3. tails
def ctrl_stats(df):
    return {c: (float(df[c].mean()), float(df[c].std() or 1.0)) for c in ("prior_avg", "usg_prior", "min_prior", "prog_log")}


def make_X(df, kind, st):
    X = pd.DataFrame(index=df.index)
    z = lambda c: (df[c] - st[c][0]) / st[c][1]
    X["prior_avg_z"] = z("prior_avg"); X["usg_z"] = z("usg_prior"); X["min_z"] = z("min_prior"); X["prog_z"] = z("prog_log"); X["starter"] = (df.role == "starter").astype(float)
    if kind == "player":
        X["pos_G"] = (df.pos == "G").astype(float); X["pos_F"] = (df.pos == "F").astype(float)
    else:
        if kind == "ctx_full":
            for k in ("worst5", "worst6_10", "best6_10", "best5"): X[f"def_{k}"] = (df.def_tier == k).astype(float)
            for k in ("fastest5", "fast6_10", "slow6_10", "slowest5"): X[f"pace_{k}"] = (df.pace_tier == k).astype(float)
            X["pos_G"] = (df.pos == "G").astype(float); X["pos_F"] = (df.pos == "F").astype(float)
        else:   # ctx_nested (bottom-10 / top-10 vs the middle 10)
            X["def_worst10"] = df.def_tier.isin(["worst5", "worst6_10"]).astype(float); X["def_best10"] = df.def_tier.isin(["best5", "best6_10"]).astype(float)
            X["pace_fast10"] = df.pace_tier.isin(["fastest5", "fast6_10"]).astype(float); X["pace_slow10"] = df.pace_tier.isin(["slow6_10", "slowest5"]).astype(float)
        X["home"] = df.home.astype(float); X["b2b_2nd"] = (df.b2b_state == "2nd").astype(float); X["b2b_1st"] = (df.b2b_state == "1st").astype(float); X["opp_b2b"] = df.opp_b2b.astype(float)
    X.insert(0, "const", 1.0)
    return X


def drop_const(X):
    """Remove zero-variance columns (e.g. 'starter' in an all-starters segment) that make the design singular."""
    keep = [c for c in X.columns if c == "const" or X[c].nunique() > 1]
    return X[keep]


CTX_TERMS = lambda X: [c for c in X.columns if c.split("_")[0] in ("def", "pace", "home", "b2b", "opp")]


def fit_logit(X, y, cl):
    import statsmodels.api as sm
    m = sm.Logit(y, X.to_numpy())
    try:
        r = m.fit(disp=0, maxiter=200, cov_type="cluster", cov_kwds={"groups": cl})
    except Exception:
        r = m.fit(disp=0, maxiter=500, method="bfgs", cov_type="cluster", cov_kwds={"groups": cl})
    return r


def ame_draws(X, res, col, rng, n_max=12000):
    j = list(X.columns).index(col); A = X.to_numpy()
    if len(A) > n_max: A = A[rng.choice(len(A), n_max, replace=False)]
    A1, A0 = A.copy(), A.copy(); A1[:, j] = 1; A0[:, j] = 0
    B = rng.multivariate_normal(res.params, res.cov_params(), size=SIM_AME).T
    d = (expit(A1 @ B) - expit(A0 @ B)).mean(0)
    pt = float((expit(A1 @ res.params) - expit(A0 @ res.params)).mean())
    return pt, float(np.percentile(d, 2.5)), float(np.percentile(d, 97.5))


def logit_effects(s, outcome, kind, key, rng):
    X = drop_const(make_X(s, kind, ctrl_stats(s))); y = s[outcome].to_numpy(int); cl = pd.factorize(s.player_id)[0]
    res = fit_logit(X, y, cl); rows = []
    if not np.all(np.isfinite(res.bse)) or np.abs(res.params).max() > 12:
        return [dict(key, outcome=outcome, model=f"logit_{kind}", term=None, notes="not reported: non-finite SE or separation")], None
    se = res.bse
    for i, c in enumerate(X.columns):
        if c not in CTX_TERMS(X): continue
        pt, lo, hi = ame_draws(X, res, c, rng)
        rows.append(dict(key, outcome=outcome, model=f"logit_{kind}", term=c, scale="odds_ratio", estimate=float(np.exp(res.params[i])), ci_low=float(np.exp(res.params[i] - 1.96 * se[i])),
                         ci_high=float(np.exp(res.params[i] + 1.96 * se[i])), p_value=float(res.pvalues[i]), abs_prob_diff=pt, abs_prob_diff_lo=lo, abs_prob_diff_hi=hi,
                         base_rate=float(y.mean()), n_games=len(s), n_events=int(y.sum()), notes=f"adjusted for prior avg PTS, prior usage, prior minutes, season progress (log prior games), role{'' if kind == 'ctx_nested' else ', position'}; terms vs middle-10 defences/pace; player-clustered SE; AME CI by 400 draws from the clustered covariance"))
    return rows, res


def cal_table(p, y, nb):
    q = pd.qcut(pd.Series(p).rank(method="first"), nb, labels=False)
    d = pd.DataFrame({"p": p, "y": y, "b": q}).groupby("b").agg(mean_pred=("p", "mean"), obs=("y", "mean"), n=("y", "size")).reset_index()
    return d


def tail_perf(tr, te, outcome, key, kind):
    from sklearn.ensemble import HistGradientBoostingClassifier
    from sklearn.metrics import roc_auc_score, brier_score_loss, log_loss
    import statsmodels.api as sm
    ytr, yte = tr[outcome].to_numpy(int), te[outcome].to_numpy(int); pl = te.player_id.to_numpy()
    st = ctrl_stats(tr); preds = {}; notes = {}
    p0 = float(ytr.mean()); preds["base_rate"] = np.full(len(te), np.clip(p0, 1e-4, 1 - 1e-4))
    for nm, kd in (("logit_player", "player"), ("logit_ctx", kind)):
        Xtr = drop_const(make_X(tr, kd, st)); Xte = make_X(te, kd, st)[Xtr.columns]
        try:
            r = sm.Logit(ytr, Xtr.to_numpy()).fit(disp=0, maxiter=200); preds[nm] = np.clip(expit(Xte.to_numpy() @ r.params), 1e-4, 1 - 1e-4)
        except Exception as e:
            notes[nm] = f"failed {type(e).__name__}"
    feats_p = ["prior_avg", "usg_prior", "min_prior", "prog_log"]; feats_c = feats_p + ["opp_def_u", "opp_pace_u", "home", "team_rest", "opp_rest", "team_b2b", "opp_b2b"]
    def gb(cols):
        A = tr[cols].astype(float).copy(); B = te[cols].astype(float).copy()
        for d in (A, B):
            d["starter"] = (tr.role if d is A else te.role).eq("starter").astype(float).to_numpy(); d["pos_code"] = (tr.pos if d is A else te.pos).map({"G": 0, "F": 1, "C": 2}).to_numpy()
        m = HistGradientBoostingClassifier(max_depth=3, learning_rate=0.05, max_iter=120, min_samples_leaf=40, l2_regularization=1.0, random_state=SEED)
        m.fit(A, ytr); return np.clip(m.predict_proba(B)[:, 1], 1e-4, 1 - 1e-4)
    if len(tr) >= 1500 and ytr.sum() >= 80:
        preds["gbm_player"] = gb(feats_p); preds["gbm_ctx"] = gb(feats_c)
    loss = {k: -(yte * np.log(p) + (1 - yte) * np.log(1 - p)) for k, p in preds.items()}; sq = {k: (p - yte) ** 2 for k, p in preds.items()}
    rows, cal = [], []
    for k, p in preds.items():
        r = dict(key, outcome=outcome, model=k, n_train=len(tr), n_test=len(te), events_train=int(ytr.sum()), events_test=int(yte.sum()), base_rate_train=p0, test_rate=float(yte.mean()),
                 test_brier=float(sq[k].mean()), test_logloss=float(loss[k].mean()), test_auc=float(roc_auc_score(yte, p)) if 0 < yte.sum() < len(yte) else None, mean_pred=float(p.mean()))
        for ref in ("base_rate", "logit_player", "gbm_player", "logit_ctx"):
            if ref not in preds or k == ref: continue
            if ref == "logit_player" and k not in ("logit_ctx", "gbm_ctx", "gbm_player"): continue
            if ref == "gbm_player" and k != "gbm_ctx": continue
            if ref == "logit_ctx" and k != "gbm_ctx": continue
            g, lo, hi = P.cluster_gain(loss[ref], loss[k], pl); r[f"logloss_gain_vs_{ref}"] = g; r[f"logloss_gain_vs_{ref}_lo"] = lo; r[f"logloss_gain_vs_{ref}_hi"] = hi
            g, lo, hi = P.cluster_gain(sq[ref], sq[k], pl); r[f"brier_gain_vs_{ref}"] = g; r[f"brier_gain_vs_{ref}_lo"] = lo; r[f"brier_gain_vs_{ref}_hi"] = hi
        if 0 < yte.sum() < len(yte) and k != "base_rate":
            try:
                lg = np.log(p / (1 - p)); cr = sm.Logit(yte, sm.add_constant(lg)).fit(disp=0); r["cal_intercept"] = float(cr.params[0]); r["cal_slope"] = float(cr.params[1])
            except Exception: pass
        rows.append(r)
        if k in ("logit_ctx", "gbm_ctx") and len(te) >= 400:
            nb = 10 if len(te) >= 2000 else 5
            for b in cal_table(p, yte, nb).itertuples():
                cal.append(dict(key, outcome=outcome, model=k, bin=int(b.b) + 1, n_bins=nb, mean_pred=float(b.mean_pred), obs_rate=float(b.obs), n=int(b.n)))
    return rows, cal


def qr_params(X, y, q):
    import statsmodels.api as sm
    return sm.QuantReg(y, X).fit(q=q, max_iter=3000).params


def quantile_models(s, tr, te, key, rng):
    """dev quantiles p75/p90: context shifts (all rows, player-cluster bootstrap) + test pinball vs unconditional / controls-only."""
    rows, perf = [], []
    st = ctrl_stats(s); X = drop_const(make_X(s, "ctx_full", st)); y = s.dev.to_numpy(float); cl = pd.factorize(s.player_id)[0]
    ctx = CTX_TERMS(X); order = np.argsort(cl, kind="stable"); cnt = np.bincount(cl); off = np.concatenate([[0], np.cumsum(cnt)]); C = len(cnt)
    Xa = X.to_numpy()
    st2 = ctrl_stats(tr)
    Xtr = drop_const(make_X(tr, "ctx_full", st2)); Xte = make_X(te, "ctx_full", st2)[Xtr.columns]; Ptr = drop_const(make_X(tr, "player", st2)); Pte = make_X(te, "player", st2)[Ptr.columns]
    for q in (0.75, 0.90):
        b = qr_params(Xa, y, q); bs = []
        for _ in range(BOOT_Q):
            draw = rng.integers(0, C, C); ii = np.concatenate([order[off[c]:off[c + 1]] for c in draw])
            try: bs.append(qr_params(Xa[ii], y[ii], q))
            except Exception: pass
        bs = np.array(bs)
        for i, c in enumerate(X.columns):
            if c not in ctx: continue
            rows.append(dict(key, outcome=f"dev_q{int(q * 100)}", model=f"quantreg_p{int(q * 100)}", term=c, scale="pts_quantile_shift", estimate=float(b[i]), ci_low=float(np.percentile(bs[:, i], 2.5)), ci_high=float(np.percentile(bs[:, i], 97.5)),
                             p_value=None, base_rate=float(np.quantile(y, q)), n_games=len(s), n_events=None,
                             notes=f"shift in the {int(q * 100)}th percentile of (PTS - prior avg) vs middle-10 defences/pace, adjusted for prior avg, usage, minutes, season progress, role, position; 95% CI = percentile of {len(bs)} player-cluster bootstrap refits"))
        if len(tr) >= 400 and len(te) >= 100:
            bt = qr_params(Xtr.to_numpy(), tr.dev.to_numpy(float), q); bp = qr_params(Ptr.to_numpy(), tr.dev.to_numpy(float), q); yt = te.dev.to_numpy(float); q0 = float(np.quantile(tr.dev, q))
            pin = lambda e: float(np.mean(np.maximum(q * e, (q - 1) * e)))
            pc, pp = Xte.to_numpy() @ bt, Pte.to_numpy() @ bp
            lc, lp, l0 = np.maximum(q * (yt - pc), (q - 1) * (yt - pc)), np.maximum(q * (yt - pp), (q - 1) * (yt - pp)), np.maximum(q * (yt - q0), (q - 1) * (yt - q0))
            pl = te.player_id.to_numpy(); r = dict(key, outcome=f"dev_q{int(q * 100)}", model="quantreg_ctx", n_train=len(tr), n_test=len(te), test_pinball=float(lc.mean()), test_coverage=float((yt <= pc).mean()), target_coverage=q,
                                                  pinball_unconditional=float(l0.mean()), pinball_player_only=float(lp.mean()))
            for nm, ref in (("unconditional", l0), ("player_only", lp)):
                g, lo, hi = P.cluster_gain(ref, lc, pl); r[f"pinball_gain_vs_{nm}"] = g; r[f"pinball_gain_vs_{nm}_lo"] = lo; r[f"pinball_gain_vs_{nm}_hi"] = hi
            perf.append(r)
            g, lo, hi = P.cluster_gain(l0, lp, pl)
            perf.append(dict(key, outcome=f"dev_q{int(q * 100)}", model="quantreg_player_only", n_train=len(tr), n_test=len(te), test_pinball=float(lp.mean()), test_coverage=float((yt <= pp).mean()), target_coverage=q,
                             pinball_unconditional=float(l0.mean()), pinball_gain_vs_unconditional=g, pinball_gain_vs_unconditional_lo=lo, pinball_gain_vs_unconditional_hi=hi))
    return rows, perf


# ------------------------------------------------------------------ 4. dispersion (SD of PTS - prior avg)
def sd_boot(a_stats, b_stats, rng):
    C = a_stats.shape[0]; idx = rng.integers(0, C, size=(BOOT_SD, C))
    def sd(S):
        T = S[idx].sum(1); n, s1, s2 = T[:, 0], T[:, 1], T[:, 2]
        return np.sqrt(np.maximum((s2 - s1 ** 2 / n) / (n - 1), 0))
    r = sd(a_stats) / sd(b_stats)
    return np.percentile(r, 2.5), np.percentile(r, 97.5)


def dispersion_rows(s, key, rng):
    cl = pd.factorize(s.player_id)[0]; C = cl.max() + 1; d = s.dev.to_numpy(float); rows = []
    def pstats(mask):
        return np.column_stack([np.bincount(cl[mask], minlength=C), np.bincount(cl[mask], weights=d[mask], minlength=C), np.bincount(cl[mask], weights=d[mask] ** 2, minlength=C)]).astype(float)
    dt = s.def_tier; conds = [("worst5", (dt == "worst5").to_numpy(), "middle", (dt == "middle").to_numpy()), ("worst10", dt.isin(["worst5", "worst6_10"]).to_numpy(), "middle", (dt == "middle").to_numpy()),
                              ("best10", dt.isin(["best5", "best6_10"]).to_numpy(), "middle", (dt == "middle").to_numpy()), ("best5", (dt == "best5").to_numpy(), "middle", (dt == "middle").to_numpy()),
                              ("worst10_vs_best10", dt.isin(["worst5", "worst6_10"]).to_numpy(), "best10", dt.isin(["best5", "best6_10"]).to_numpy()),
                              ("home", (s.home == 1).to_numpy(), "away", (s.home == 0).to_numpy()), ("b2b_2nd", (s.b2b_state == "2nd").to_numpy(), "rested", (s.b2b_state == "rested").to_numpy()),
                              ("b2b_1st", (s.b2b_state == "1st").to_numpy(), "rested", (s.b2b_state == "rested").to_numpy())]
    for name, ma, rn, mb in conds:
        if ma.sum() < 30 or mb.sum() < 30: continue
        sa, sb = d[ma].std(ddof=1), d[mb].std(ddof=1); lo, hi = sd_boot(pstats(ma), pstats(mb), rng)
        try: lev = float(stats.levene(d[ma], d[mb], center="median").pvalue)
        except Exception: lev = None
        # upper-tail dispersion: share of games >= prior+10 and the 90th percentile of dev
        rows.append(dict(key, condition=name, reference=rn, n_condition=int(ma.sum()), n_reference=int(mb.sum()), sd_condition=float(sa), sd_reference=float(sb), sd_ratio=float(sa / sb), ci_low=float(lo), ci_high=float(hi),
                         levene_p_naive=lev, p90_dev_condition=float(np.quantile(d[ma], 0.9)), p90_dev_reference=float(np.quantile(d[mb], 0.9)),
                         n_players=int(len(np.unique(cl[ma | mb]))), thin_level=thin_level(int(ma.sum()), int(len(np.unique(cl[ma])))),
                         notes="SD of (PTS - prior season-to-date avg); ratio CI = percentile of 500 player-cluster bootstrap resamples; Levene (Brown-Forsythe) p ignores player clustering (naive, anti-conservative)"))
    return rows


# ------------------------------------------------------------------ cell runner
def cell_members(ts, seg):
    spec = hab.TIMESPANS[ts]; cut = CUTS[ts]
    g = G_ALL[G_ALL.season.isin(spec["seasons"])]; share = len(g[g.game_date < cut]) / len(g)
    floor_tr = None if FLOORS[ts] is None else max(1, int(math.ceil(FLOORS[ts] * share)))
    return hab.segment_members(hab.rank_table(G_ALL[G_ALL.game_date < cut], ts, floor_tr))[seg]


def run_cell(task):
    ts, seg = task; t0 = time.time(); warnings.filterwarnings("ignore")
    rng = np.random.default_rng(SEED + hash((ts, seg)) % 10_000)
    spec = hab.TIMESPANS[ts]; cut = CUTS[ts]
    w = WM[WM.season.isin(spec["seasons"])]; mem = cell_members(ts, seg); sub = w[w.player_id.isin(mem)].reset_index(drop=True)
    tr, te = sub[sub.game_date < cut].reset_index(drop=True), sub[sub.game_date >= cut].reset_index(drop=True)
    n_games, n_players = int(len(sub)), int(sub.player_id.nunique()); thin = thin_level(n_games, n_players)
    key = dict(timespan=ts, segment=seg, n_cell_games=n_games, n_cell_players=n_players, thin_flag=thin)
    out = dict(tier=[], spline=[], tail=[], perf=[], cal=[], disp=[], log=dict(ts=ts, seg=seg, n_games=n_games, n_players=n_players, thin=thin, train=len(tr), test=len(te), cutoff=str(cut.date()), notes=[]))
    L = out["log"]["notes"]
    if n_games < 200 or n_players < 8:
        L.append("cell too small: nothing fitted"); return out, time.time() - t0
    for name, fn in (("tier", lambda: tier_rows(sub, key)), ("disp", lambda: dispersion_rows(sub, key, rng))):
        try: out[name] = fn()
        except Exception as e: L.append(f"{name} failed: {type(e).__name__}: {e}")
    if n_games >= 600 and n_players >= 15:
        try: out["spline"] += nonlinearity_tests(sub, key) + curves(sub, key)
        except Exception as e: L.append(f"spline/nonlinearity failed: {type(e).__name__}: {e}")
        if len(tr) >= 300 and len(te) >= 100:
            try: out["spline"] += mean_model_compare(tr, te, key)
            except Exception as e: L.append(f"mean_model_compare failed: {type(e).__name__}: {e}")
    for o in BIG:
        ev = int(sub[o].sum()); kind = "ctx_full" if ev >= MIN_EVENTS_FULL and n_games >= 800 else ("ctx_nested" if ev >= MIN_EVENTS_NESTED else None)
        if kind is None:
            L.append(f"{o}: {ev} events -> logistic not fitted"); continue
        try:
            rr, _ = logit_effects(sub, o, kind, key, rng); out["tail"] += rr
            if kind == "ctx_full" and ev >= 200:       # also the nested bottom-10/top-10 spec (answers the 'bottom 10' question directly)
                rr, _ = logit_effects(sub, o, "ctx_nested", key, rng); out["tail"] += rr
            if len(tr) >= 300 and len(te) >= 100 and tr[o].sum() >= 30:
                pf, cal = tail_perf(tr, te, o, key, kind); out["perf"] += pf; out["cal"] += cal
        except Exception as e: L.append(f"{o} tail failed: {type(e).__name__}: {e}")
    if n_games >= 800 and n_players >= 15:
        try:
            rr, pf = quantile_models(sub, tr, te, key, rng); out["tail"] += rr; out["perf"] += pf
        except Exception as e: L.append(f"quantile failed: {type(e).__name__}: {e}")
    return out, time.time() - t0


# ------------------------------------------------------------------ 5. interactions (segment x condition, position/role/usage/minutes x condition)
GRP_LEVELS = ["rest", "51_100", "26_50", "11_25", "1_10"]
COND_CTRL = {"worst10": ["def_best10", "home", "b2b_2nd", "b2b_1st", "opp_b2b"], "worst5": ["def_best10", "home", "b2b_2nd", "b2b_1st", "opp_b2b"], "best10": ["def_worst10", "home", "b2b_2nd", "b2b_1st", "opp_b2b"],
             "home": ["def_worst10", "def_best10", "b2b_2nd", "b2b_1st", "opp_b2b"], "b2b_2nd": ["def_worst10", "def_best10", "home", "b2b_1st", "opp_b2b"]}


def flag_cols(s):
    f = pd.DataFrame(index=s.index)
    f["worst10"] = s.def_tier.isin(["worst5", "worst6_10"]).astype(float); f["worst5"] = (s.def_tier == "worst5").astype(float); f["best10"] = s.def_tier.isin(["best5", "best6_10"]).astype(float)
    f["def_worst10"], f["def_best10"] = f["worst10"], f["best10"]; f["home"] = s.home.astype(float); f["b2b_2nd"] = (s.b2b_state == "2nd").astype(float); f["b2b_1st"] = (s.b2b_state == "1st").astype(float)
    f["opp_b2b"] = s.opp_b2b.astype(float); f["prior_avg_z"] = (s.prior_avg - s.prior_avg.mean()) / s.prior_avg.std(); f["prog_z"] = (s.prog_log - s.prog_log.mean()) / s.prog_log.std()
    return f


def inter_fit(s, F, cond, outcome, model, grp, levels, key):
    import statsmodels.api as sm
    cl = pd.factorize(s.player_id)[0]; y = s[outcome].to_numpy(float); c = F[cond].to_numpy()
    cols = {"const": np.ones(len(s)), cond: c}
    for l in levels[1:]:
        g = (grp == l).to_numpy(float); cols[f"g_{l}"] = g; cols[f"c_x_{l}"] = c * g
    for k in COND_CTRL[cond] + ["prior_avg_z", "prog_z"]: cols[k] = F[k].to_numpy()
    X = pd.DataFrame(cols, index=s.index)
    present = [l for l in levels if (grp == l).sum() > 0]
    drop = [l for l in levels[1:] if l not in present]
    X = X.drop(columns=[f"g_{l}" for l in drop] + [f"c_x_{l}" for l in drop])
    try:
        mod = sm.Logit(y, X.to_numpy()) if model == "logit" else sm.OLS(y, X.to_numpy())
        res = mod.fit(disp=0, cov_type="cluster", cov_kwds={"groups": cl}) if model == "logit" else mod.fit(cov_type="cluster", cov_kwds={"groups": cl})
    except Exception as e:
        return []
    names = list(X.columns); b, V = np.asarray(res.params), np.asarray(res.cov_params()); i0 = names.index(cond)
    inter_idx = [i for i, n in enumerate(names) if n.startswith("c_x_")]
    pint = None
    if inter_idx:
        Rm = np.zeros((len(inter_idx), len(names))); Rm[np.arange(len(inter_idx)), inter_idx] = 1
        try: pint = float(res.wald_test(Rm, scalar=True, use_f=False).pvalue)
        except Exception: pass
    rows = []
    for l in present:
        L = np.zeros(len(names)); L[i0] = 1
        if l != levels[0]: L[names.index(f"c_x_{l}")] = 1
        est, se = float(L @ b), float(np.sqrt(L @ V @ L))
        m = (grp == l).to_numpy()
        scale = {"ols": "pts", "lpm": "prob_diff", "logit": "odds_ratio"}[model]
        e, lo, hi = (est, est - 1.96 * se, est + 1.96 * se) if model != "logit" else (math.exp(est), math.exp(est - 1.96 * se), math.exp(est + 1.96 * se))
        rows.append(dict(key, condition=cond, outcome=outcome, model=model, level=l, scale=scale, estimate=e, ci_low=lo, ci_high=hi, interaction_p=pint, n_games_level=int(m.sum()),
                         n_players_level=int(s.player_id[m].nunique()), thin_level=thin_level(int(m.sum()), int(s.player_id[m].nunique())), n_events_level=int(s.loc[m, outcome].sum()) if outcome != "dev" else None))
    return rows


def run_inter(ts):
    warnings.filterwarnings("ignore"); t0 = time.time(); cut = CUTS[ts]; spec = hab.TIMESPANS[ts]
    g = G_ALL[G_ALL.season.isin(spec["seasons"])]; share = len(g[g.game_date < cut]) / len(g)
    floor_tr = None if FLOORS[ts] is None else max(1, int(math.ceil(FLOORS[ts] * share)))
    rt = hab.rank_table(G_ALL[G_ALL.game_date < cut], ts, floor_tr).set_index("player_id")["rank"]
    s = WM[WM.season.isin(spec["seasons"])].reset_index(drop=True)
    rk = s.player_id.map(rt)
    s["ppg_rank_group"] = np.select([rk <= 10, rk <= 25, rk <= 50, rk <= 100], ["1_10", "11_25", "26_50", "51_100"], "rest")
    F = flag_cols(s); rows = []
    mods = {"ppg_rank_group": (s.ppg_rank_group, GRP_LEVELS), "position": (s.pos, ["C", "F", "G"]), "usage_tier": (s.usage_tier, DD.USG_TIERS), "minutes_tier": (s.min_tier, DD.MIN_TIERS), "role": (s.role, ["bench", "starter"])}
    for mod, (grp, levels) in mods.items():
        key = dict(timespan=ts, moderator=mod)
        for cond in COND_CTRL:
            for outcome, models in (("dev", ["ols"]), ("big5", ["lpm"]), ("big10", ["lpm", "logit"]), ("x125", ["lpm", "logit"])):
                for m in models:
                    rows += inter_fit(s, F, cond, outcome, m, grp, levels, key)
    return ("inter", ts), rows, time.time() - t0


def run_mixed(task):
    """MixedLM: random intercept + random slope on bottom-10 defence per player.  statsmodels lbfgs is unreliable here -> bfgs/powell; convergence + stability reported."""
    warnings.filterwarnings("ignore")
    import statsmodels.formula.api as smf
    ts, seg = task; t0 = time.time(); spec = hab.TIMESPANS[ts]; mem = cell_members(ts, seg)
    s = WM[WM.season.isin(spec["seasons"]) & WM.player_id.isin(mem)].reset_index(drop=True); F = flag_cols(s)
    d = pd.concat([s[["player_id", "dev", "big10", "x125"]], F[["def_worst10", "def_best10", "home", "b2b_2nd", "b2b_1st", "opp_b2b", "prior_avg_z", "prog_z"]]], axis=1)
    rows = []; key = dict(timespan=ts, segment=seg, moderator="player_random_slope")
    for outcome in ("dev", "big10", "x125"):
        f = f"{outcome} ~ def_worst10 + def_best10 + home + b2b_2nd + b2b_1st + opp_b2b + prior_avg_z + prog_z"
        try:
            ols = smf.ols(f, d).fit(cov_type="cluster", cov_kwds={"groups": pd.factorize(d.player_id)[0]})
            m = smf.mixedlm(f, d, groups=d.player_id, re_formula="~def_worst10").fit(method=["bfgs", "powell"], maxiter=300)
            cov = np.asarray(m.cov_re); fe = float(m.fe_params["def_worst10"]); se = float(m.bse_fe["def_worst10"])
            sd_i, sd_s = math.sqrt(max(cov[0, 0], 0)), math.sqrt(max(cov[1, 1], 0)); corr = float(cov[0, 1] / (sd_i * sd_s)) if sd_i > 0 and sd_s > 0 else None
            stable = bool(m.converged and np.isfinite(se) and sd_s > 0 and (corr is None or abs(corr) < 0.99) and abs(fe - float(ols.params["def_worst10"])) < 3 * float(ols.bse["def_worst10"]) + 0.05)
            scale = "pts" if outcome == "dev" else "prob_diff"
            base = dict(key, condition="worst10", outcome=outcome, model="mixedlm_random_slope", scale=scale, n_games_level=len(d), n_players_level=int(d.player_id.nunique()),
                        thin_level=thin_level(len(d), int(d.player_id.nunique())), stable=stable)
            rows.append(dict(base, level="fixed_effect_worst10", estimate=fe, ci_low=fe - 1.96 * se, ci_high=fe + 1.96 * se,
                             notes=f"converged={m.converged}; OLS player-clustered same spec: {float(ols.params['def_worst10']):+.4f} [{float(ols.conf_int().loc['def_worst10', 0]):+.4f}, {float(ols.conf_int().loc['def_worst10', 1]):+.4f}]; slope-intercept corr={corr}"))
            rows.append(dict(base, level="random_slope_sd_worst10", estimate=sd_s, ci_low=None, ci_high=None, notes=f"SD across players of the bottom-10-defence effect (same units); random-intercept SD={sd_i:.4f}; stable={stable}"))
        except Exception as e:
            rows.append(dict(key, condition="worst10", outcome=outcome, model="mixedlm_random_slope", level="fixed_effect_worst10", stable=False, notes=f"failed: {type(e).__name__}: {e}"))
    return ("mixed", ts, seg), rows, time.time() - t0


# ------------------------------------------------------------------ 6. per-player depth (shrunk effects, FDR + watch flags)
PLAYER_CONDS = {  # name -> (a-mask fn, b-mask fn, min a, min b, min a (2026-27), min b (2026-27))
    "worst5": (lambda x: x.def_tier == "worst5", lambda x: x.def_tier != "worst5", 5, 10, 3, 5),
    "worst10": (lambda x: x.def_tier.isin(["worst5", "worst6_10"]), lambda x: ~x.def_tier.isin(["worst5", "worst6_10"]), 8, 10, 3, 5),
    "home_vs_away": (lambda x: x.home == 1, lambda x: x.home == 0, 8, 8, 3, 3),
    "b2b_2nd_vs_rested": (lambda x: x.b2b_state == "2nd", lambda x: x.b2b_state == "rested", 5, 10, 2, 5),
}


def player_deep(WMf, G, floors, ts):
    spec = hab.TIMESPANS[ts]; rt = hab.rank_table(G, ts, floors[ts]).set_index("player_id"); mem = hab.segment_members(rt.reset_index())
    x = WMf[WMf.season.isin(spec["seasons"])]; rows = []; summ = []
    elig = set(rt.index[rt.gp >= floors[ts]])
    names = G.groupby("player_id").full_name.last()
    for cond, (fa, fb, ma, mb, ma26, mb26) in PLAYER_CONDS.items():
        if ts == "2026_27": ma, mb = ma26, mb26
        part = {o: [] for o in OUTCOMES}
        for pid, xp in x[x.player_id.isin(elig)].groupby("player_id"):
            a, b = xp[fa(xp)], xp[fb(xp)]
            if len(a) < ma or len(b) < mb: continue
            for o in OUTCOMES:
                ya, yb = a[o].to_numpy(float), b[o].to_numpy(float); na, nb = len(ya), len(yb)
                if o == "dev":
                    d = ya.mean() - yb.mean(); sd = xp.dev.std(ddof=1); se = sd * math.sqrt(1 / na + 1 / nb)
                else:
                    pa, pb = (ya.sum() + 1) / (na + 2), (yb.sum() + 1) / (nb + 2)
                    d = ya.mean() - yb.mean(); se = math.sqrt(pa * (1 - pa) / (na + 2) + pb * (1 - pb) / (nb + 2))
                part[o].append(dict(timespan=ts, condition=cond, outcome=o, player_id=pid, player_name=names.get(pid), position=xp.pos.iloc[-1], n_games_eligible=len(xp), n_cond=na, n_ref=nb,
                                    mean_cond=float(ya.mean()), mean_ref=float(yb.mean()), raw_diff=float(d), se=float(se)))
        for o in OUTCOMES:
            q = pd.DataFrame(part[o])
            if len(q) == 0: continue
            dd, se = q.raw_diff.to_numpy(), q.se.to_numpy(); mu = float(dd.mean()); tau2 = dl_tau2(dd, se)
            w = np.where(se > 0, tau2 / (tau2 + se ** 2), 1.0)
            var_mu = 1.0 / float(np.sum(1.0 / (tau2 + se ** 2)))          # uncertainty of the pooled mean (matters when tau = 0 and every player is shrunk onto it)
            q["shrunk_diff"] = mu + w * (dd - mu); q["shrink_weight"] = w; sse = np.sqrt(w * se ** 2 + (1 - w) ** 2 * var_mu)
            q["shrunk_ci_low"] = q.shrunk_diff - 1.96 * sse; q["shrunk_ci_high"] = q.shrunk_diff + 1.96 * sse
            q["raw_ci_low"] = dd - 1.96 * se; q["raw_ci_high"] = dd + 1.96 * se
            q["z"] = (dd - mu) / se; q["p"] = 2 * stats.norm.sf(np.abs(q.z)); q["q"] = bh(q.p.to_numpy())
            strong = (q.q < Q_STRONG).to_numpy(); watch = ((q.z.abs() >= Z_WATCH).to_numpy()) & ~strong
            q["flag"] = np.where(strong, np.where(dd > mu, "higher_strong", "lower_strong"), np.where(watch, np.where(dd > mu, "higher_watch", "lower_watch"), None))
            q["credible_up"] = (q.shrunk_ci_low > 0).to_numpy(); q["credible_down"] = (q.shrunk_ci_high < 0).to_numpy()      # interval (incl. pooled-mean uncertainty) excludes 0: mostly the SHARED league effect
            q["league_mean_se"] = math.sqrt(var_mu); q["league_mean_ci_low"] = mu - 1.96 * math.sqrt(var_mu); q["league_mean_ci_high"] = mu + 1.96 * math.sqrt(var_mu)
            hw = 1.96 * np.sqrt(w) * se      # player-specific evidence only: shrunk interval that excludes the league mean = this player differs from the typical player
            q["credible_above_league"] = ((q.shrunk_diff - hw) > mu).to_numpy(); q["credible_below_league"] = ((q.shrunk_diff + hw) < mu).to_numpy()
            for sid in ("top10", "top25", "top50", "top100"): q[f"in_{sid}"] = q.player_id.isin(mem[sid])
            q["league_mean_diff"] = mu; q["tau"] = math.sqrt(tau2); q["provisional"] = ts == "2026_27"; q["min_cond_games"] = ma; q["min_ref_games"] = mb
            rows.append(q)
            k = len(q)
            summ.append(dict(timespan=ts, condition=cond, outcome=o, n_players=k, league_mean_diff=mu, tau=math.sqrt(tau2), median_se=float(np.median(se)), n_flag_strong_q10=int(strong.sum()), n_flag_watch_z25=int(watch.sum()),
                             expected_watch_by_chance=float(k * 2 * stats.norm.sf(Z_WATCH)), n_p_lt_05=int((q.p < 0.05).sum()), expected_p_lt_05_by_chance=0.05 * k, n_credible_up=int(q.credible_up.sum()), n_credible_down=int(q.credible_down.sum()),
                             n_stars_top25=int(q.in_top25.sum()), n_stars_top50=int(q.in_top50.sum()),
                             n_credible_up_top25=int((q.credible_up & q.in_top25).sum()), n_credible_up_top50=int((q.credible_up & q.in_top50).sum()),
                             n_credible_down_top50=int((q.credible_down & q.in_top50).sum()),
                             league_mean_ci_low=float(mu - 1.96 * math.sqrt(var_mu)), league_mean_ci_high=float(mu + 1.96 * math.sqrt(var_mu)),
                             n_above_league=int(q.credible_above_league.sum()), n_below_league=int(q.credible_below_league.sum()),
                             n_above_league_top25=int((q.credible_above_league & q.in_top25).sum()), n_above_league_top50=int((q.credible_above_league & q.in_top50).sum()),
                             n_below_league_top50=int((q.credible_below_league & q.in_top50).sum()), provisional=ts == "2026_27"))
    return pd.concat(rows, ignore_index=True), pd.DataFrame(summ)


# ------------------------------------------------------------------ main
def _dispatch(task):
    kind = task[0]
    if kind == "cell":
        out, dt = run_cell(task[1]); return ("cell", task[1]), out, dt
    if kind == "inter": return run_inter(task[1])
    return run_mixed(task[1:])


def main():
    global WM, G_ALL, FLOORS, CUTS, META
    ap = argparse.ArgumentParser(); ap.add_argument("--through", default="2026-11-09"); ap.add_argument("--workers", type=int, default=8); ap.add_argument("--cache", default="/tmp/deep"); ap.add_argument("--only", default="")
    a = ap.parse_args(); warnings.filterwarnings("ignore")
    t0 = time.time(); d = DD.build(a.through)
    WM, G_ALL, FLOORS, CUTS = d["WM"], d["G"], d["floors"], d["CUTS"]; WM["prog_log"] = np.log(WM.n_prior_season.astype(float)); META = d["info"]
    print("data ready", len(WM), f"{time.time() - t0:.0f}s", flush=True)
    cells = [("cell", (ts, sg)) for ts in hab.TIMESPANS for sg in hab.SEGMENT_IDS]
    inter = [("inter", ts) for ts in hab.TIMESPANS]
    mixed = [("mixed", ts, sg) for ts in ("pooled_2023_26", "pooled_2023_27") for sg in ("all", "top100", "top50")]
    size = lambda t: len(WM[WM.season.isin(hab.TIMESPANS[t[1][0] if t[0] == "cell" else t[1]]["seasons"])]) * ({"all": 1, "top100": .3, "top50": .15, "top25": .08, "top10": .04}[t[1][1]] if t[0] == "cell" else 1)
    tasks = sorted(cells + inter + mixed, key=lambda t: -(size(t) if t[0] != "mixed" else 1e9))
    tasks = [t for t in tasks if not a.only or a.only in str(t)]
    res = {}
    with Pool(a.workers) as pool:
        for k, out, dt in pool.imap_unordered(_dispatch, tasks):
            res[k] = out; print("done", k, f"{dt:.0f}s", f"({len(res)}/{len(tasks)}, {time.time() - t0:.0f}s elapsed)", flush=True)
    pd.to_pickle(res, f"{a.cache}_results.pkl")
    return res, d


if __name__ == "__main__":
    main()
