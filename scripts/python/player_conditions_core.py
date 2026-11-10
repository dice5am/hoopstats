"""Player x condition study (hoopstats, 2026-11-10): shared core.
Per player, for every condition (home/away, B2B, rest, defence / pace tiers, opponent form, teammates out, bounce-back, hot game, minutes / role, season phase):
  effect = (mean outcome in the condition) - (mean outcome in the reference games), for that player, on the big-nights dataset (8 PPG floor on the prior season-to-date average, >= 5 prior games).
Outcomes: dev = points minus prior season-to-date average; big-night indicators x125 / x150 / x200 (pts >= k * avg) and p10 (pts >= avg + 10).
Empirical Bayes: DerSimonian-Laird tau^2 per timespan x segment x condition x outcome, random-effects league mean, shrunk estimate + posterior interval.
"""
from __future__ import annotations
import math, sys
from pathlib import Path
import numpy as np
import pandas as pd
from scipy import stats

sys.path.insert(0, str(Path(__file__).resolve().parent))
import analysis_home_away_b2b as hab
import big_nights_analysis as B

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "data" / "cache" / "pc"; CACHE.mkdir(parents=True, exist_ok=True)
OUTCOMES = ["dev", "x125", "x150", "x200", "p10"]
OUT_COL = {"dev": "dev_std", "x125": "e_x125_std", "x150": "e_x150_std", "x200": "e_x200_std", "p10": "e_p10_std"}
OUT_LABEL = {"dev": "points minus prior average (pts)", "x125": "big night 1.25x (pp rate)", "x150": "big night 1.5x (pp rate)", "x200": "big night 2.0x (pp rate)", "p10": "big night +10 (pp rate)"}
MAIN_OUTCOMES = ["dev", "x150", "p10"]
FLOOR = 8.0
MIN_N = (10, 10); MIN_N_2627 = (3, 3); MIN_N_HALF = (5, 5)
MIN_N_STRONG = 15            # a 'strong' flag needs at least this many games on both sides (watch needs only the inclusion minimum)
MIN_N_RANK = 15              # top-responder tables: at least this many games on both sides
Z_STRONG, Z_WATCH = 1.96, 1.645
SEGS_EB = ["all", "top100", "top50"]          # segments with their own EB parameters (>= 30 players); top25 / top10 are thin: they reuse the top50 parameters
SEGS_ALL = ["all", "top100", "top50", "top25", "top10"]
TS_ORDER = ["pooled_2023_27", "pooled_2023_26", "2023_24", "2024_25", "2025_26", "2026_27"]
AUX_TS = {"pooled_2023_25": {"seasons": ["2023-24", "2024-25"], "label": "2023-24 + 2024-25 (training period for the persistence test; not an app timespan)"}}
ALL_TS = TS_ORDER + list(AUX_TS)
PROVISIONAL = {"pooled_2023_27", "2026_27"}
TEST_OF = {"pooled_2023_25": "2025_26", "2023_24": "2024_25", "2024_25": "2025_26", "2025_26": "2026_27", "pooled_2023_26": "2026_27"}   # later period used for held_out_of_sample

