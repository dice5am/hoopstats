"""Big-nights part 2: stars vs non-stars (pooled-segment comparison + joint interaction test) and per-player shrunk patterns (DerSimonian-Laird + empirical Bayes) with expected-by-chance counts.
One task per timespan, cached in data/cache/bn/ts/.  Default spec: floor 8 PPG on the prior season-to-date average, std baseline (main cuts x150, p10, z15; l10 for x150 / p10 in the star comparison)."""
from __future__ import annotations
import math, sys, time, warnings
from multiprocessing import Pool
from pathlib import Path
import numpy as np
import pandas as pd
from scipy import stats
from scipy.special import expit

sys.path.insert(0, str(Path(__file__).resolve().parent))
import analysis_home_away_b2b as hab
import big_nights_analysis as B

CACHE = B.CACHE; (CACHE / "ts").mkdir(exist_ok=True)
STAR_DEFS = {"top100": "top 100 by PPG vs everyone else", "top50": "top 50 by PPG vs everyone else", "top25": "top 25 by PPG vs everyone else (thin: 25 players)", "top10": "top 10 by PPG vs everyone else (thin: 10 players)"}
INTER_DEFS = ("top100", "top50")
STAR_CUTS = [("std", "x125"), ("std", "x150"), ("std", "x200"), ("std", "p5"), ("std", "p10"), ("std", "z15"), ("l10", "x150"), ("l10", "p10")]
PLAYER_OUTCOMES = [("std", "x150"), ("std", "p10"), ("std", "z15")]
Z_WATCH, Q_STRONG = 2.5, 0.10
MIN_GAMES_PROP, MIN_GAMES_PROP_2627 = 40, 8
COND = {   # name -> (cond mask fn, ref mask fn, label)
    "teammates_out_10plus": (lambda s: (s.out_ppg >= 10).to_numpy(), lambda s: (s.out_ppg < 10).to_numpy(), "regular teammates out (10+ prior PPG) vs not"),
    "bounce_back_last1": (lambda s: (s.bb_last1 == 1).to_numpy(), lambda s: (s.bb_last1 == 0).to_numpy(), "after a weak last game (<0.75x) vs not"),
    "vs_worst10_defence": (lambda s: s.def_tier.isin(["worst5", "worst6_10"]).to_numpy(), lambda s: ~s.def_tier.isin(["worst5", "worst6_10"]).to_numpy(), "vs worst-10 defence vs the other 20"),
    "home": (lambda s: (s.home == 1).to_numpy(), lambda s: (s.home == 0).to_numpy(), "home vs away"),
    "b2b_2nd": (lambda s: (s.b2b_state == "2nd").to_numpy(), lambda s: (s.b2b_state == "rested").to_numpy(), "2nd night of a back-to-back vs rested"),
    "hot_last1": (lambda s: (s.hot_last1 == 1).to_numpy(), lambda s: (s.hot_last1 == 0).to_numpy(), "after a hot last game (>=1.25x) vs not"),
}
COND_MIN = (10, 10); COND_MIN_2627 = (3, 3)


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


