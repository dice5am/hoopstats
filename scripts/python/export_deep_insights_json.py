"""Read the deep-analysis marts (read-only) and data/deep_analyses_summary.json and
write the slim JSON the Insights deep sections render: src/generated/deep_insights.json.

No number is invented: every value is a parquet/summary value, or a plain
difference/count of those (fitted-cell counts, AUC range). The export is not in
prebuild; re-run by hand after Data rebuilds the marts:
    python3 scripts/python/export_deep_insights_json.py
Cross-checks the summary JSON against tier_effects (nested + venue + b2b) and fails on mismatch.
Thin cells (<30 players or <300 games) keep only counts: the UI never ranks them.
"""
import json
import math
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
M = ROOT / "data" / "marts"
SUMMARY = ROOT / "data" / "deep_analyses_summary.json"
OUT = ROOT / "src" / "generated" / "deep_insights.json"
PLAYERS_DIR = ROOT / "public" / "deep-players"  # fetched on demand, one file per timespan

OUTCOMES = ["dev", "big5", "big10", "x125"]
TIER_DIMS = {
    "opp_defence_tier",
    "opp_defence_nested",
    "opp_pace_tier",
    "opp_pace_nested",
    "venue",
    "b2b_state",
    "rest_days",
}


def num(x, k=4):
    if x is None or pd.isna(x):
        return None
    return round(float(x), k)


def main():
    summary = json.loads(SUMMARY.read_text())
    te = pd.read_parquet(M / "tier_effects.parquet")
    tm = pd.read_parquet(M / "tail_models.parquet")
    tp = pd.read_parquet(M / "tail_performance.parquet")
    sp = pd.read_parquet(M / "spline_effects.parquet")
    ie = pd.read_parquet(M / "interaction_effects.parquet")
    de = pd.read_parquet(M / "dispersion_effects.parquet")

    # ---- cross-check summary JSON vs tier_effects (same numbers, different file)
    n_chk = bad = 0
    for ts, segs in summary["cells"].items():
        for seg, c in segs.items():
            for k, v in c["effects"].items():
                dim, lvl = k.split(":")
                dim = dim if dim in ("opp_defence_nested", "opp_pace_nested", "b2b_state") else "venue"
                for o, vv in v.items():
                    r = te[(te.timespan == ts) & (te.segment == seg) & (te.dimension == dim) & (te.level == lvl) & (te.outcome == o)]
                    n_chk += 1
                    a, b = vv["diff"], (None if r.empty else num(r["diff"].iloc[0]))
                    if (a is None) != (b is None) or (a is not None and abs(a - b) > 1e-3):
                        bad += 1
    assert bad == 0, f"summary vs tier_effects mismatches: {bad}/{n_chk}"

    cells = {}
    for (ts, seg), g in te.groupby(["timespan", "segment"]):
        thin = bool(g.thin_flag.iloc[0])
        cell = {
            "thin": thin,
            "n_players": int(g.n_cell_players.iloc[0]),
            "n_games": int(g.n_cell_games.iloc[0]),
        }
        cells.setdefault(ts, {})[seg] = cell
        if thin:
            continue
        eff = {}
        for r in g[g.dimension.isin(TIER_DIMS)].itertuples():
            e = eff.setdefault(f"{r.dimension}:{r.level}", {})
            e[r.outcome] = {
                "l": num(r.est_level),
                "r": num(r.est_ref),
                "d": num(r.diff),
                "lo": num(r.ci_low),
                "hi": num(r.ci_high),
                "nl": int(r.n_level),
                "nr": int(r.n_ref),
                "rr": num(r.ratio),
                "rrlo": num(r.ratio_ci_low),
                "rrhi": num(r.ratio_ci_high),
                "sup": bool(r.suppressed_n_lt_30),
            }
        cell["eff"] = eff

        # adjusted logistic (odds ratios) from tail_models
        t = tm[(tm.timespan == ts) & (tm.segment == seg) & tm.model.isin(["logit_ctx_full", "logit_ctx_nested"]) & tm.outcome.isin(["big5", "big10", "x125"])]
        tail = {}
        for r in t.itertuples():
            o = tail.setdefault(r.outcome, {"base": num(r.base_rate), "events": num(r.n_events, 0), "terms": {}})
            o["terms"][r.term] = {
                "or": num(r.estimate),
                "lo": num(r.ci_low),
                "hi": num(r.ci_high),
                "pp": num(r.abs_prob_diff),
                "pplo": num(r.abs_prob_diff_lo),
                "pphi": num(r.abs_prob_diff_hi),
            }
        if tail:
            cell["tail"] = tail

        # out-of-sample skill of the context logistic
        perf = {}
        pl = tp[(tp.timespan == ts) & (tp.segment == seg) & tp.outcome.isin(["big5", "big10", "x125"])]
        for o, gg in pl.groupby("outcome"):
            ctx = gg[gg.model == "logit_ctx"]
            if ctx.empty:
                continue
            x = ctx.iloc[0]
            perf[o] = {
                "auc": num(x.test_auc),
                "slope": num(x.cal_slope),
                "train": num(x.base_rate_train),
                "test": num(x.test_rate),
                "n_test": int(x.n_test),
                "ll": num(x.logloss_gain_vs_base_rate, 5),
                "llo": num(x.logloss_gain_vs_base_rate_lo, 5),
                "lhi": num(x.logloss_gain_vs_base_rate_hi, 5),
            }
        if perf:
            cell["perf"] = perf

        # spread
        sd = {}
        for r in de[(de.timespan == ts) & (de.segment == seg)].itertuples():
            sd[r.condition] = {"r": num(r.sd_ratio), "lo": num(r.ci_low), "hi": num(r.ci_high)}
        if sd:
            cell["sd"] = sd

        # non-linearity (spline curves + Wald test)
        spl = {}
        s = sp[(sp.timespan == ts) & (sp.segment == seg)]
        for var, key in (("opp_def_u", "def"), ("opp_pace_u", "pace")):
            c = s[(s.variable == var) & (s.kind == "curve")].sort_values("x")
            w = s[(s.variable == var) & (s.kind == "nonlinearity_wald")]
            if c.empty:
                continue
            spl[key] = {
                "p": num(w.wald_p.iloc[0]) if not w.empty else None,
                "pts": [[int(r.x), num(r.fit_pts_vs_prior_avg, 3), num(r.ci_low, 3), num(r.ci_high, 3)] for r in c.itertuples()],
            }
        if spl:
            cell["spline"] = spl

    # role / position moderators (all-players population per timespan)
    inter = {}
    for ts, g in ie[ie.moderator.isin(["position", "role"]) & (ie.condition == "worst10")].groupby("timespan"):
        for mod, gm in g.groupby("moderator"):
            m = inter.setdefault(ts, {}).setdefault(mod, {})
            for r in gm.itertuples():
                if (r.outcome, r.scale) not in {("dev", "pts"), ("x125", "odds_ratio"), ("big10", "odds_ratio")}:
                    continue
                m.setdefault(r.outcome, {})[r.level] = {
                    "e": num(r.estimate),
                    "lo": num(r.ci_low),
                    "hi": num(r.ci_high),
                    "p": num(r.interaction_p, 5),
                    "n": int(r.n_players_level),
                }

    # flag counts vs chance (summary JSON rows)
    flags = {}
    for r in summary["player_deep_summary"]:
        flags.setdefault(r["timespan"], []).append({k: (None if isinstance(v, float) and math.isnan(v) else v) for k, v in r.items() if k != "timespan"})

    # AUC range of the context logistic over non-thin cells (actual values, not the doc's rounded range)
    lc = tp[(tp.model == "logit_ctx") & tp.outcome.isin(["big5", "big10", "x125"]) & ~tp.thin_flag]
    pooled = lc[lc.timespan == "pooled_2023_26"]
    auc = {
        "min": num(lc.test_auc.min(), 3),
        "max": num(lc.test_auc.max(), 3),
        "n": int(len(lc)),
        "pooled_min": num(pooled.test_auc.min(), 3),
        "pooled_max": num(pooled.test_auc.max(), 3),
        "pooled_n": int(len(pooled)),
    }

    out = {
        "through": summary["data_as_of"],
        "outcomes": summary["outcome_definitions"],
        "auc": auc,
        "cells": cells,
        "interactions": inter,
        "flags": flags,
    }
    OUT.write_text(json.dumps(out, separators=(",", ":"), allow_nan=False))
    print("wrote", OUT, OUT.stat().st_size, "bytes; cross-check", n_chk, "ok")


