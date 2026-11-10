"""Player x condition study: assemble marts (data/marts/player_conditions*.parquet), DuckDB views, manifest (data/manifests/player_conditions.json).  Needs the caches from player_conditions_run.py."""
from __future__ import annotations
import hashlib, json, sys, time, warnings
from pathlib import Path
import duckdb
import numpy as np
import pandas as pd
from scipy import stats

sys.path.insert(0, str(Path(__file__).resolve().parent))
import player_conditions_core as C

ROOT = C.ROOT; OUT = ROOT / "data" / "marts"; MAN = ROOT / "data" / "manifests"; MAN.mkdir(exist_ok=True)
SCHEMES = {
    "temporal": dict(a="pooled_2023_25", b="2025_26", label="train 2023-24 + 2024-25 -> test 2025-26 (held-out season)", prov=False),
    "odd_even": dict(a="odd", b="even", label="odd vs even games within seasons (pooled 2023-26; deterministic split by within-season game number)", prov=False),
    "random_halves": dict(a="rand_a", b="rand_b", label="random split-half of games (pooled 2023-26; mean of 20 random splits)", prov=False),
    "provisional_2026_27": dict(a="pooled_2023_26", b="2026_27", label="train 2023-26 -> 2026-27 to date (PROVISIONAL, tiny n)", prov=True),
}
BH_Q = 0.10


def bh(p):
    out = np.full(len(p), np.nan); m = ~np.isnan(p); pv = p[m]; n = len(pv)
    if n == 0: return out
    o = np.argsort(pv, kind="mergesort"); qv = np.minimum.accumulate((pv[o] * n / np.arange(1, n + 1))[::-1])[::-1]
    r = np.empty(n); r[o] = np.minimum(qv, 1.0); out[m] = r
    return out


def sha(p: Path) -> str:
    h = hashlib.sha256(); h.update(p.read_bytes()); return h.hexdigest()


def thin_seg(sg, n_players, n_games):
    return bool(sg in ("top25", "top10") or n_players < 30 or n_games < 300)


FLAG = {0: "none", 1: "watch", 2: "strong"}
def code_to_flag(c):
    a = np.abs(c); return np.where(a == 2, "strong", np.where(a == 1, "watch", "none")).astype(object), np.where(c > 0, "positive", np.where(c < 0, "negative", None)).astype(object)


def load():
    effs, sums = {}, []
    for ts in C.ALL_TS:
        d = pd.read_pickle(C.CACHE / f"eff_{ts}.pkl"); effs[ts] = d["eff"]; sums.append(d["summary"])
    return effs, pd.concat(sums, ignore_index=True), pd.read_pickle(C.CACHE / "splits.pkl")


def eb_cache(effs):
    """EB by segment for every ts x condition x outcome."""
    out = {}
    for ts in C.ALL_TS:
        mem = C.MEMBERS[ts]
        for cid in C.COND_IDS:
            o_ = effs[ts][cid]
            for j, o in enumerate(C.OUTCOMES):
                out[(ts, cid, o)] = C.eb_by_segment(o_["d"][:, j], o_["se"][:, j], o_["n_a"], o_["n_b"], o_["ok"], mem)
    return out


def full_arr(e, key, P):
    a = np.full(P, np.nan); a[e["idx"]] = e[key]; return a


def code_arr(e, nm, P):
    a = np.zeros(P, int); a[e["idx"]] = e["flags"][nm]; return a