def shrink(q: pd.DataFrame, ts: str, analysis: str, outcome: str, mem: dict, names, prov: bool):
    dd, se = q.raw_diff.to_numpy(float), q.se.to_numpy(float); mu = float(np.sum(dd / se ** 2) / np.sum(1 / se ** 2)); tau2 = dl_tau2(dd, se)
    w = np.where(se > 0, tau2 / (tau2 + se ** 2), 1.0); var_mu = 1.0 / float(np.sum(1.0 / (tau2 + se ** 2)))
    q = q.copy(); q["shrunk_diff"] = mu + w * (dd - mu); q["shrink_weight"] = w
    sse = np.sqrt(w * se ** 2 + (1 - w) ** 2 * var_mu); q["shrunk_ci_low"] = q.shrunk_diff - 1.96 * sse; q["shrunk_ci_high"] = q.shrunk_diff + 1.96 * sse
    q["raw_ci_low"] = dd - 1.96 * se; q["raw_ci_high"] = dd + 1.96 * se
    q["z"] = (dd - mu) / se; q["p"] = 2 * stats.norm.sf(np.abs(q.z)); q["q"] = bh(q.p.to_numpy())
    strong = (q.q < Q_STRONG).to_numpy(); watch = (q.z.abs() >= Z_WATCH).to_numpy() & ~strong
    q["flag"] = np.where(strong, np.where(dd > mu, "higher_strong", "lower_strong"), np.where(watch, np.where(dd > mu, "higher_watch", "lower_watch"), None))
    hw = 1.96 * np.sqrt(w) * se
    q["credible_above_league"] = ((q.shrunk_diff - hw) > mu); q["credible_below_league"] = ((q.shrunk_diff + hw) < mu)
    q["league_mean_diff"] = mu; q["tau"] = math.sqrt(tau2); q["timespan"] = ts; q["analysis"] = analysis; q["outcome"] = outcome; q["provisional"] = prov
    for sid in ("top10", "top25", "top50", "top100"): q[f"in_{sid}"] = q.player_id.isin(mem[sid])
    k = len(q)
    summ = dict(timespan=ts, analysis=analysis, outcome=outcome, n_players=k, league_mean_diff=mu, tau=math.sqrt(tau2), median_se=float(np.median(se)), shrink_weight_median=float(np.median(w)),
                n_flag_strong_q10=int(strong.sum()), n_flag_watch_z25=int(watch.sum()), expected_watch_by_chance=float(k * 2 * stats.norm.sf(Z_WATCH)), n_p_lt_05=int((q.p < 0.05).sum()), expected_p_lt_05_by_chance=0.05 * k,
                n_credible_above_league=int(q.credible_above_league.sum()), n_credible_below_league=int(q.credible_below_league.sum()),
                n_credible_above_top50=int((q.credible_above_league & q.in_top50).sum()), n_stars_top50=int(q.in_top50.sum()),
                n_credible_above_top25=int((q.credible_above_league & q.in_top25).sum()), n_stars_top25=int(q.in_top25.sum()), provisional=prov)
    return q, summ


def players_stage(sub, ts, mem, names, prov):
    """sub = floor-8 std-baseline rows of the timespan (all players)."""
    rows, summ = [], []
    elig = sub.groupby("player_id").size(); mn = MIN_GAMES_PROP_2627 if ts == "2026_27" else MIN_GAMES_PROP
    for bl, ev in PLAYER_OUTCOMES:
        s, col = B.event_rows(sub, bl, ev, 8)
        s = B.add_model_cols(s, bl); y = s[col].to_numpy(int)
        if y.sum() < 60: continue
        X, _ = B.design(s, "A"); X = X[["const"] + B.CONT_A + B.CTRL_BIN]; X = B.drop_const(X)
        r = B.fit_logit(X, y, pd.factorize(s.player_id)[0]); p = expit(X.to_numpy() @ r.params)
        d = pd.DataFrame({"player_id": s.player_id.to_numpy(), "y": y, "p": p, "v": p * (1 - p)})
        g = d.groupby("player_id").agg(n=("y", "size"), O=("y", "sum"), E=("p", "sum"), V=("v", "sum")).reset_index()
        g = g[g.n >= mn]
        if len(g) < 10: continue
        g["raw_diff"] = (g.O - g.E) / g.n; g["se"] = np.sqrt(g.V) / g.n
        q = g.rename(columns={"n": "n_games", "O": "observed_events", "E": "expected_events"}).copy()
        q["player_name"] = q.player_id.map(names); q["n_cond"] = q.n_games; q["n_ref"] = 0; q["mean_cond"] = q.observed_events / q.n_games; q["mean_ref"] = q.expected_events / q.n_games
        q2, sm = shrink(q.drop(columns="V"), ts, "propensity_vs_expected", f"{ev}_{bl}", mem, names, prov); rows.append(q2); summ.append(sm)
    for cname, (fa, fb, lab) in COND.items():
        ma, mb = COND_MIN_2627 if ts == "2026_27" else COND_MIN
        for bl, ev in PLAYER_OUTCOMES:
            s, col = B.event_rows(sub, bl, ev, 8); part = []
            for pid, xp in s.groupby("player_id"):
                a, b_ = xp[fa(xp)], xp[fb(xp)]
                if len(a) < ma or len(b_) < mb: continue
                ya, yb = a[col].to_numpy(float), b_[col].to_numpy(float); na, nb = len(ya), len(yb)
                pa, pb = (ya.sum() + 1) / (na + 2), (yb.sum() + 1) / (nb + 2)
                part.append(dict(player_id=pid, player_name=names.get(pid), n_games=len(xp), n_cond=na, n_ref=nb, mean_cond=float(ya.mean()), mean_ref=float(yb.mean()), observed_events=float(ya.sum()), expected_events=np.nan,
                                 raw_diff=float(ya.mean() - yb.mean()), se=float(math.sqrt(pa * (1 - pa) / (na + 2) + pb * (1 - pb) / (nb + 2)))))
            if len(part) < 10: continue
            q2, sm = shrink(pd.DataFrame(part), ts, cname, f"{ev}_{bl}", mem, names, prov); rows.append(q2); summ.append(sm)
    return (pd.concat(rows, ignore_index=True) if rows else pd.DataFrame()), pd.DataFrame(summ)