# id -> (group, label, condition spec, reference spec)  (spec: flag id | '~' complement of the condition | 'not:a,b' neither of)
CONDS = [
    ("home", "venue", "home game", "home", "away"),
    ("b2b_2nd", "rest", "2nd night of a back-to-back (vs rested)", "b2b_2nd", "b2b_rested"),
    ("b2b_1st", "rest", "1st night of a back-to-back (vs rested)", "b2b_1st", "b2b_rested"),
    ("rest_r0", "rest", "0 rest days (vs other rest)", "rest_r0", "~"),
    ("rest_r1", "rest", "1 rest day (vs other rest)", "rest_r1", "~"),
    ("rest_r2", "rest", "2 rest days (vs other rest)", "rest_r2", "~"),
    ("rest_r3plus", "rest", "3+ rest days (vs other rest)", "rest_r3plus", "~"),
    ("def_worst5", "opp_defence", "opponent worst-5 defence", "def_worst5", "~"),
    ("def_worst10", "opp_defence", "opponent worst-10 defence", "def_worst10", "~"),
    ("def_best10", "opp_defence", "opponent best-10 defence", "def_best10", "~"),
    ("def_best5", "opp_defence", "opponent best-5 defence", "def_best5", "~"),
    ("pace_fast10", "opp_pace", "opponent fastest-10 pace", "pace_fast10", "~"),
    ("pace_slow10", "opp_pace", "opponent slowest-10 pace", "pace_slow10", "~"),
    ("opp_leaky_l5", "opp_form", "opponent last-5 DRtg 3+ worse than its season (vs neutral band)", "opp_leaky_l5", "not:opp_leaky_l5,opp_tight_l5"),
    ("opp_tight_l5", "opp_form", "opponent last-5 DRtg 3+ better than its season (vs neutral band)", "opp_tight_l5", "not:opp_leaky_l5,opp_tight_l5"),
    ("opp_leaky_l1", "opp_form", "opponent last-game DRtg 10+ worse (vs neutral band)", "opp_leaky_l1", "not:opp_leaky_l1,opp_tight_l1"),
    ("opp_tight_l1", "opp_form", "opponent last-game DRtg 10+ better (vs neutral band)", "opp_tight_l1", "not:opp_leaky_l1,opp_tight_l1"),
    ("vac_any", "teammates_out", "any regular teammate out (vs none)", "vac_any", "vac_none"),
    ("vac_large", "teammates_out", "regulars out total 20+ prior PPG (vs none)", "vac_large", "vac_none"),
    ("vac_star", "teammates_out", "a 20+ PPG teammate out (vs other)", "vac_star", "~"),
    ("out_top1", "teammates_out", "team's top scorer out (vs other)", "out_top1", "~"),
    ("bb_last1", "bounce_back", "after a weak last game (<0.75x avg)", "bb_last1", "~"),
    ("hot_last1", "hot_game", "after a hot last game (>=1.25x avg)", "hot_last1", "~"),
    ("min_up3", "minutes_role", "recent minutes trend up (last-5 3+ above season)", "min_up3", "not:min_up3,min_dn3"),
    ("min_dn3", "minutes_role", "recent minutes trend down (last-5 3+ below season)", "min_dn3", "not:min_up3,min_dn3"),
    ("role_promoted", "minutes_role", "recently promoted to the starting five", "role_promoted", "not:role_promoted,role_demoted"),
    ("role_demoted", "minutes_role", "recently demoted from the starting five", "role_demoted", "not:role_promoted,role_demoted"),
    ("early_vs_late", "season_phase", "early season (Oct-Nov) vs late season (Mar-Apr)", "phase_early", "phase_late"),
]
COND_IDS = [c[0] for c in CONDS]; COND_GROUP = {c[0]: c[1] for c in CONDS}; COND_LABEL = {c[0]: c[2] for c in CONDS}

WM = None; NAMES = None; PID = None; PLAYERS = None; Y_AUG = None; MASKS = None; MEMBERS = {}


def init():
    """Load the big-nights dataset (floor 8, std baseline), build the condition masks, and the segment members per timespan."""
    global WM, NAMES, PID, PLAYERS, Y_AUG, MASKS, MEMBERS
    B.init()
    w = B.WM; w = w[(w.avg_std >= FLOOR)].sort_values(["player_id", "game_date", "game_id"]).reset_index(drop=True)
    assert all(w[OUT_COL[o]].notna().all() for o in OUTCOMES)
    WM = w; NAMES = B.G_ALL.groupby("player_id").full_name.last().to_dict()
    PLAYERS = np.sort(w.player_id.unique()); PID = np.searchsorted(PLAYERS, w.player_id.to_numpy())
    Y = np.stack([w[OUT_COL[o]].to_numpy(float) for o in OUTCOMES], 1); Y_AUG = np.concatenate([Y, Y ** 2], 1)
    f = B.flags(w); MASKS = {}
    for cid, grp, lab, cs, rs in CONDS:
        a = f[cs]
        if rs == "~": b = ~a
        elif rs.startswith("not:"): b = ~np.any([f[k] for k in rs[4:].split(",")], axis=0)
        else: b = f[rs]
        b = b & ~a
        MASKS[cid] = (a.astype(bool), b.astype(bool))
    for ts in TS_ORDER:
        MEMBERS[ts] = {sg: np.isin(PLAYERS, list(B.cell_members(ts, sg))) for sg in SEGS_ALL}
    for ts in AUX_TS: MEMBERS[ts] = MEMBERS["pooled_2023_26"]
    MEMBERS["pooled_2023_26_odd"] = MEMBERS["pooled_2023_26_even"] = MEMBERS["pooled_2023_26"]