def build_main(effs, EB):
    """player_conditions: one row per timespan x condition x outcome x player (members of the 'all' segment who meet the minimum n on both sides)."""
    P = len(C.PLAYERS); frames = []
    for ts in C.ALL_TS:
        prov = ts in C.PROVISIONAL; test = C.TEST_OF.get(ts)
        for cid in C.COND_IDS:
            o_ = effs[ts][cid]
            for j, o in enumerate(C.OUTCOMES):
                eb = EB[(ts, cid, o)]
                if eb["all"] is None: continue
                idx = eb["all"]["idx"]; mem = C.MEMBERS[ts]
                df = pd.DataFrame(dict(timespan=ts, provisional=prov, aux_training_span=ts in C.AUX_TS, condition=cid, condition_group=C.COND_GROUP[cid], outcome=o, player_id=C.PLAYERS[idx]))
                df["player_name"] = df.player_id.map(C.NAMES)
                for sg in ("top100", "top50", "top25", "top10"): df[f"in_{sg}"] = mem[sg][idx]
                df["n_cond"] = o_["n_a"][idx]; df["n_ref"] = o_["n_b"][idx]; df["mean_cond"] = o_["mean_a"][idx, j]; df["mean_ref"] = o_["mean_b"][idx, j]
                df["raw_diff"] = o_["d"][idx, j]; df["raw_se"] = o_["se"][idx, j]; df["raw_ci_low"] = df.raw_diff - 1.96 * df.raw_se; df["raw_ci_high"] = df.raw_diff + 1.96 * df.raw_se
                # test period
                tb = None
                if test:
                    t_o = effs[test][cid]; tb = EB[(test, cid, o)]
                    df["holdout_period"] = test; df["holdout_provisional"] = test in C.PROVISIONAL
                    df["holdout_n_cond"] = t_o["n_a"][idx]; df["holdout_n_ref"] = t_o["n_b"][idx]; df["holdout_raw_diff"] = t_o["d"][idx, j]
                for sg in C.SEGS_EB:
                    e = eb[sg]
                    if e is None: continue
                    th, lo, hi = full_arr(e, "theta", P), None, None
                    sse = full_arr(e, "sse", P); df[f"shrunk_{sg}"] = th[idx]; df[f"shrunk_ci_low_{sg}"] = (th - 1.96 * sse)[idx]; df[f"shrunk_ci_high_{sg}"] = (th + 1.96 * sse)[idx]
                    df[f"league_mean_{sg}"] = e["mu"]; df[f"tau_{sg}"] = np.sqrt(e["tau2"]); df[f"eb_reliability_{sg}"] = e["rel"]
                    for nm, col in (("nz", "flag"), ("lg", "flag_vs_league")):
                        c = code_arr(e, nm, P)[idx]; f_, d_ = code_to_flag(c); df[f"{col}_{sg}"] = f_; df[f"{col}_direction_{sg}"] = d_
                        if tb is not None and tb[sg] is not None:
                            ct = code_arr(tb[sg], nm, P)[idx]; elig = np.zeros(P, bool); elig[tb[sg]["idx"]] = True; elig = elig[idx]
                            held = np.where(c == 0, None, np.where(~elig, None, (np.sign(ct) == np.sign(c)) & (ct != 0)))
                            df[f"held_{'out_of_sample' if nm == 'nz' else 'vs_league'}_{sg}"] = pd.array(held, dtype="boolean")
                            ctr = t_o["d"][idx, j] - (0.0 if nm == "nz" else tb[sg]["mu"]); hs = np.where(c == 0, None, np.where(~elig, None, np.sign(ctr) == np.sign(c)))
                            df[f"held_sign_{'out_of_sample' if nm == 'nz' else 'vs_league'}_{sg}"] = pd.array(hs, dtype="boolean")
                        elif tb is not None:
                            df[f"held_{'out_of_sample' if nm == 'nz' else 'vs_league'}_{sg}"] = pd.array([None] * len(df), dtype="boolean")
                            df[f"held_sign_{'out_of_sample' if nm == 'nz' else 'vs_league'}_{sg}"] = pd.array([None] * len(df), dtype="boolean")
                frames.append(df)
    m = pd.concat(frames, ignore_index=True)
    for c in m.columns:
        if m[c].dtype == np.float64: m[c] = m[c].astype("float32")
    return m