def se_from_ci(lo, hi, log=False):
    if lo is None or hi is None or (isinstance(lo, float) and np.isnan(lo)): return None
    return (math.log(hi) - math.log(lo)) / 3.92 if log else (hi - lo) / 3.92


def stars_stage(sub, ts, mem):
    cmp_rows, int_rows, base_rows = [], [], []
    A_SPECS = [sp for sp in B.SPECS if sp[0] == "A"]
    for sd in STAR_DEFS:
        for bl, ev in STAR_CUTS:
            s, col = B.event_rows(sub, bl, ev, 8)
            if len(s) < 300: continue
            s = s.copy(); s["star"] = s.player_id.isin(mem[sd]).astype(int); y = s[col].to_numpy(float)
            key = dict(timespan=ts, star_def=sd, baseline=bl, event=ev, provisional=ts in ("2026_27", "pooled_2023_27"))
            grp = {}
            for nm, m in (("star", s.star == 1), ("non_star", s.star == 0)):
                x = s[m]; cl = pd.factorize(x.player_id)[0]; C = cl.max() + 1 if len(x) else 0
                if len(x) == 0: continue
                yy = x[col].to_numpy(float); mm = yy.mean(); u = np.bincount(cl, weights=yy - mm, minlength=C) / len(x); se = float(np.sqrt((u ** 2).sum()))
                grp[nm] = dict(rate=mm, se=se, n=len(x), players=int(x.player_id.nunique()), events=int(yy.sum()), thin=B.thin_level(len(x), int(x.player_id.nunique())))
                base_rows.append(dict(key, group=nm, n_games=len(x), n_players=int(x.player_id.nunique()), n_events=int(yy.sum()), base_rate=float(mm), ci_low=float(mm - 1.96 * se), ci_high=float(mm + 1.96 * se), thin_flag=grp[nm]["thin"]))
            if len(grp) < 2: continue
            d = grp["star"]["rate"] - grp["non_star"]["rate"]; sed = math.sqrt(grp["star"]["se"] ** 2 + grp["non_star"]["se"] ** 2)
            base_rows.append(dict(key, group="difference_star_minus_non_star", n_games=len(s), n_players=int(s.player_id.nunique()), n_events=int(y.sum()), base_rate=float(d), ci_low=float(d - 1.96 * sed), ci_high=float(d + 1.96 * sed), thin_flag=False))
            # pooled-segment comparison per factor
            fs = B.flags(s); per = {}
            for nm in ("star", "non_star"):
                m = (s.star == (1 if nm == "star" else 0)).to_numpy(); x = s[m]; xf = {k: v[m] for k, v in fs.items()}
                cl = pd.factorize(x.player_id)[0]; C = cl.max() + 1; yy = x[col].to_numpy(float); per[nm] = {}
                for lens, dim, fid, label, reflab, ma, mb in B.level_masks(x, xf):
                    if lens != "A": continue
                    per[nm][fid] = B.contrast(yy, ma, mb, cl, C)
            for lens, dim, fid, label, reflab, _, _ in [(sp[0], sp[1], sp[2], sp[3], sp[5], None, None) for sp in A_SPECS]:
                a, b_ = per["star"].get(fid), per["non_star"].get(fid)
                if a is None or b_ is None: continue
                row = dict(key, factor=fid, label=label, dimension=dim, star_rr=a.get("rr"), star_rr_lo=a.get("rr_lo"), star_rr_hi=a.get("rr_hi"), non_rr=b_.get("rr"), non_rr_lo=b_.get("rr_lo"), non_rr_hi=b_.get("rr_hi"),
                           star_rd=a["rd"], star_rd_lo=a["rd_lo"], star_rd_hi=a["rd_hi"], non_rd=b_["rd"], non_rd_lo=b_["rd_lo"], non_rd_hi=b_["rd_hi"], star_n_level=a["n_level"], non_n_level=b_["n_level"],
                           star_events_level=a["events_level"], non_events_level=b_["events_level"], star_events_ref=a["events_ref"], non_events_ref=b_["events_ref"])
                dr = a["rd"] - b_["rd"]; sdr = math.sqrt(se_from_ci(a["rd_lo"], a["rd_hi"]) ** 2 + se_from_ci(b_["rd_lo"], b_["rd_hi"]) ** 2)
                row.update(rd_diff=dr, rd_diff_lo=dr - 1.96 * sdr, rd_diff_hi=dr + 1.96 * sdr)
                if a.get("rr") and b_.get("rr"):
                    lr = math.log(a["rr"] / b_["rr"]); sl = math.sqrt(se_from_ci(a["rr_lo"], a["rr_hi"], True) ** 2 + se_from_ci(b_["rr_lo"], b_["rr_hi"], True) ** 2)
                    row.update(rr_ratio=math.exp(lr), rr_ratio_lo=math.exp(lr - 1.96 * sl), rr_ratio_hi=math.exp(lr + 1.96 * sl))
                row["reportable"] = bool(min(a["events_level"], b_["events_level"], a["events_ref"], b_["events_ref"]) >= B.MIN_LEVEL_EV and not B.thin_level(a["n_level"], a["n_players_level"]) and not B.thin_level(b_["n_level"], b_["n_players_level"]))
                cmp_rows.append(row)
            # one interaction model per factor: logit(event) ~ controls + factor + star + factor x star (player-clustered SEs); only the primary star definitions (>= 30 players)
            if sd in INTER_DEFS and ev in ("x150", "p10", "z15", "x125", "p5") and bl == "std" and y.sum() >= 150 and s.star.sum() >= 300 and (s.star == 0).sum() >= 300:
                sm_ = B.add_model_cols(s, bl); X0, _ = B.design(sm_, "A"); X0 = X0[["const"] + B.CONT_A + B.CTRL_BIN]; X0["star"] = sm_.star.astype(float); cl = pd.factorize(sm_.player_id)[0]
                for t, c in B.BIN_A.items():
                    f_ = sm_[c].astype(float)
                    if f_.sum() < 40 or (f_ * sm_.star).sum() < 20 or (f_ * (1 - sm_.star)).sum() < 20: continue
                    try:
                        X = X0.copy(); X[t] = f_; X[f"{t}:star"] = f_ * X0["star"]; X = B.drop_const(X)
                        r = B.fit_logit(X, y.astype(int), cl); i = list(X.columns).index(f"{t}:star"); j = list(X.columns).index(t)
                        if not np.isfinite(r.bse[i]): continue
                        int_rows.append(dict(key, term=t, label=B.SPEC_LABEL.get(t, t), non_star_or=float(np.exp(r.params[j])), star_or=float(np.exp(r.params[j] + r.params[i])), interaction_or=float(np.exp(r.params[i])),
                                             ci_low=float(np.exp(r.params[i] - 1.96 * r.bse[i])), ci_high=float(np.exp(r.params[i] + 1.96 * r.bse[i])), p_value=float(r.pvalues[i]), n_games=len(sm_), n_events=int(y.sum())))
                    except Exception as e:
                        int_rows.append(dict(key, term=t, notes=f"failed {type(e).__name__}"))
    ir = pd.DataFrame(int_rows)
    if len(ir) and "p_value" in ir:
        ir["q_value"] = np.nan
        for _, g in ir.groupby(["star_def", "baseline", "event"]): ir.loc[g.index, "q_value"] = bh(g.p_value.to_numpy(float))
    return pd.DataFrame(cmp_rows), ir, pd.DataFrame(base_rows)


