"""Assemble deep-analysis marts from the cached cell results (deep_analyses.py) + per-player depth; write parquet, DuckDB views, manifest."""
import json, hashlib, sys, time, warnings
from pathlib import Path
import duckdb, numpy as np, pandas as pd
sys.path.insert(0, str(Path(__file__).resolve().parent))
import deep_analyses as A
import deep_data as DD
import analysis_home_away_b2b as hab
warnings.filterwarnings("ignore")
ROOT = A.ROOT; OUT = A.OUT; MAN = A.MAN
TS_ORDER = {k: i for i, k in enumerate(hab.TIMESPANS)}; SEG_ORDER = {k: i for i, k in enumerate(hab.SEGMENT_IDS)}


def sha(p):
    return hashlib.sha256(open(p, "rb").read()).hexdigest()


def _r(x, k=4):
    return None if x is None or (isinstance(x, float) and np.isnan(x)) else round(float(x), k)


def summary_json(tabs, d):
    """Compact, NEW (not yet app-read) summary for App Builder: data/deep_analyses_summary.json.  Nulls, never NaN."""
    te, tm, de, pdsum = tabs["tier_effects"], tabs["tail_models"], tabs["dispersion_effects"], tabs["player_deep_summary"]
    out = dict(schema_version=1, data_as_of=str(d["G"].game_date.max().date()), notes="Descriptive effects use all eligible rows of the cell with player-clustered 95% CIs; thin = <30 players or <300 games; contrasts with <30 games on a side are null.",
               outcome_definitions=dict(dev="PTS minus prior season-to-date average", big5="PTS >= prior avg + 5", big10="PTS >= prior avg + 10", x125="PTS >= 1.25 x prior avg"), cells={})
    keep = te[te.dimension.isin(["opp_defence_nested", "opp_pace_nested", "venue", "b2b_state"]) & te.level.isin(["worst5", "worst10", "best10", "best5", "fastest10", "slowest10", "home", "2nd", "1st"])]
    for (ts, sg), g in keep.groupby(["timespan", "segment"]):
        c = out["cells"].setdefault(ts, {}).setdefault(sg, {"effects": {}, "adjusted_logit": {}, "sd_ratio": {}})
        for r in g.itertuples():
            c["effects"].setdefault(f"{r.dimension}:{r.level}", {})[r.outcome] = dict(level=_r(r.est_level), reference=_r(r.est_ref), diff=_r(r.diff), ci=[_r(r.ci_low), _r(r.ci_high)], n_games=int(r.n_level), n_players=int(r.n_players_level), thin=bool(r.thin_level))
        t = tm[(tm.timespan == ts) & (tm.segment == sg) & (tm.model == "logit_ctx_nested") & tm.term.isin(["def_worst10", "def_best10"])]
        for r in t.itertuples():
            c["adjusted_logit"].setdefault(r.term, {})[r.outcome] = dict(odds_ratio=_r(r.estimate), ci=[_r(r.ci_low), _r(r.ci_high)], abs_prob_diff=_r(r.abs_prob_diff), abs_prob_diff_ci=[_r(r.abs_prob_diff_lo), _r(r.abs_prob_diff_hi)])
        for r in de[(de.timespan == ts) & (de.segment == sg) & de.condition.isin(["worst5", "worst10", "best10", "home", "b2b_2nd"])].itertuples():
            c["sd_ratio"][r.condition] = dict(ratio=_r(r.sd_ratio), ci=[_r(r.ci_low), _r(r.ci_high)], thin=bool(r.thin_level))
    out["player_deep_summary"] = json.loads(pdsum.to_json(orient="records"))
    json.dump(out, open(ROOT / "data" / "deep_analyses_summary.json", "w"), indent=1, allow_nan=False)