def pair_table(effs, EB, splits):
    """player_conditions_persistence: persistence of player effects from period A to period B, per scheme x segment x condition x outcome."""
    rows = []; memT = C.MEMBERS["pooled_2023_26"]
    for scheme, sp in SCHEMES.items():
        if scheme == "random_halves": continue
        for cid in C.COND_IDS:
            if scheme == "odd_even": A, Bh = splits["effs"]["odd"][cid], splits["effs"]["even"][cid]
            else: A, Bh = effs[sp["a"]][cid], effs[sp["b"]][cid]
            for j, o in enumerate(C.OUTCOMES):
                if scheme == "odd_even":
                    ea = C.eb_by_segment(A["d"][:, j], A["se"][:, j], A["n_a"], A["n_b"], A["ok"], memT); eb_ = C.eb_by_segment(Bh["d"][:, j], Bh["se"][:, j], Bh["n_a"], Bh["n_b"], Bh["ok"], memT)
                else:
                    ea, eb_ = EB[(sp["a"], cid, o)], EB[(sp["b"], cid, o)]
                    if scheme in ("temporal", "provisional_2026_27"):
                        # EB parameters are estimated with each period's own segment membership; re-estimate A with the common membership
                        ea = C.eb_by_segment(A["d"][:, j], A["se"][:, j], A["n_a"], A["n_b"], A["ok"], memT); eb_ = C.eb_by_segment(Bh["d"][:, j], Bh["se"][:, j], Bh["n_a"], Bh["n_b"], Bh["ok"], memT)
                ps = C.pair_stats(ea, eb_, A["d"][:, j], A["se"][:, j], Bh["d"][:, j], Bh["se"][:, j], A["ok"], Bh["ok"], memT, flags=True, baseA=C.base_rate(A, j))
                for sg, r in ps.items():
                    rows.append(dict(scheme=scheme, period_a=sp["a"], period_b=sp["b"], provisional=sp["prov"], segment=sg, condition=cid, outcome=o, **r))
    rs = splits["random"]
    g = rs.groupby(["condition", "outcome", "segment"]).agg(n_pairs=("n_pairs", "mean"), pearson_r=("pearson_r", "mean"), spearman_rho=("spearman_rho", "mean"), eb_rel_a=("eb_rel_a", "mean"), eb_rel_b=("eb_rel_b", "mean"),
                                                            tau_a=("tau_a", "mean"), tau_b=("tau_b", "mean"), r_max_if_stable=("r_max_if_stable", "mean"), calib_slope=("calib_slope", "mean"), r_sd_across_splits=("pearson_r", "std"), partial_r_base=("partial_r_base", "mean")).reset_index()
    for r in g.itertuples(index=False):
        d = r._asdict(); n = int(round(d["n_pairs"])); lo, hi = C.fisher_ci(d["pearson_r"], n)
        d.update(r_lo=lo, r_hi=hi, n_pairs=n, scheme="random_halves", period_a="rand_a", period_b="rand_b", provisional=False, p_value=float(2 * stats.norm.sf(abs(np.arctanh(d["pearson_r"])) * np.sqrt(max(n - 3, 1)))) if np.isfinite(d["pearson_r"]) and abs(d["pearson_r"]) < 1 else np.nan)
        d["r_disattenuated"] = float(np.clip(d["pearson_r"] / d["r_max_if_stable"], -1, 1)) if d["r_max_if_stable"] > 0.05 else np.nan
        rows.append(d)
    p = pd.DataFrame(rows)
    # Spearman-Brown for the split-half schemes
    for sc in ("odd_even", "random_halves"):
        m = p.scheme == sc
        for src, dst in (("pearson_r", "sb_r"), ("r_lo", "sb_r_lo"), ("r_hi", "sb_r_hi")):
            r = p.loc[m, src]; p.loc[m, dst] = 2 * r / (1 + r)
        rel = (p.loc[m, "eb_rel_a"] + p.loc[m, "eb_rel_b"]) / 2; p.loc[m, "sb_eb_reliability_full"] = 2 * rel / (1 + rel)
    p["condition_group"] = p.condition.map(C.COND_GROUP); p["thin_segment"] = p.segment.isin(["top25", "top10"])
    p["q_value"] = np.nan; p["p_one_sided_pos"] = np.where(p.pearson_r > 0, p.p_value / 2, 1 - p.p_value / 2)
    for _, gix in p.groupby(["scheme", "segment"]).groups.items():
        p.loc[gix, "q_value"] = bh(p.loc[gix, "p_one_sided_pos"].to_numpy(float))
    return p