def ts_rows(ts):
    seasons = hab.TIMESPANS[ts]["seasons"] if ts in hab.TIMESPANS else AUX_TS[ts]["seasons"]
    return WM.season.isin(seasons).to_numpy()


def min_n(ts):
    return MIN_N_2627 if ts == "2026_27" else MIN_N_HALF if ts.endswith(("_odd", "_even")) or ts.startswith("rand") else MIN_N


def psum(pid, Yaug, a, P):
    return np.stack([np.bincount(pid, weights=Yaug[:, c] * a, minlength=P) for c in range(Yaug.shape[1])], 1)


def effects_from(SA, SB, na, nb):
    """Per player effect arrays (P x 5) from cond / ref sums.  The SE uses the player's POOLED variance over the games of both sides (dev: sample variance of dev over both sides; events: smoothed pooled rate (S+1)/(N+2),
    p(1-p) (1/n_cond + 1/n_ref)).  A pooled (null-based) variance does not depend on the sign of the difference, so inverse-variance weights do not bias the league mean (a per-side variance does for skewed / rare outcomes)."""
    k = len(OUTCOMES)
    with np.errstate(divide="ignore", invalid="ignore"):
        ma, mb = SA[:, :k] / na[:, None], SB[:, :k] / nb[:, None]
        n = (na + nb)[:, None]; T = SA + SB; mp = T[:, :k] / n
        vp = (T[:, k:] - n * mp ** 2) / (n - 1)
        pt = (T[:, 1:k] + 1) / (n + 2)
        se = np.empty_like(ma); f = 1 / na + 1 / nb
        se[:, 0] = np.sqrt(np.maximum(vp[:, 0], 0) * f); se[:, 1:] = np.sqrt(pt * (1 - pt) * f[:, None])
    return ma, mb, ma - mb, se


def raw_effects(rowmask, cid, minn, row_override=None):
    """Raw per-player effects for one condition on the rows in rowmask.  Returns dict of arrays over PLAYERS (NaN where the minimum n is not met on both sides)."""
    a, b = MASKS[cid]; a = a & rowmask; b = b & rowmask
    if row_override is not None: a, b = a & row_override, b & row_override
    P = len(PLAYERS); na = np.bincount(PID, weights=a, minlength=P); nb = np.bincount(PID, weights=b, minlength=P)
    SA, SB = psum(PID, Y_AUG, a, P), psum(PID, Y_AUG, b, P)
    ma, mb, d, se = effects_from(SA, SB, na, nb)
    ok = (na >= minn[0]) & (nb >= minn[1])
    d = np.where(ok[:, None], d, np.nan); se = np.where(ok[:, None], se, np.nan)
    return dict(n_a=na, n_b=nb, mean_a=ma, mean_b=mb, d=d, se=se, ok=ok)


def base_rate(o_, j):
    """Player's overall mean of outcome j over the games of both sides (period A), per player."""
    with np.errstate(divide="ignore", invalid="ignore"):
        return (o_["n_a"] * o_["mean_a"][:, j] + o_["n_b"] * o_["mean_b"][:, j]) / (o_["n_a"] + o_["n_b"])


def dl_eb(d, se):
    """DerSimonian-Laird tau^2, random-effects league mean, shrunk estimates and posterior SDs."""
    k = len(d); w = 1 / se ** 2; mu_fe = (w * d).sum() / w.sum(); q = (w * (d - mu_fe) ** 2).sum()
    tau2 = max(0.0, (q - (k - 1)) / (w.sum() - (w ** 2).sum() / w.sum()))
    wre = 1 / (se ** 2 + tau2); mu = (wre * d).sum() / wre.sum(); var_mu = 1 / wre.sum()
    Bw = tau2 / (tau2 + se ** 2); theta = mu + Bw * (d - mu); sse = np.sqrt(Bw * se ** 2 + (1 - Bw) ** 2 * var_mu)
    return dict(mu=mu, tau2=tau2, var_mu=var_mu, B=Bw, theta=theta, sse=sse, rel=tau2 / (tau2 + float(np.mean(se ** 2))), q=q, k=k)