def main(cache="/tmp/deep_results.pkl", through="2026-11-09"):
    res = pd.read_pickle(cache)
    parts = {k: [] for k in ("tier", "spline", "tail", "perf", "cal", "disp")}; logs = []; inter = []
    for k, v in res.items():
        if k[0] == "cell":
            for n in parts: parts[n] += v[n]
            logs.append(v["log"])
        else:
            inter += v
    d = DD.build(through); WM = d["WM"]
    tabs = {}
    tabs["tier_effects"] = pd.DataFrame(parts["tier"])
    te = tabs["tier_effects"]; sup = (te.n_level < 30) | (te.n_ref < 30)
    te["suppressed_n_lt_30"] = sup
    for c in ("diff", "se", "ci_low", "ci_high", "ratio", "ratio_ci_low", "ratio_ci_high"):
        te.loc[sup, c] = np.nan          # fewer than 30 games on either side: no contrast reported (null)
    tabs["spline_effects"] = pd.DataFrame(parts["spline"])
    tabs["tail_models"] = pd.DataFrame(parts["tail"])
    tabs["tail_performance"] = pd.DataFrame(parts["perf"])
    tabs["tail_calibration"] = pd.DataFrame(parts["cal"])
    tabs["dispersion_effects"] = pd.DataFrame(parts["disp"])
    tabs["interaction_effects"] = pd.DataFrame(inter)
    pp, ps = [], []
    for ts in hab.TIMESPANS:
        a, b = A.player_deep(WM, d["G"], d["floors"], ts); pp.append(a); ps.append(b)
    tabs["player_deep_splits"] = pd.concat(pp, ignore_index=True); tabs["player_deep_summary"] = pd.concat(ps, ignore_index=True)
    for name, df in tabs.items():
        if "timespan" in df.columns:
            sort = ["timespan"] + (["segment"] if "segment" in df.columns else [])
            df = df.sort_values(sort, key=lambda s: s.map(TS_ORDER if s.name == "timespan" else SEG_ORDER), kind="mergesort").reset_index(drop=True)
        tabs[name] = df
        df.to_parquet(OUT / f"{name}.parquet", index=False)
    con = duckdb.connect(str(OUT / "nba_phase1.duckdb"))
    for name in tabs:
        con.execute(f"CREATE OR REPLACE VIEW {name} AS SELECT * FROM read_parquet('{(OUT / f'{name}.parquet').resolve()}')")
    con.close()
    # dataset-level facts for the manifest
    base = {o: float(WM[o].mean()) for o in ("big5", "big10", "x125")}
    man = dict(script="scripts/deep_analyses.py + deep_data.py + deep_assemble.py", through=through, rows=len(WM), rows_by_season=WM.season.value_counts().to_dict(), base_rates_all=base,
               date_cuts={k: str(v.date()) for k, v in d["CUTS"].items()}, floors=d["floors"], matchup_row_info=d["info"], cells=logs,
               tables={n: dict(rows=int(len(df)), sha256=sha(OUT / f"{n}.parquet")) for n, df in tabs.items()},
               definitions=dict(prior_avg="season-to-date mean PTS over prior games (>=3 prior this season, >=5 overall; >=5-minute games)", big5="PTS >= prior_avg + 5", big10="PTS >= prior_avg + 10", x125="PTS >= 1.25 * prior_avg",
                                def_tier="as-of season-to-date opponent DRtg rank (teams with >=5 games strictly before the date) -> worst5 (ranks 26-30 of 30) / worst6_10 / middle (11-20) / best6_10 / best5; nested worst10 = worst5 + worst6_10",
                                pace_tier="same on as-of season-to-date pace (fastest5 ... slowest5)", usage_tier="prior season-to-date USG%: <18 / 18-24 / 24-28 / >=28", min_tier="prior season-to-date minutes: <20 / 20-28 / 28-34 / >=34",
                                rest="own team rest days 0/1/2/3+; b2b_state 2nd/1st/rested from the schedule", role="starter if started >= 50% of prior games this season",
                                bootstrap=dict(quantile=A.BOOT_Q, sd_ratio=A.BOOT_SD, ame_draws=A.SIM_AME), watch_z=A.Z_WATCH, fdr_q=A.Q_STRONG, thin=[A.P.THIN_PLAYERS, A.P.THIN_GAMES]))
    json.dump(man, open(MAN / "deep_analyses.json", "w"), indent=1, default=str)
    summary_json(tabs, d)
    print({n: len(df) for n, df in tabs.items()})
    return tabs


if __name__ == "__main__":
    main()