def run_ts(ts):
    t0 = time.time(); warnings.filterwarnings("ignore")
    f = CACHE / "ts" / f"{ts}.pkl"
    if f.exists(): return ts, 0.0
    spec = hab.TIMESPANS[ts]; w = B.WM[B.WM.season.isin(spec["seasons"])]
    mem = {sid: B.cell_members(ts, sid) for sid in hab.SEGMENT_IDS}
    names = B.G_ALL.groupby("player_id").full_name.last().to_dict(); prov = ts in ("2026_27", "pooled_2023_27")
    sub = w[w.avg_std >= 8].reset_index(drop=True)
    cmp_, int_, base = stars_stage(sub, ts, mem)
    # players: use all players with the default floor
    pq, ps = players_stage(sub, ts, mem, names, prov)
    pd.to_pickle(dict(cmp=cmp_, inter=int_, base=base, players=pq, psum=ps), f)
    return ts, time.time() - t0


if __name__ == "__main__":
    B.init(); t0 = time.time()
    with Pool(int(sys.argv[1]) if len(sys.argv) > 1 else 3) as pool:
        for ts, dt in pool.imap_unordered(run_ts, list(hab.TIMESPANS)):
            print("done", ts, f"{dt:.0f}s {time.time() - t0:.0f}s elapsed", flush=True)