def classify(e, d, se, n_a, n_b):
    """Flags.  nonzero: strong = shrunk 95% interval excludes 0 and n >= MIN_N_STRONG on both sides; watch = shrunk 90% interval excludes 0 (not strong).
    vs_league: the same on theta - league mean (posterior SD sqrt(B) * se).  Returns int codes: 0 none, +-1 watch, +-2 strong (sign = direction)."""
    th, sse = e["theta"], e["sse"]; nok = (n_a >= MIN_N_STRONG) & (n_b >= MIN_N_STRONG)
    out = {}
    for nm, centre, sd in (("nz", th, sse), ("lg", th - e["mu"], np.sqrt(e["B"]) * se)):
        strong = (np.abs(centre) > Z_STRONG * sd) & nok; watch = (np.abs(centre) > Z_WATCH * sd) & ~strong
        out[nm] = np.where(strong, 2, np.where(watch, 1, 0)) * np.where(centre >= 0, 1, -1)
    return out


def segment_sets(ts):
    mem = MEMBERS[ts]
    return {sg: mem[sg] for sg in SEGS_ALL}


def eb_by_segment(d, se, na, nb, ok, mem):
    """EB per segment (all / top100 / top50 with their own parameters; top25 / top10 reuse top50's).  Returns {seg: dict(mu, tau2, rel, idx, theta, sse, B, flags)} or None for too few players."""
    res = {}
    for sg in SEGS_EB:
        idx = np.where(ok & mem[sg] & np.isfinite(se) & (se > 0))[0]
        if len(idx) < 10: res[sg] = None; continue
        e = dl_eb(d[idx], se[idx]); e["idx"] = idx; e["flags"] = classify(e, d[idx], se[idx], na[idx], nb[idx]); res[sg] = e
    return res


def counts_for(e, members_bool):
    """Flag counts for a subset of the players of EB result e."""
    if e is None: return None
    sel = members_bool[e["idx"]]
    out = dict(n=int(sel.sum()))
    for nm in ("nz", "lg"):
        c = e["flags"][nm][sel]
        out[f"strong_{nm}"] = int((np.abs(c) == 2).sum()); out[f"watch_{nm}"] = int((np.abs(c) == 1).sum())
        out[f"strong_pos_{nm}"] = int((c == 2).sum()); out[f"strong_neg_{nm}"] = int((c == -2).sum())
    return out


def seg_counts(e_by_seg, mem):
    out = {}
    for sg in SEGS_ALL:
        e = e_by_seg["top50"] if sg in ("top25", "top10") else e_by_seg[sg]
        out[sg] = counts_for(e, mem[sg])
    return out


# ------------------------------------------------------------------ persistence (period A -> period B)
def fisher_ci(r, n, inflate=1.0):
    if n <= 3 or not np.isfinite(r) or abs(r) >= 1: return (np.nan, np.nan)
    z, s = np.arctanh(r), math.sqrt(inflate / (n - 3)); return float(np.tanh(z - 1.96 * s)), float(np.tanh(z + 1.96 * s))


def wls_slope(x, y, w):
    """WLS slope of y on x with HC1 robust SE."""
    n = len(x)
    if n < 10 or np.ptp(x) < 1e-12: return (np.nan, np.nan, np.nan)
    X = np.stack([np.ones(n), x], 1); XtW = X.T * w; A = XtW @ X
    try: Ai = np.linalg.inv(A)
    except np.linalg.LinAlgError: return (np.nan, np.nan, np.nan)
    beta = Ai @ (XtW @ y); e = y - X @ beta
    meat = (X.T * (w * e) ** 2) @ X; V = Ai @ meat @ Ai * n / (n - 2)
    se = math.sqrt(max(V[1, 1], 0)); return float(beta[1]), float(beta[1] - 1.96 * se), float(beta[1] + 1.96 * se)


