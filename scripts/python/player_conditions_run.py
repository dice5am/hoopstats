"""Player x condition study: heavy stage.  Per timespan (6 app timespans + the 2023-24+2024-25 training span), cached in data/cache/pc/:
  eff_<ts>.pkl   raw per-player effects for every condition (n, means, difference, SE for the 5 outcomes) + observed EB summary + permutation null (within-player label shuffles)
  splits.pkl     odd / even split-half effects of the pooled 2023-26 span (by within-season game number) + 20 random split-half persistence tables
Run:  nohup python scripts/player_conditions_run.py > data/cache/pc/run.log 2>&1 &"""
from __future__ import annotations
import sys, time, warnings
from pathlib import Path
import numpy as np
import pandas as pd
sys.path.insert(0, str(Path(__file__).resolve().parent))
import player_conditions_core as C

N_PERM = 200; SEED = 20261110; N_RANDOM_SPLITS = 20


def perm_null(ts, rowmask, cid, obs, rng, nperm=N_PERM):
    """Within-player shuffle of the condition labels among the player's games in (condition U reference), keeping each player's n_cond.  Returns {(outcome, seg, metric): array over permutations}."""
    a, b = C.MASKS[cid]; U = (a | b) & rowmask; idx = np.where(U)[0]; pid = C.PID[idx]; Ya = C.Y_AUG[idx]; P = len(C.PLAYERS)
    na_t = np.bincount(pid, weights=a[idx], minlength=P); cnt = np.bincount(pid, minlength=P); start = np.cumsum(cnt) - cnt
    SU = np.stack([np.bincount(pid, weights=Ya[:, c], minlength=P) for c in range(Ya.shape[1])], 1)
    ok = obs["ok"]; mem = C.MEMBERS[ts]; nbt = cnt - na_t
    res = {}
    for k in range(nperm):
        order = np.argsort(pid + rng.random(len(pid))); sel = (np.arange(len(pid)) - start[pid[order]]) < na_t[pid[order]]
        al = np.zeros(len(pid)); al[order[sel]] = 1.0
        SA = np.stack([np.bincount(pid, weights=Ya[:, c] * al, minlength=P) for c in range(Ya.shape[1])], 1)
        _, _, d, se = C.effects_from(SA, SU - SA, na_t, nbt)
        for j, o in enumerate(C.OUTCOMES):
            eb = C.eb_by_segment(d[:, j], se[:, j], na_t, nbt, ok, mem); cc = C.seg_counts(eb, mem)
            for sg, v in cc.items():
                if v is None: continue
                for m in ("strong_nz", "watch_nz", "strong_lg", "watch_lg"):
                    res.setdefault((o, sg, m), np.zeros(nperm))[k] = v[m]
    return res


def run_ts(ts):
    f = C.CACHE / f"eff_{ts}.pkl"
    if f.exists(): return ts, 0.0
    t0 = time.time(); rowmask = C.ts_rows(ts); mn = C.min_n(ts); mem = C.MEMBERS[ts]; rng = np.random.default_rng(C.hash_seed(ts) if hasattr(C, "hash_seed") else SEED + len(ts))
    eff, summ = {}, []
    for cid in C.COND_IDS:
        obs = C.raw_effects(rowmask, cid, mn); eff[cid] = obs
        pn = perm_null(ts, rowmask, cid, obs, rng)
        for j, o in enumerate(C.OUTCOMES):
            eb = C.eb_by_segment(obs["d"][:, j], obs["se"][:, j], obs["n_a"], obs["n_b"], obs["ok"], mem); cc = C.seg_counts(eb, mem)
            for sg in C.SEGS_ALL:
                v = cc[sg]; e = eb["top50"] if sg in ("top25", "top10") else eb[sg]
                if v is None or e is None: continue
                sel = mem[sg][e["idx"]]; n_games = float((obs["n_a"][e["idx"]][sel] + obs["n_b"][e["idx"]][sel]).sum())
                row = dict(timespan=ts, condition=cid, outcome=o, segment=sg, n_players=v["n"], n_games=n_games, league_mean=e["mu"], tau=float(np.sqrt(e["tau2"])), tau2=e["tau2"],
                           mean_se2=float(np.mean(obs["se"][e["idx"], j] ** 2)), eb_reliability=e["rel"], median_se=float(np.median(obs["se"][e["idx"], j])), params_from=("top50" if sg in ("top25", "top10") else sg))
                for m in ("strong_nz", "watch_nz", "strong_lg", "watch_lg", "strong_pos_nz", "strong_neg_nz", "strong_pos_lg", "strong_neg_lg"): row[f"n_{m}"] = v[m]
                for m in ("strong_nz", "watch_nz", "strong_lg", "watch_lg"):
                    arr = pn.get((o, sg, m))
                    if arr is None: continue
                    row[f"exp_{m}"] = float(arr.mean()); row[f"exp_{m}_sd"] = float(arr.std()); row[f"exp_{m}_p95"] = float(np.quantile(arr, 0.95)); row[f"perm_p_{m}"] = float((1 + (arr >= v[m]).sum()) / (1 + len(arr)))
                row["n_perm"] = N_PERM; summ.append(row)
    pd.to_pickle(dict(eff=eff, summary=pd.DataFrame(summ), ts=ts), f)
    return ts, time.time() - t0


def run_splits():
    f = C.CACHE / "splits.pkl"
    if f.exists(): return 0.0
    t0 = time.time(); rowmask = C.ts_rows("pooled_2023_26"); mem = C.MEMBERS["pooled_2023_26"]
    par = (C.WM.n_prior_season.to_numpy() % 2 == 1); odd, even = rowmask & par, rowmask & ~par
    effs = dict(odd={c: C.raw_effects(odd, c, C.MIN_N_HALF) for c in C.COND_IDS}, even={c: C.raw_effects(even, c, C.MIN_N_HALF) for c in C.COND_IDS})
    rng = np.random.default_rng(SEED); rows = []
    for k in range(N_RANDOM_SPLITS):
        h = rng.random(len(C.WM)) < 0.5
        for cid in C.COND_IDS:
            A, Bh = C.raw_effects(rowmask & h, cid, C.MIN_N_HALF), C.raw_effects(rowmask & ~h, cid, C.MIN_N_HALF)
            for j, o in enumerate(C.OUTCOMES):
                ea = C.eb_by_segment(A["d"][:, j], A["se"][:, j], A["n_a"], A["n_b"], A["ok"], mem); eb_ = C.eb_by_segment(Bh["d"][:, j], Bh["se"][:, j], Bh["n_a"], Bh["n_b"], Bh["ok"], mem)
                ps = C.pair_stats(ea, eb_, A["d"][:, j], A["se"][:, j], Bh["d"][:, j], Bh["se"][:, j], A["ok"], Bh["ok"], mem, flags=False, baseA=C.base_rate(A, j))
                for sg, r in ps.items(): rows.append(dict(split=k, condition=cid, outcome=o, segment=sg, **r))
    pd.to_pickle(dict(effs=effs, random=pd.DataFrame(rows)), f)
    return time.time() - t0


if __name__ == "__main__":
    warnings.filterwarnings("ignore"); C.init(); t0 = time.time()
    for ts in ([sys.argv[1]] if len(sys.argv) > 1 else C.ALL_TS):
        _, dt = run_ts(ts); print("done", ts, f"{dt:.0f}s total {time.time() - t0:.0f}s", flush=True)
    if len(sys.argv) == 1:
        dt = run_splits(); print("done splits", f"{dt:.0f}s total {time.time() - t0:.0f}s", flush=True)
