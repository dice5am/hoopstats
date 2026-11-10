"""data/big_nights_summary.json: compact, App-Builder-ready (NOT wired into the app).  Built from the big_night_* marts.  Nulls, never NaN."""
import json, sys
from pathlib import Path
import numpy as np, pandas as pd
sys.path.insert(0, str(Path(__file__).resolve().parent))
import analysis_home_away_b2b as hab
ROOT = Path(__file__).resolve().parents[1]; M = ROOT / "data" / "marts"
rd = lambda n: pd.read_parquet(M / f"{n}.parquet")
C, MO, L, PF, PR = rd("big_night_counts"), rd("big_night_models"), rd("big_night_factor_lift"), rd("big_night_model_performance"), rd("big_night_same_game_profile")
SB, SI, SC, PS, PP, SH = rd("big_night_star_base_rates"), rd("big_night_stars_interactions"), rd("big_night_stars_vs_nonstars"), rd("big_night_player_summary"), rd("big_night_player_patterns"), rd("big_night_shap")
EV = ["x125", "x150", "x200", "p5", "p10", "z15"]
KEY_A = ["vac_large", "out_top1", "hot_last1", "bb_last1", "bb_last2", "def_worst10", "def_best10", "pace_fast10", "pace_slow10", "b2b_2nd", "home", "opp_leaky_l5", "min_up3", "role_promoted"]
KEY_B = ["b_min_up5", "b_fga_up4", "b_fta_up3", "b_3pa_up3", "b_usg_up5", "b_ts_up10", "ot", "close_le5", "blowout_loss_ge15", "total_hi", "opp_foul_trouble"]


def r(x, k=4):
    if x is None: return None
    try:
        if pd.isna(x): return None
    except Exception: pass
    return round(float(x), k)


def ci(a, b, k=4): return [r(a, k), r(b, k)]


def factor_entry(x):
    e = dict(factor=x.factor, label=x.label, lens=x.lens, n_level=int(x.n_level), events_level=int(x.events_level), rate_level=r(x.rate_level), rate_ref=r(x.rate_ref),
             rr=r(x.rr, 3), rr_ci=ci(x.rr_lo, x.rr_hi, 3), pp=r(x.raw_pp, 2), pp_ci=ci(x.raw_pp_lo, x.raw_pp_hi, 2), reportable=bool(x.reportable))
    if x.lens == "A" and not pd.isna(x.adj_odds_ratio):
        e["adjusted"] = dict(odds_ratio=r(x.adj_odds_ratio, 3), or_ci=ci(x.adj_or_lo, x.adj_or_hi, 3), pp=r(x.adj_pp_effect, 2), pp_ci=ci(x.adj_pp_lo, x.adj_pp_hi, 2), rank=None if pd.isna(x.adj_rank_in_cell) else int(x.adj_rank_in_cell))
    return e


