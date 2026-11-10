"""Read Data's big-nights study (data/big_nights_summary.json + data/marts/big_night_*.parquet, read-only)
and write the slim JSON the Insights "Big nights" topic renders: src/generated/big_nights.json.

No number is invented. Every value is a mart/summary value, a plain count of those, or one transparent
aggregate over the published events table (context base rates: share of eligible player-games that reach
the event, Wilson 95% interval). The export is not in prebuild; re-run by hand after Data rebuilds:
    python3 scripts/python/export_big_nights_json.py
Cross-checks the lift mart against the summary JSON (rr + adjusted OR, pooled_2023_26 all, std) and fails on mismatch.
Thin cells (<30 players or <300 player-games) keep counts only. 2026-27 player flags are not exported.
"""
import json
import math
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
M = ROOT / "data" / "marts"
SUMMARY = ROOT / "data" / "big_nights_summary.json"
OUT = ROOT / "src" / "generated" / "big_nights.json"

EVENTS = ["x125", "x150", "x200", "p5", "p10", "z15"]
SEGS = ["all", "top100", "top50"]
TSS = ["pooled_2023_27", "pooled_2023_26", "2023_24", "2024_25", "2025_26", "2026_27"]
SEASONS = {
    "pooled_2023_27": ["2023-24", "2024-25", "2025-26", "2026-27"],
    "pooled_2023_26": ["2023-24", "2024-25", "2025-26"],
    "2023_24": ["2023-24"],
    "2024_25": ["2024-25"],
    "2025_26": ["2025-26"],
    "2026_27": ["2026-27"],
}
# factors the app reads (std baseline: all; l10 baseline: the stale-average / role / vacuum set)
FACTORS_STD = [
    "vac_large", "vac_med", "vac_small", "vac_star", "out_top1", "out_starter", "opp_vac_ge10",
    "bb_last1", "bb_last2", "bb_l3mean", "hot_last1", "hot_l3mean", "min_up3", "min_dn3", "role_promoted", "role_demoted",
    "def_worst10", "def_best10", "pace_fast10", "pace_slow10",
    "home", "b2b_2nd", "b2b_1st", "rest_r0", "rest_r2", "rest_r3plus", "opp_leaky_l5", "opp_leaky_l1", "phase_early", "phase_late", "cup_game",
]
FACTORS_L10 = ["vac_large", "vac_med", "out_top1", "bb_last1", "bb_last2", "bb_l3mean", "hot_last1", "hot_l3mean", "min_up3", "min_dn3", "role_promoted", "role_demoted"]

AVG_TIERS = [(8, 12, "8–12 PPG"), (12, 16, "12–16 PPG"), (16, 20, "16–20 PPG"), (20, 1000, "20+ PPG")]
VAC = [("none", "none out"), ("small_lt10", "under 10 PPG out"), ("medium_10_20", "10–20 PPG out"), ("large_ge20", "20+ PPG out")]
MIN_PLAYERS, MIN_GAMES = 30, 300  # Data's thin rule


def num(x, k=4):
    if x is None or pd.isna(x):
        return None
    return round(float(x), k)


def wilson(k, n, z=1.96):
    if n == 0:
        return None, None
    p = k / n
    d = 1 + z * z / n
    c = p + z * z / (2 * n)
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return (c - h) / d, (c + h) / d


