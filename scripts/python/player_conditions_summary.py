"""Compact App Builder summary for the player x condition study -> data/player_conditions_summary.json (not wired into the app)."""
from __future__ import annotations
import json, sys
from pathlib import Path
import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import player_conditions_core as C

ROOT = C.ROOT; M = ROOT / "data" / "marts"; OUT = ROOT / "data" / "player_conditions_summary.json"


def clean(v, k=4):
    if v is None or v is pd.NA: return None
    if isinstance(v, (float, np.floating)): return None if not np.isfinite(v) else round(float(v), k)
    if isinstance(v, (np.integer,)): return int(v)
    if isinstance(v, (np.bool_, bool)): return bool(v)
    return v


def table(df, cols, k=4):
    return dict(columns=cols, rows=[[clean(r[c], k) for c in cols] for r in df.to_dict("records")])


def write(INS, CAV):
    rel = pd.read_parquet(M / "player_conditions_reliability.parquet"); summ = pd.read_parquet(M / "player_conditions_summary.parquet")
    resp = pd.read_parquet(M / "player_conditions_responders.parquet"); prof = pd.read_parquet(M / "player_conditions_profiles.parquet"); man = json.loads((ROOT / "data" / "manifests" / "player_conditions.json").read_text())
    # reliability
    r = rel[rel.segment.isin(["all", "top100", "top50"])].rename(columns={"condition": "c", "outcome": "o", "segment": "seg", "temporal_pearson_r": "t_r", "temporal_r_lo": "t_lo", "temporal_r_hi": "t_hi", "temporal_n_pairs": "t_n", "temporal_q_value": "t_q",
                                                                      "odd_even_pearson_r": "oe_r", "odd_even_sb_r": "oe_sb", "odd_even_n_pairs": "oe_n", "odd_even_q_value": "oe_q", "random_pearson_r": "rnd_r", "eb_reliability_pooled_2023_26": "eb_rel",
                                                                      "eb_tau_pooled_2023_26": "tau", "league_mean_pooled_2023_26": "league_mean", "temporal_calib_slope": "slope", "temporal_calib_slope_lo": "slope_lo", "temporal_calib_slope_hi": "slope_hi",
                                                                      "temporal_partial_r_base": "t_partial_r", "temporal_flags_lg_n": "flags_vs_league_n", "temporal_flags_lg_held": "flags_vs_league_held", "temporal_flags_lg_sign_rate": "flags_vs_league_sign_rate"})
    rel_cols = ["c", "o", "seg", "verdict", "persistence_class", "t_r", "t_lo", "t_hi", "t_n", "t_q", "oe_r", "oe_sb", "oe_n", "oe_q", "rnd_r", "eb_rel", "tau", "league_mean", "slope", "slope_lo", "slope_hi", "t_partial_r", "flags_vs_league_n", "flags_vs_league_held", "flags_vs_league_sign_rate"]
    # flagged vs chance (pooled 2023-26)
    s = summ[(summ.timespan == "pooled_2023_26") & summ.segment.isin(["all", "top100", "top50"])].rename(columns={"condition": "c", "outcome": "o", "segment": "seg", "n_players": "n", "n_strong_lg": "strong_vs_league", "n_watch_lg": "watch_vs_league", "exp_strong_lg": "exp_strong_vs_league",
                                                                                                                  "exp_watch_lg": "exp_watch_vs_league", "perm_p_strong_lg": "perm_p_strong_vs_league", "n_strong_nz": "strong_nonzero", "n_watch_nz": "watch_nonzero", "exp_strong_nz": "exp_strong_nonzero", "exp_watch_nz": "exp_watch_nonzero", "eb_reliability": "eb_rel"})
    s["thin"] = s.thin_cell; fl_cols = ["c", "o", "seg", "n", "league_mean", "tau", "eb_rel", "strong_vs_league", "watch_vs_league", "exp_strong_vs_league", "exp_watch_vs_league", "perm_p_strong_vs_league", "strong_nonzero", "watch_nonzero", "exp_strong_nonzero", "exp_watch_nonzero", "thin", "persistence_class"]
    # responders: all-player segment, main outcomes; top 5 each way, top 10 for persistent cells
    pers_cells = set(map(tuple, rel[(rel.segment == "all") & (rel.verdict == "persistent signal")][["condition", "outcome"]].to_numpy()))
    g = resp[(resp.segment == "all") & resp.outcome.isin(C.MAIN_OUTCOMES) & resp.ranking_meaningful].copy()
    g = g[(g["rank"] <= 5) | g.apply(lambda x: (x.condition, x.outcome) in pers_cells, axis=1)]
    g = g.rename(columns={"condition": "c", "outcome": "o", "direction": "dir", "player_id": "pid", "player_name": "name", "n_cond": "n_in", "n_ref": "n_out", "raw_diff": "raw", "shrunk_ci_low": "lo", "shrunk_ci_high": "hi", "raw_diff_2025_26": "raw_2025_26"})
    g["dir"] = g["dir"].map({"top_positive": "pos", "top_negative": "neg"});     rs_cols = ["c", "o", "dir", "rank", "pid", "name", "n_in", "n_out", "raw", "shrunk", "lo", "hi", "league_mean", "flag_vs_league", "shrunk_2023_25", "raw_2025_26", "verdict"]
    # profiles: top-100 players, points vs prior average, plus the top-50 players' 1.5x and +10
    pf = prof[(prof.in_top100 & (prof.outcome == "dev")) | (prof.in_top50 & prof.outcome.isin(["x150", "p10"]))].copy()
    pf = pf.rename(columns={"player_id": "pid", "player_name": "name", "outcome": "o", "condition": "c", "n_cond": "n_in", "n_ref": "n_out", "raw_diff": "raw", "shrunk_ci_low": "lo", "shrunk_ci_high": "hi", "deviation_from_league": "dev_vs_league"})
    pf["side"] = pf.side.map({"most_positive": "pos", "most_negative": "neg"}); pf["in_top50"] = pf.in_top50.astype(bool)
    pr_cols = ["pid", "name", "in_top50", "o", "side", "rank", "c", "n_in", "n_out", "raw", "shrunk", "lo", "hi", "league_mean", "dev_vs_league", "flag_vs_league", "verdict"]
    verdicts = rel[rel.segment == "all"].groupby("verdict").size().to_dict()
    out = dict(
        meta=dict(study="player_conditions", built_through="2026-11-09", default_timespan="pooled_2023_26", provisional_timespans=["pooled_2023_27", "2026_27"], segments_with_own_eb=["all", "top100", "top50"], thin_segments=["top25", "top10"],
                  floor_prior_avg_ppg=8, min_n_both_sides=10, min_n_strong=15, min_n_rank=15, outcomes=C.OUT_LABEL, effect_units=dict(dev="points", x125="rate difference (fraction, x100 = pp)", x150="same", x200="same", p10="same"),
                  flag_rules=dict(strong="shrunk 95% interval excludes 0 (flag) or excludes the league mean (flag_vs_league), n >= 15 on both sides", watch="shrunk 90% interval excludes the target, not strong", note="use flag_vs_league for who responds differently; flag (!= 0) restates the league mean when tau is about 0"),
                  persistence_schemes=man["schemes"], verdict_counts_all_players=verdicts, caveats=CAV, source_tables=man["duckdb_views"]),
        conditions=[dict(id=c[0], group=c[1], label=c[2]) for c in C.CONDS],
        reliability=table(r[rel_cols[0:0] + [c for c in rel_cols if c in r.columns]], [c for c in rel_cols if c in r.columns]),
        flagged_vs_chance=table(s, fl_cols), responders=table(g.sort_values(["c", "o", "dir", "rank"]), rs_cols), profiles=table(pf.sort_values(["pid", "o", "side", "rank"]), pr_cols),
        insights=INS)
    txt = json.dumps(out, separators=(",", ":"), allow_nan=False); OUT.write_text(txt); return OUT, len(txt)
