"""Read Data's player x condition study (data/player_conditions_summary.json + data/marts/player_conditions_*.parquet,
read-only) and write what the app renders:

  src/generated/player_conditions.json             per segment x condition x outcome: verdict, reliability,
        flagged-vs-chance, persistence (no player rows; small, loaded with the page).
  public/player-conditions/{all,top100,top50}.json   per segment: the top-10 responders each way per cell. Fetched on demand.
  public/player-conditions/profiles.json            per player: the 3 most / 3 least affected conditions (dev, 1.5x, +10).

No number is invented: every value is a mart value, rounded. The only published timespan is pooled_2023_26 (2026-27
and pooled spans including it are provisional: player rows are not exported). Top 25 / Top 10 are always thin: not exported.
Re-run by hand after Data rebuilds:   python3 scripts/python/export_player_conditions_json.py
Cross-checks: the summary JSON's responders and profiles rows must appear in the marts (same player, condition, shrunk).
"""
import json
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
M = ROOT / "data" / "marts"
SUMMARY = ROOT / "data" / "player_conditions_summary.json"
OUT = ROOT / "public" / "player-conditions"
GEN = ROOT / "src" / "generated" / "player_conditions.json"
TS = "pooled_2023_26"
SEGS = ["all", "top100", "top50"]
OUTCOMES = ["dev", "x125", "x150", "x200", "p10"]


def num(x, k=4):
    if x is None or pd.isna(x):
        return None
    return round(float(x), k)