def reliability_table(pers, summ):
    """One row per condition x outcome x segment: persistence class + the key figures."""
    T = pers[pers.scheme == "temporal"].set_index(["condition", "outcome", "segment"]); O = pers[pers.scheme == "odd_even"].set_index(["condition", "outcome", "segment"])
    R = pers[pers.scheme == "random_halves"].set_index(["condition", "outcome", "segment"]); V = pers[pers.scheme == "provisional_2026_27"].set_index(["condition", "outcome", "segment"])
    S = summ[summ.timespan == "pooled_2023_26"].set_index(["condition", "outcome", "segment"])
    rows = []
    for key in T.index:
        cid, o, sg = key; t = T.loc[key]; od = O.loc[key] if key in O.index else None; rd = R.loc[key] if key in R.index else None; v = V.loc[key] if key in V.index else None; s = S.loc[key] if key in S.index else None
        row = dict(condition=cid, condition_group=C.COND_GROUP[cid], outcome=o, segment=sg, thin_segment=sg in ("top25", "top10"))
        for pre, x in (("temporal", t), ("odd_even", od), ("random", rd)):
            if x is None: continue
            for c in ("n_pairs", "pearson_r", "partial_r_base", "r_lo", "r_hi", "p_value", "q_value", "eb_rel_a", "eb_rel_b", "r_max_if_stable", "r_disattenuated", "calib_slope", "calib_slope_lo", "calib_slope_hi"):
                if c in x.index: row[f"{pre}_{c}"] = x[c]
            if pre in ("odd_even", "random"):
                for c in ("sb_r", "sb_r_lo", "sb_r_hi", "sb_eb_reliability_full"): row[f"{pre}_{c}"] = x[c]
        if v is not None:
            for c in ("n_pairs", "pearson_r", "r_lo", "r_hi"): row[f"provisional_2627_{c}"] = v[c]
        if s is not None:
            row["eb_tau_pooled_2023_26"] = s["tau"]; row["eb_reliability_pooled_2023_26"] = s["eb_reliability"]; row["league_mean_pooled_2023_26"] = s["league_mean"]; row["n_players_pooled_2023_26"] = s["n_players"]
        for nm, lab in (("nz", "nonzero"), ("lg", "vs_league")):
            for c in ("n", "held", "hold_rate", "chance_rate", "p", "sign_rate", "sign_p"):
                k = f"flags_{nm}_{c}"
                if k in t.index: row[f"temporal_{k}"] = t[k]
                if od is not None and k in od.index: row[f"odd_even_{k}"] = od[k]
        rows.append(row)
    R_ = pd.DataFrame(rows)
    def cls(r):
        if r.thin_segment: return "thin_not_classified"
        nT, nO = r.get("temporal_n_pairs", np.nan), r.get("odd_even_n_pairs", np.nan)
        if not (nT >= 30 and nO >= 30): return "insufficient_data"
        tpos = (r.temporal_pearson_r > 0) and (r.temporal_q_value < BH_Q); opos = (r.odd_even_pearson_r > 0) and (r.odd_even_q_value < BH_Q)
        if tpos and opos: return "persistent"
        if tpos: return "cross_season_only"
        if opos: return "within_season_only"
        return "noise"
    R_["persistence_class"] = R_.apply(cls, axis=1)
    # extra checks: (1) the cross-season correlation survives controlling for the player's overall rate of the outcome (partial r >= half of the raw r); (2) the true-effect spread is practically relevant (EB reliability >= 0.10)
    R_["base_rate_check_ok"] = (R_.temporal_partial_r_base >= 0.5 * R_.temporal_pearson_r) & (R_.temporal_partial_r_base > 0)
    R_["practical_ok"] = R_.eb_reliability_pooled_2023_26 >= 0.10
    def verdict(r):
        c = r.persistence_class
        if c == "persistent": return "persistent signal" if (r.base_rate_check_ok and r.practical_ok) else "persistent but small or scale-driven"
        return {"cross_season_only": "cross-season only (not within season)", "within_season_only": "within-season only (not shown across seasons)", "noise": "noise", "insufficient_data": "not enough players", "thin_not_classified": "thin segment, not classified"}[c]
    R_["verdict"] = R_.apply(verdict, axis=1)
    return R_


def summary_table(summ, rel):
    s = summ.copy(); s["provisional"] = s.timespan.isin(C.PROVISIONAL); s["aux_training_span"] = s.timespan.isin(C.AUX_TS)
    s["condition_group"] = s.condition.map(C.COND_GROUP); s["condition_label"] = s.condition.map(C.COND_LABEL)
    s["thin_cell"] = [thin_seg(sg, n, g) for sg, n, g in zip(s.segment, s.n_players, s.n_games)]
    for nm in ("strong_nz", "watch_nz", "strong_lg", "watch_lg"):
        s[f"excess_{nm}"] = s[f"n_{nm}"] - s[f"exp_{nm}"]
    s = s.merge(rel[["condition", "outcome", "segment", "persistence_class", "verdict"]], on=["condition", "outcome", "segment"], how="left")
    return s