def export_players():
    """Per-player shrunk splits (player_deep_splits), one JSON per non-provisional timespan.

    rows[condition][outcome] = [pid, n_cond, n_ref, raw, shrunk, shrunk_lo, shrunk_hi, z, q, flag, credible]
    credible: 1 = shrunk interval above the league mean, -1 = below, 0 = neither.
    big5 is left out of this view (dev, big10 and x125 only)."""
    d = pd.read_parquet(M / "player_deep_splits.parquet")
    d = d[d.outcome.isin(["dev", "big10", "x125"])]
    PLAYERS_DIR.mkdir(parents=True, exist_ok=True)
    for f in PLAYERS_DIR.glob("*.json"):
        f.unlink()
    for ts, g in d.groupby("timespan"):
        if bool(g.provisional.any()):
            continue  # 2026-27: UI says "not enough games yet"
        players = {}
        for r in g.drop_duplicates("player_id").itertuples():
            players[str(r.player_id)] = [r.player_name, r.position, int(r.in_top10) + int(r.in_top25) + int(r.in_top50) + int(r.in_top100)]
        rows, league, floors = {}, {}, {}
        for (cond, out), gg in g.groupby(["condition", "outcome"]):
            gg = gg.dropna(subset=["shrunk_diff", "shrunk_ci_low", "shrunk_ci_high", "raw_diff"])
            f = gg.iloc[0]
            league.setdefault(cond, {})[out] = [num(f.league_mean_diff), num(f.league_mean_ci_low), num(f.league_mean_ci_high), num(f.tau)]
            floors[cond] = [int(f.min_cond_games), int(f.min_ref_games)]
            rows.setdefault(cond, {})[out] = [
                [
                    str(r.player_id), int(r.n_cond), int(r.n_ref), num(r.raw_diff), num(r.shrunk_diff), num(r.shrunk_ci_low),
                    num(r.shrunk_ci_high), num(r.z, 2), num(r.q, 3),
                    None if pd.isna(r.flag) else str(r.flag),
                    1 if r.credible_above_league else (-1 if r.credible_below_league else 0),
                    int(r.in_top10) * 1 + int(r.in_top25) * 2 + int(r.in_top50) * 4 + int(r.in_top100) * 8,
                ]
                for r in gg.itertuples()
            ]
        out = {"timespan": ts, "floors": floors, "league": league, "players": players, "rows": rows}
        (PLAYERS_DIR / f"{ts}.json").write_text(json.dumps(out, separators=(",", ":"), allow_nan=False))
        print("wrote", ts, (PLAYERS_DIR / f"{ts}.json").stat().st_size, "bytes")


if __name__ == "__main__":
    main()
    export_players()