def main():
    S = json.loads(SUMMARY.read_text())
    fl = pd.read_parquet(M / "big_night_factor_lift.parquet")
    fl = fl[(fl.floor == 8)]
    pp = pd.read_parquet(M / "big_night_player_patterns.parquet")
    ev = pd.read_parquet(M / "big_night_events.parquet")

    # ---- lift: ts -> seg -> baseline -> event -> factor -> row
    lift: dict = {}
    labels: dict = {}
    sub = fl[fl.timespan.isin(TSS) & fl.segment.isin(SEGS) & fl.event.isin(EVENTS) & fl.lens.eq("A")]
    for r in sub.itertuples(index=False):
        if r.baseline == "std" and r.factor not in FACTORS_STD:
            continue
        if r.baseline == "l10" and r.factor not in FACTORS_L10:
            continue
        flags = (1 if r.reportable else 0) + (2 if r.thin_level else 0)
        row = [
            num(r.rate_level), num(r.rate_ref), int(r.n_level), int(r.events_level),
            num(r.rr, 3), num(r.rr_lo, 3), num(r.rr_hi, 3),
            num(r.adj_odds_ratio, 3), num(r.adj_or_lo, 3), num(r.adj_or_hi, 3),
            num(r.adj_pp_effect, 2), num(r.adj_pp_lo, 2), num(r.adj_pp_hi, 2),
            flags,
        ]
        labels[r.factor] = {"label": r.label, "ref": r.reference}
        lift.setdefault(r.timespan, {}).setdefault(r.segment, {}).setdefault(r.baseline, {}).setdefault(r.event, {})[r.factor] = row

    # ---- cross-check vs summary (std, pooled_2023_26, all)
    bad = n_chk = 0
    for ev_id, blk in S["factors"]["pooled_2023_26"]["all"].items():
        for row in blk["lens_A_pregame"]:
            mine = lift["pooled_2023_26"]["all"]["std"][ev_id].get(row["factor"])
            if mine is None:
                continue
            n_chk += 1
            a = row["adjusted"]
            if abs(mine[4] - row["rr"]) > 1e-3 or (a and abs(mine[7] - a["odds_ratio"]) > 1e-3):
                bad += 1
    assert bad == 0, f"{bad}/{n_chk} lift rows disagree with the summary JSON"

    # ---- counts (std) and model performance (controls vs pregame)
    counts = {
        ts: {seg: {e: S["counts"][ts][seg]["std"][e] for e in EVENTS} for seg in S["counts"][ts]} for ts in TSS
    }
    perf: dict = {}
    aucs = []
    for ts, segs in S["model_performance"].items():
        for seg, evs in segs.items():
            for e, mods in evs.items():
                lp, lc = mods.get("logit_pregame"), mods.get("logit_controls")
                if not lp or lp.get("auc") is None:
                    continue
                perf.setdefault(ts, {}).setdefault(seg, {})[e] = {
                    "auc": lp["auc"], "lo": lp["auc_ci"][0], "hi": lp["auc_ci"][1],
                    "ctl": None if not lc else lc["auc"], "d": lp.get("dauc_vs_ref"),
                    "nt": lp["n_test"], "ne": lp["test_events"],
                }
                if seg in ("all", "top100", "top50") and not S["counts"][ts][seg]["std"][e]["thin"]:
                    aucs.append((lp["auc"], ts, seg, e))
    auc_range = {
        "min": min(aucs)[0], "max": max(aucs)[0], "n": len(aucs),
        "pooled_min": min(a for a in aucs if a[1] == "pooled_2023_26")[0],
        "pooled_max": max(a for a in aucs if a[1] == "pooled_2023_26")[0],
        "pooled_n": sum(1 for a in aucs if a[1] == "pooled_2023_26"),
    }

    # ---- credible players (shrunk interval excludes the league mean); none for 2026-27 (hidden)
    sel = pp[pp.analysis.isin(["propensity_vs_expected", "teammates_out_10plus"]) & pp.outcome.isin(["x150_std", "p10_std"]) & pp.timespan.isin(TSS)]
    sel = sel[sel.credible_above_league.fillna(False) | sel.credible_below_league.fillna(False)]
    cred: dict = {}
    for r in sel.itertuples(index=False):
        if r.timespan == "2026_27":
            continue
        cred.setdefault(r.timespan, []).append({
            "id": str(r.player_id), "name": r.player_name, "an": r.analysis, "out": r.outcome,
            "dir": "above" if r.credible_above_league else "below",
            "nc": int(r.n_cond), "nr": int(r.n_ref), "raw": num(r.raw_diff * 100, 2), "sh": num(r.shrunk_diff * 100, 2),
            "lo": num(r.shrunk_ci_low * 100, 2), "hi": num(r.shrunk_ci_high * 100, 2),
            "flag": None if pd.isna(r.flag) else r.flag, "z": num(r.z, 2), "top50": bool(r.in_top50),
        })
    for ts in cred:
        cred[ts].sort(key=lambda x: (x["an"], x["out"], -abs(x["sh"])))
    # cross-check the pooled_2023_26 list against Data's own list
    mine = {(c["id"], c["an"], c["out"]) for c in cred["pooled_2023_26"] if (c["an"], c["out"]) in {("propensity_vs_expected", "x150_std"), ("teammates_out_10plus", "x150_std"), ("propensity_vs_expected", "p10_std")}}
    theirs = {(c["player_id"], c["analysis"], c["outcome"]) for c in S["players"]["credible_list_pooled_2023_26"]}
    assert theirs <= mine, f"credible list mismatch: {theirs - mine}"

    players = {}
    for ts in TSS:
        if ts == "2026_27":
            continue
        players[ts] = {a: v for a, v in S["players"][ts].items()}

    # ---- context base rates: tier of prior average x teammates out (all players, std baseline, 8+ PPG floor)
    ev8 = ev[ev.floor8_default]
    context: dict = {}
    for ts in TSS:
        d = ev8[ev8.season.isin(SEASONS[ts])]
        cells = []
        for lo, hi, lab in AVG_TIERS:
            t = d[(d.avg_std >= lo) & (d.avg_std < hi)]
            for vk, vlab in VAC:
                c = t[t.vac_tier == vk]
                n = len(c)
                row = {"tier": lab, "vac": vlab, "n": n, "players": int(c.player_id.nunique()), "thin": bool(c.player_id.nunique() < MIN_PLAYERS or n < MIN_GAMES)}
                for e in ("x150", "p10"):
                    k = int(c[f"e_{e}_std"].fillna(0).sum())
                    lo_, hi_ = wilson(k, n)
                    row[e] = {"k": k, "r": num(k / n) if n else None, "lo": num(lo_), "hi": num(hi_)}
                cells.append(row)
        context[ts] = cells

    out = {
        "through": S["data_as_of"],
        "status": S["status"],
        "provisional_timespans": S["provisional_timespans"],
        "default": S["default"],
        "definitions": S["definitions"],
        "counts": counts,
        "lift_fields": ["rate_level", "rate_ref", "n_level", "events_level", "rr", "rr_lo", "rr_hi", "adj_or", "adj_or_lo", "adj_or_hi", "adj_pp", "adj_pp_lo", "adj_pp_hi", "flags(1=reportable,2=thin_level)"],
        "lift": lift,
        "factor_labels": labels,
        "perf": perf,
        "auc_range": auc_range,
        "stars": S["stars_vs_nonstars"],
        "profile": S["same_game_profile"],
        "players": players,
        "credible": cred,
        "context": context,
        "context_tiers": [t[2] for t in AVG_TIERS],
        "caveats": S["caveats"],
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, separators=(",", ":"), allow_nan=False))
    print(f"wrote {OUT.relative_to(ROOT)} {OUT.stat().st_size/1024:.0f} KB; lift cross-check {n_chk} rows ok; auc range {auc_range}")


if __name__ == "__main__":
    main()