def build(insights, caveats, through, base_commit):
    out = dict(schema_version=1, data_as_of=through, status="NEW data product: not read by the app yet. Descriptive, associational; no causal claims.", base_commit=base_commit,
               provisional_timespans=["2026_27", "pooled_2023_27"], default=dict(timespan="pooled_2023_26", segment="all", baseline="std", floor=8, events=EV),
               definitions=dict(baselines="std = prior season-to-date mean PTS (primary); l10 = last <=10 prior games", events="x125/x150/x200: PTS >= 1.25/1.5/2.0 x baseline; p5/p10: >= baseline + 5/10; z15: (PTS - baseline) / prior SD >= 1.5",
                                floor="prior average >= 8 PPG (default), >= 5/12/none in floor_sensitivity", eligibility=">=5 min played, >=5 prior games this season and overall, opponent with >=5 prior games",
                                thin="a cell or level with < 30 players or < 300 player-games is thin: shown, never ranked; top25 and top10 are always thin (25 / 10 players)", pp="percentage points of absolute probability",
                                lens_A="pregame: knowable at about tip-off", lens_B="same game: describes how the night happened, NOT predictive"),
               counts={}, floor_sensitivity={}, factors={}, model_performance={}, same_game_profile={}, stars_vs_nonstars={}, players={}, insights=insights, caveats=caveats)
    c = C[(C.floor == 8)]
    for x in c.itertuples():
        out["counts"].setdefault(x.timespan, {}).setdefault(x.segment, {}).setdefault(x.baseline, {})[x.event] = dict(n_games=int(x.n_games), n_players=int(x.n_players), n_events=int(x.n_events), base_rate=r(x.base_rate), thin=bool(x.thin_flag), low_events=bool(x.low_events))
    for x in C[(C.timespan == "pooled_2023_26") & (C.segment == "all") & (C.baseline == "std")].itertuples():
        out["floor_sensitivity"].setdefault(str(x.floor), {})[x.event] = dict(n_games=int(x.n_games), n_events=int(x.n_events), base_rate=r(x.base_rate))
    # factors: std baseline, floor 8, cells with a fitted model and not thin
    m_ok = MO[(MO.floor == 8) & (MO.baseline == "std") & MO.term.notna()][["timespan", "segment", "event"]].drop_duplicates()
    for x in m_ok.itertuples():
        g = L[(L.floor == 8) & (L.baseline == "std") & (L.timespan == x.timespan) & (L.segment == x.segment) & (L.event == x.event)]
        if g.empty or g.thin_cell.iloc[0]: continue
        a = g[g.lens == "A"]; ranked = a[a.adj_rank_in_cell.notna()].sort_values("adj_rank_in_cell")
        main = x.timespan == "pooled_2023_26"
        if not main and x.event not in ("x150", "p10", "z15"): continue
        top = ranked.head(8 if main else 0); keyed = a[a.factor.isin(KEY_A if main else KEY_A[:10]) & ~a.factor.isin(top.factor)]
        b = g[(g.lens == "B") & g.factor.isin(KEY_B)]
        out["factors"].setdefault(x.timespan, {}).setdefault(x.segment, {})[x.event] = dict(base_rate=r(g.base_rate.iloc[0]), n_events=int(g.n_cell_events.iloc[0]),
            lens_A_pregame=[factor_entry(t) for t in pd.concat([top, keyed]).itertuples()], lens_B_same_game_NOT_predictive=[factor_entry(t) for t in (b if main else b.iloc[0:0]).itertuples()])
    for x in PF[(PF.floor == 8) & (PF.baseline == "std")].itertuples():
        d = out["model_performance"].setdefault(x.timespan, {}).setdefault(x.segment, {}).setdefault(x.event, {})
        d[x.model] = dict(auc=r(x.auc, 3), auc_ci=ci(x.auc_lo, x.auc_hi, 3), brier=r(x.brier, 4), logloss=r(x.logloss, 4), test_events=int(x.test_events), n_test=int(x.n_test), predictive=bool(x.predictive),
                          dauc_vs_ref=r(getattr(x, "dauc_vs_ref", None), 3), ref=None if pd.isna(getattr(x, "ref_model", None)) else x.ref_model, beats_logistic_pregame=None if pd.isna(getattr(x, "beats_logistic_pregame", None)) else bool(x.beats_logistic_pregame))
    for x in PR[(PR.floor == 8) & (PR.baseline == "std") & PR.event.isin(["x150", "p10"]) & PR.segment.isin(["all", "top100", "top50"]) & PR.timespan.isin(["pooled_2023_26", "2025_26"])].itertuples():
        out["same_game_profile"].setdefault(x.timespan, {}).setdefault(x.segment, {}).setdefault(x.event, {})[x.group] = {k: r(getattr(x, k), 3) for k in ("n_games", "mean_pts", "mean_prior_avg", "d_min", "d_fga", "d_fta", "d_3pa", "d_usg_pp", "d_ts_pp", "share_minutes", "share_shot_rate", "share_efficiency", "mean_margin", "pct_ot", "pct_close", "pct_blowout_win", "pct_opp_foul_trouble")}
    # stars vs non-stars (top100 / top50 + descriptive top25 / top10)
    for x in SB[SB.baseline == "std"].itertuples():
        out["stars_vs_nonstars"].setdefault(x.timespan, {}).setdefault(x.star_def, {}).setdefault("base_rates", {}).setdefault(x.event, {})[x.group] = dict(n_games=int(x.n_games), n_players=int(x.n_players), n_events=int(x.n_events), value=r(x.base_rate), ci=ci(x.ci_low, x.ci_high), thin=bool(x.thin_flag))
    for (ts, sd, ev_), g in SC[(SC.baseline == "std") & SC.reportable & SC.event.isin(["x150", "p10", "z15"]) & SC.star_def.isin(["top100", "top50"]) & SC.timespan.isin(["pooled_2023_26", "2023_24", "2024_25", "2025_26"])].groupby(["timespan", "star_def", "event"]):
        g = g[g.factor.isin(KEY_A)]
        out["stars_vs_nonstars"].setdefault(ts, {}).setdefault(sd, {}).setdefault("factor_comparison", {})[ev_] = [dict(factor=t.factor, label=t.label, star_rr=r(t.star_rr, 3), star_rr_ci=ci(t.star_rr_lo, t.star_rr_hi, 3), non_star_rr=r(t.non_rr, 3), non_star_rr_ci=ci(t.non_rr_lo, t.non_rr_hi, 3),
                      star_pp=r(t.star_rd * 100, 2), non_star_pp=r(t.non_rd * 100, 2), pp_diff=r(t.rd_diff * 100, 2), pp_diff_ci=ci(t.rd_diff_lo * 100, t.rd_diff_hi * 100, 2), rr_ratio=r(t.rr_ratio, 3), rr_ratio_ci=ci(t.rr_ratio_lo, t.rr_ratio_hi, 3)) for t in g.itertuples()]
    for (ts, sd, ev_), g in SI[(SI.baseline == "std") & SI.p_value.notna()].groupby(["timespan", "star_def", "event"]):
        out["stars_vs_nonstars"].setdefault(ts, {}).setdefault(sd, {}).setdefault("interaction_tests", {})[ev_] = dict(n_tests=int(len(g)), n_p_lt_05=int((g.p_value < .05).sum()), expected_p_lt_05_by_chance=r(0.05 * len(g), 2), n_q_lt_10=int((g.q_value < .10).sum()),
                       significant_terms=[dict(factor=t.term, star_or=r(t.star_or, 3), non_star_or=r(t.non_star_or, 3), interaction_or=r(t.interaction_or, 3), ci=ci(t.ci_low, t.ci_high, 3), q=r(t.q_value, 3)) for t in g[g.q_value < .10].itertuples()])
    # players
    for x in PS[PS.timespan.isin(["pooled_2023_26", "2023_24", "2024_25", "2025_26", "2026_27", "pooled_2023_27"])].itertuples():
        out["players"].setdefault(x.timespan, {}).setdefault(x.analysis, {})[x.outcome] = dict(n_players=int(x.n_players), league_mean_diff=r(x.league_mean_diff), tau=r(x.tau), n_abs_z_ge_2_5=int(x.n_abs_z_ge_2_5), expected_abs_z_ge_2_5_by_chance=r(x.expected_watch_by_chance, 2),
            n_p_lt_05=int(x.n_p_lt_05), expected_p_lt_05_by_chance=r(x.expected_p_lt_05_by_chance, 2), n_credible_above_league=int(x.n_credible_above_league), n_credible_below_league=int(x.n_credible_below_league), n_credible_above_top50=int(x.n_credible_above_top50), n_stars_top50=int(x.n_stars_top50), provisional=bool(x.provisional))
    cr = PP[(PP.timespan == "pooled_2023_26") & (PP.credible_above_league | PP.credible_below_league)]
    out["players"]["credible_list_pooled_2023_26"] = [dict(analysis=t.analysis, outcome=t.outcome, player_id=t.player_id, player_name=t.player_name, n_games=int(t.n_games), n_cond=int(t.n_cond), n_ref=int(t.n_ref), observed_rate=r(t.mean_cond), reference_or_expected_rate=r(t.mean_ref), raw_diff_pp=r(t.raw_diff * 100, 2),
        shrunk_diff_pp=r(t.shrunk_diff * 100, 2), shrunk_ci_pp=ci(t.shrunk_ci_low * 100, t.shrunk_ci_high * 100, 2), direction="above_league" if t.credible_above_league else "below_league", in_top50=bool(t.in_top50), in_top100=bool(t.in_top100)) for t in cr.itertuples()
        if t.analysis in ("propensity_vs_expected", "teammates_out_10plus") and t.outcome in ("x150_std", "p10_std")]
    return out


def write(insights, caveats, through="2026-11-09", base_commit="d377ec4"):
    o = build(insights, caveats, through, base_commit)
    p = ROOT / "data" / "big_nights_summary.json"; json.dump(o, open(p, "w"), separators=(",", ":"), allow_nan=False)
    return p, p.stat().st_size