def responders(main, rel, top_n=10):
    m = main[(main.timespan == "pooled_2023_26") & (main.n_cond >= C.MIN_N_RANK) & (main.n_ref >= C.MIN_N_RANK)]
    tr = main[main.timespan == "pooled_2023_25"].set_index(["condition", "outcome", "player_id"])
    te = main[main.timespan == "2025_26"].set_index(["condition", "outcome", "player_id"])
    rr = rel.set_index(["condition", "outcome", "segment"]); rows = []
    for sg in C.SEGS_EB:
        col = f"shrunk_{sg}"; sub = m[m[col].notna()]
        for (cid, o), g in sub.groupby(["condition", "outcome"]):
            if len(g) < 30: continue
            cl = rr.loc[(cid, o, sg), "verdict"] if (cid, o, sg) in rr.index else None
            for dirn, gg in (("top_positive", g.nlargest(top_n, col)), ("top_negative", g.nsmallest(top_n, col))):
                for rank, r in enumerate(gg.itertuples(index=False), 1):
                    k = (cid, o, r.player_id); trr = tr.loc[k] if k in tr.index else None; tee = te.loc[k] if k in te.index else None
                    rows.append(dict(timespan="pooled_2023_26", segment=sg, condition=cid, condition_group=C.COND_GROUP[cid], outcome=o, direction=dirn, rank=rank, player_id=r.player_id, player_name=r.player_name,
                                     n_cond=r.n_cond, n_ref=r.n_ref, raw_diff=r.raw_diff, shrunk=getattr(r, col), shrunk_ci_low=getattr(r, f"shrunk_ci_low_{sg}"), shrunk_ci_high=getattr(r, f"shrunk_ci_high_{sg}"),
                                     league_mean=getattr(r, f"league_mean_{sg}"), tau=getattr(r, f"tau_{sg}"), eb_reliability=getattr(r, f"eb_reliability_{sg}"), ranking_meaningful=bool(getattr(r, f"eb_reliability_{sg}") >= 0.05), deviation_from_league=getattr(r, col) - getattr(r, f"league_mean_{sg}"), flag=getattr(r, f"flag_{sg}"), flag_vs_league=getattr(r, f"flag_vs_league_{sg}"),
                                     verdict=cl, held_2026_27_provisional=getattr(r, f"held_out_of_sample_{sg}"), held_vs_league_2026_27_provisional=getattr(r, f"held_vs_league_{sg}"),
                                     shrunk_2023_25=(trr[col] if trr is not None and col in trr.index else np.nan), flag_vs_league_2023_25=(trr[f"flag_vs_league_{sg}"] if trr is not None and f"flag_vs_league_{sg}" in trr.index else None),
                                     held_vs_league_2023_25_to_2025_26=(trr[f"held_vs_league_{sg}"] if trr is not None and f"held_vs_league_{sg}" in trr.index else pd.NA), raw_diff_2025_26=(tee["raw_diff"] if tee is not None else np.nan)))
    out = pd.DataFrame(rows); out["held_vs_league_2023_25_to_2025_26"] = out.held_vs_league_2023_25_to_2025_26.astype("boolean")
    return out


def profiles(main, rel, k=3, min_conditions=6):
    m = main[(main.timespan == "pooled_2023_26") & main.outcome.isin(C.MAIN_OUTCOMES) & (main.n_cond >= C.MIN_N_RANK) & (main.n_ref >= C.MIN_N_RANK) & main.shrunk_all.notna() & (main.eb_reliability_all >= 0.05)].copy()
    m["deviation_from_league"] = m.shrunk_all - m.league_mean_all
    tr = main[main.timespan == "pooled_2023_25"].set_index(["condition", "outcome", "player_id"])
    rr = rel[rel.segment == "all"].set_index(["condition", "outcome"]).verdict; rows = []
    for (pid, o), g in m.groupby(["player_id", "outcome"]):
        if len(g) < min_conditions: continue
        for side, gg in (("most_positive", g.nlargest(k, "deviation_from_league")), ("most_negative", g.nsmallest(k, "deviation_from_league"))):
            for rank, r in enumerate(gg.itertuples(index=False), 1):
                key = (r.condition, o, pid); trr = tr.loc[key] if key in tr.index else None
                rows.append(dict(timespan="pooled_2023_26", player_id=pid, player_name=r.player_name, in_top100=r.in_top100, in_top50=r.in_top50, in_top25=r.in_top25, in_top10=r.in_top10, outcome=o, side=side, rank=rank,
                                 condition=r.condition, condition_group=r.condition_group, n_cond=r.n_cond, n_ref=r.n_ref, raw_diff=r.raw_diff, shrunk=r.shrunk_all, shrunk_ci_low=r.shrunk_ci_low_all, shrunk_ci_high=r.shrunk_ci_high_all,
                                 league_mean=r.league_mean_all, deviation_from_league=r.deviation_from_league, flag=r.flag_all, flag_vs_league=r.flag_vs_league_all, verdict=rr.get((r.condition, o)),
                                 held_vs_league_2023_25_to_2025_26=(trr["held_vs_league_all"] if trr is not None and "held_vs_league_all" in trr.index else pd.NA), n_conditions_available=len(g)))
    out = pd.DataFrame(rows); out["held_vs_league_2023_25_to_2025_26"] = out.held_vs_league_2023_25_to_2025_26.astype("boolean"); return out