def main():
    S = json.loads(SUMMARY.read_text())
    resp = pd.read_parquet(M / "player_conditions_responders.parquet")
    rel = pd.read_parquet(M / "player_conditions_reliability.parquet")
    summ = pd.read_parquet(M / "player_conditions_summary.parquet")
    prof = pd.read_parquet(M / "player_conditions_profiles.parquet")
    defs = pd.read_parquet(M / "player_conditions_definitions.parquet")
    assert resp.timespan.eq(TS).all() and prof.timespan.eq(TS).all()

    # ---- cross-check the summary JSON against the marts
    r_cols = S["responders"]["columns"]
    n_chk = 0
    for row in S["responders"]["rows"]:
        d = dict(zip(r_cols, row))
        m = resp[(resp.condition == d["c"]) & (resp.outcome == d["o"]) & (resp.player_id == d["pid"]) & (resp.segment == "all")]
        assert len(m) == 1 and abs(m.shrunk.iloc[0] - d["shrunk"]) < 1e-3, f"responders mismatch {d['c']} {d['o']} {d['name']}"
        n_chk += 1
    p_cols = S["profiles"]["columns"]
    for row in S["profiles"]["rows"]:
        d = dict(zip(p_cols, row))
        m = prof[(prof.player_id == d["pid"]) & (prof.outcome == d["o"]) & (prof.condition == d["c"])]
        assert len(m) >= 1 and (m.shrunk - d["shrunk"]).abs().min() < 1e-3, f"profile mismatch {d['name']} {d['c']}"
        n_chk += 1

    conditions = {r.condition: {"label": r.label, "group": r.condition_group} for r in defs.itertuples()}
    rel_ix = {(r.condition, r.outcome, r.segment): r for r in rel.itertuples()}
    sm = summ[(summ.timespan == TS)]
    sm_ix = {(r.condition, r.outcome, r.segment): r for r in sm.itertuples()}

    def flagc(v):
        return None if v is None or v == "none" or pd.isna(v) else v

    stats_all = {}
    for seg in SEGS:
        cells = {}
        rs = resp[resp.segment == seg]
        for (c, o), g in rs.groupby(["condition", "outcome"]):
            rr = rel_ix[(c, o, seg)]
            ss = sm_ix[(c, o, seg)]

            def rows(direction):
                x = g[g.direction == direction].sort_values("rank")
                out = []
                for t in x.itertuples():
                    held = t.held_vs_league_2023_25_to_2025_26
                    out.append([
                        str(t.player_id), t.player_name, int(t.n_cond), int(t.n_ref), num(t.raw_diff), num(t.shrunk),
                        num(t.shrunk_ci_low), num(t.shrunk_ci_high), flagc(t.flag_vs_league), num(t.deviation_from_league),
                        None if pd.isna(held) else int(bool(held)), num(t.shrunk_2023_25), num(t.raw_diff_2025_26),
                    ])
                return out

            cells[f"{c}|{o}"] = {
                "verdict": rr.verdict, "pclass": rr.persistence_class,
                "rankOk": bool(g.ranking_meaningful.all()),
                "np": int(ss.n_players), "lm": num(ss.league_mean), "tau": num(ss.tau), "rel": num(ss.eb_reliability),
                "strong": int(ss.n_strong_lg), "watch": int(ss.n_watch_lg),
                "expStrong": num(ss.exp_strong_lg), "expWatch": num(ss.exp_watch_lg), "permP": num(ss.perm_p_strong_lg),
                "tr": [num(rr.temporal_pearson_r), num(rr.temporal_r_lo), num(rr.temporal_r_hi), None if pd.isna(rr.temporal_n_pairs) else int(rr.temporal_n_pairs), num(rr.temporal_q_value)],
                "slope": num(rr.temporal_calib_slope), "oe": num(rr.odd_even_sb_r),
                "fl": [None if pd.isna(rr.temporal_flags_lg_n) else int(rr.temporal_flags_lg_n), None if pd.isna(rr.temporal_flags_lg_held) else int(rr.temporal_flags_lg_held), num(rr.temporal_flags_lg_sign_rate)],
                "pos": rows("top_positive"), "neg": rows("top_negative"),
            }
        # cells without responders (too few players) still carry their verdict so the badge is honest
        for (c, o, s), rr in rel_ix.items():
            if s == seg and f"{c}|{o}" not in cells:
                ss = sm_ix.get((c, o, seg))
                cells[f"{c}|{o}"] = {"verdict": rr.verdict, "pclass": rr.persistence_class, "rankOk": False,
                                     "np": int(ss.n_players) if ss is not None else 0, "lm": None, "tau": None, "rel": None,
                                     "strong": 0, "watch": 0, "expStrong": None, "expWatch": None, "permP": None,
                                     "tr": [None, None, None, None, None], "slope": None, "oe": None, "fl": [None, None, None], "pos": [], "neg": []}
        (OUT).mkdir(parents=True, exist_ok=True)
        stats_all[seg] = {k: {a: b for a, b in v.items() if a not in ("pos", "neg")} for k, v in cells.items()}
        cells = {k: {"pos": v["pos"], "neg": v["neg"]} for k, v in cells.items() if v["pos"] or v["neg"]}
        payload = {
            "timespan": TS, "segment": seg, "through": S["meta"]["built_through"],
            "rows_fields": ["player_id", "name", "n_cond", "n_ref", "raw", "shrunk", "lo", "hi", "flag_vs_league", "dev_from_league", "held_vs_league_2023_25_to_2025_26", "shrunk_2023_25", "raw_2025_26"],
            "units": {"dev": "points", "x125": "fraction (x100 = pp)", "x150": "fraction (x100 = pp)", "x200": "fraction (x100 = pp)", "p10": "fraction (x100 = pp)"},
            "cells": cells,
        }
        f = OUT / f"{seg}.json"
        f.write_text(json.dumps(payload, separators=(",", ":"), allow_nan=False))
        print(f"wrote {f.relative_to(ROOT)} {f.stat().st_size/1024:.0f} KB ({len(cells)} cells)")

    GEN.write_text(json.dumps({
        "timespan": TS, "through": S["meta"]["built_through"], "provisional_timespans": S["meta"]["provisional_timespans"],
        "conditions": conditions, "min_n_both_sides": S["meta"]["min_n_both_sides"], "min_n_rank": S["meta"]["min_n_rank"],
        "caveats": S["meta"]["caveats"], "flag_rules": S["meta"]["flag_rules"], "verdict_counts_all_players": S["meta"]["verdict_counts_all_players"],
        "insights": S["insights"], "cells": stats_all,
    }, separators=(",", ":"), allow_nan=False))
    print(f"wrote {GEN.relative_to(ROOT)} {GEN.stat().st_size/1024:.0f} KB")

    # ---- profiles
    out = {}
    for pid, g in prof.groupby("player_id"):
        first = g.iloc[0]
        rows = []
        for t in g.sort_values(["outcome", "side", "rank"]).itertuples():
            held = t.held_vs_league_2023_25_to_2025_26
            rows.append([t.outcome, "pos" if t.side == "most_positive" else "neg", int(t.rank), t.condition, int(t.n_cond), int(t.n_ref),
                         num(t.raw_diff), num(t.shrunk), num(t.shrunk_ci_low), num(t.shrunk_ci_high), num(t.league_mean),
                         num(t.deviation_from_league), flagc(t.flag_vs_league), t.verdict, None if pd.isna(held) else int(bool(held))])
        out[str(pid)] = {"name": first.player_name, "star": bool(first.in_top100), "top50": bool(first.in_top50), "avail": int(first.n_conditions_available), "rows": rows}
    payload = {
        "timespan": TS, "through": S["meta"]["built_through"], "conditions": conditions,
        "rows_fields": ["outcome", "side", "rank", "condition", "n_cond", "n_ref", "raw", "shrunk", "lo", "hi", "league_mean", "dev_from_league", "flag_vs_league", "verdict", "held_vs_league_2023_25_to_2025_26"],
        "players": out,
    }
    f = OUT / "profiles.json"
    f.write_text(json.dumps(payload, separators=(",", ":"), allow_nan=False))
    print(f"wrote {f.relative_to(ROOT)} {f.stat().st_size/1024:.0f} KB ({len(out)} players); cross-checked {n_chk} summary rows")


if __name__ == "__main__":
    main()