def pair_stats(ebA, ebB, dA, seA, dB, seB, okA, okB, mem, flags=True, baseA=None):
    """Persistence of the player effect from period A to period B for one condition x outcome.  ebA / ebB = eb_by_segment results (parameters estimated on each period's own eligible players).
    Returns {seg: dict}: correlations over players eligible in both periods, EB reliabilities (on the paired players), calibration slope of B's raw effect on A's SHRUNK effect, and flag hit rates (A flags -> B flags)."""
    out = {}
    for sg in SEGS_ALL:
        ea = ebA["top50"] if sg in ("top25", "top10") else ebA[sg]; eb_ = ebB["top50"] if sg in ("top25", "top10") else ebB[sg]
        both = okA & okB & mem[sg] & np.isfinite(seA) & np.isfinite(seB) & (seA > 0) & (seB > 0); idx = np.where(both)[0]; n = len(idx)
        r_ = dict(n_pairs=n)
        if n < 10 or ea is None or eb_ is None: out[sg] = r_; continue
        a, b = dA[idx], dB[idx]
        r = float(np.corrcoef(a, b)[0, 1]) if a.std() > 0 and b.std() > 0 else np.nan
        rho = float(stats.spearmanr(a, b)[0]) if a.std() > 0 and b.std() > 0 else np.nan
        lo, hi = fisher_ci(r, n); slo, shi = fisher_ci(rho, n, 1 + (rho ** 2) / 2 if np.isfinite(rho) else 1)
        p = float(2 * stats.norm.sf(abs(np.arctanh(r)) * math.sqrt(n - 3))) if np.isfinite(r) and abs(r) < 1 else np.nan
        pa, pb = dl_eb(a, seA[idx]), dl_eb(b, seB[idx])
        relA, relB = pa["rel"], pb["rel"]; rmax = math.sqrt(relA * relB)
        if baseA is not None and np.std(baseA[idx]) > 0:      # partial correlation controlling for the player's overall rate of the outcome (guards against 'high-rate players have bigger pp effects')
            X = np.stack([np.ones(n), baseA[idx]], 1); ra = a - X @ np.linalg.lstsq(X, a, rcond=None)[0]; rb = b - X @ np.linalg.lstsq(X, b, rcond=None)[0]
            r_["partial_r_base"] = float(np.corrcoef(ra, rb)[0, 1]) if ra.std() > 0 and rb.std() > 0 else np.nan
        thA = np.full(len(dA), np.nan); thA[ea["idx"]] = ea["theta"]
        wB = 1 / (seB[idx] ** 2 + eb_["tau2"])
        sl, sll, slh = wls_slope(thA[idx], b, wB) if ea["rel"] >= 0.05 else (np.nan, np.nan, np.nan)      # shrunk effects with (almost) no spread cannot be calibrated
        r_.update(pearson_r=r, r_lo=lo, r_hi=hi, p_value=p, spearman_rho=rho, rho_lo=slo, rho_hi=shi, tau_a=math.sqrt(pa["tau2"]), tau_b=math.sqrt(pb["tau2"]), eb_rel_a=relA, eb_rel_b=relB, r_max_if_stable=rmax,
                  r_disattenuated=(float(np.clip(r / rmax, -1, 1)) if rmax > 0.05 and np.isfinite(r) else np.nan), calib_slope=sl, calib_slope_lo=sll, calib_slope_hi=slh,
                  mean_a=float(np.mean(a)), mean_b=float(np.mean(b)))
        if flags:
            cA = {nm: np.zeros(len(dA), int) for nm in ("nz", "lg")}; cB = {nm: np.zeros(len(dA), int) for nm in ("nz", "lg")}
            for nm in ("nz", "lg"):
                cA[nm][ea["idx"]] = ea["flags"][nm]; cB[nm][eb_["idx"]] = eb_["flags"][nm]
            elig = both
            for nm in ("nz", "lg"):
                ca, cb = cA[nm][elig], cB[nm][elig]; fa = ca != 0; nfl = int(fa.sum())
                pos_share, neg_share = float((cb > 0).mean()), float((cb < 0).mean())
                held = int(((np.sign(ca) == np.sign(cb)) & fa & (cb != 0)).sum())
                if nm == "nz": centre_b = dB[elig]
                else: centre_b = dB[elig] - eb_["mu"]
                sign_ok = int(((np.sign(ca) == np.sign(centre_b)) & fa).sum())
                chance = float((np.sum(ca[fa] > 0) * pos_share + np.sum(ca[fa] < 0) * neg_share) / nfl) if nfl else np.nan
                r_[f"flags_{nm}_n"] = nfl; r_[f"flags_{nm}_held"] = held; r_[f"flags_{nm}_sign_held"] = sign_ok; r_[f"flags_{nm}_chance_rate"] = chance
                r_[f"flags_{nm}_hold_rate"] = held / nfl if nfl else np.nan; r_[f"flags_{nm}_sign_rate"] = sign_ok / nfl if nfl else np.nan
                r_[f"flags_{nm}_p"] = float(stats.binomtest(held, nfl, min(max(chance, 1e-9), 1 - 1e-9), alternative="greater").pvalue) if nfl >= 3 and np.isfinite(chance) else np.nan
                r_[f"flags_{nm}_sign_p"] = float(stats.binomtest(sign_ok, nfl, 0.5, alternative="greater").pvalue) if nfl >= 3 else np.nan
        out[sg] = r_
    return out