def write(name, df, tables):
    p = OUT / f"{name}.parquet"
    for c in df.columns:
        if df[c].dtype == np.float64: df[c] = df[c].astype("float32")
    df.to_parquet(p, index=False, compression="zstd"); tables[name] = dict(rows=int(len(df)), cols=int(df.shape[1]), sha256=sha(p), bytes=p.stat().st_size); print(name, len(df), f"{p.stat().st_size / 1e6:.2f} MB", flush=True)


def main():
    warnings.filterwarnings("ignore"); t0 = time.time(); C.init()
    effs, summ, splits = load(); EB = eb_cache(effs); print("eb", f"{time.time() - t0:.0f}s", flush=True)
    main_ = build_main(effs, EB); pers = pair_table(effs, EB, splits); rel = reliability_table(pers, summ)
    sm = summary_table(summ, rel)
    # persistence class columns on the main table
    for sg in C.SEGS_EB:
        r = rel[rel.segment == sg].set_index(["condition", "outcome"]).persistence_class
        main_[f"persistence_class_{sg}"] = [r.get((c, o)) for c, o in zip(main_.condition, main_.outcome)]
    resp = responders(main_, rel); prof = profiles(main_, rel)
    tables = {}
    for nm, df in (("player_conditions", main_), ("player_conditions_summary", sm), ("player_conditions_persistence", pers), ("player_conditions_reliability", rel), ("player_conditions_responders", resp), ("player_conditions_profiles", prof)):
        write(nm, df, tables)
    cond = pd.DataFrame([dict(condition=c[0], condition_group=c[1], label=c[2], condition_spec=c[3], reference_spec=c[4]) for c in C.CONDS]); write("player_conditions_definitions", cond, tables)
    con = duckdb.connect(str(OUT / "nba_phase1.duckdb"))
    for nm in tables: con.execute(f"create or replace view {nm} as select * from read_parquet('{(OUT / (nm + '.parquet')).as_posix()}')")
    con.close()
    man = dict(study="player_conditions", built_through="2026-11-09", generated_by="scripts/player_conditions_assemble.py", tables=tables,
               thresholds=dict(floor_prior_avg_ppg=C.FLOOR, min_n_both_sides=C.MIN_N, min_n_both_sides_2026_27=C.MIN_N_2627, min_n_split_half=C.MIN_N_HALF, min_n_strong=C.MIN_N_STRONG, min_n_rank=C.MIN_N_RANK, z_strong=C.Z_STRONG, z_watch=C.Z_WATCH,
                               persistence_bh_q=BH_Q, n_permutations=200, n_random_splits=20, thin_segment="< 30 players or < 300 player-games (top25 and top10 are always thin)"),
               conditions=[dict(id=c[0], group=c[1], label=c[2], condition=c[3], reference=c[4]) for c in C.CONDS], outcomes=C.OUTCOME_LABEL if hasattr(C, "OUTCOME_LABEL") else C.OUT_LABEL, timespans=C.ALL_TS, segments=C.SEGS_ALL,
               schemes={k: v["label"] for k, v in SCHEMES.items()}, duckdb_views=list(tables), provisional_timespans=sorted(C.PROVISIONAL))
    (MAN / "player_conditions.json").write_text(json.dumps(man, indent=1, default=str)); print("done", f"{time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
