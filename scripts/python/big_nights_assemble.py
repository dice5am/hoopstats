"""Assemble the big-nights marts from the cached cell / timespan results; write parquet, DuckDB views and the manifest.  (Summary JSON: big_nights_summary.py; doc: big_nights_report.py.)"""
import glob, hashlib, json, sys, warnings
from pathlib import Path
import duckdb, numpy as np, pandas as pd
sys.path.insert(0, str(Path(__file__).resolve().parent))
import analysis_home_away_b2b as hab
import big_nights_analysis as B
warnings.filterwarnings("ignore")
ROOT = B.ROOT; OUT = ROOT / "data" / "marts"; MAN = ROOT / "data" / "manifests"; CACHE = B.CACHE
TS_ORDER = {k: i for i, k in enumerate(hab.TIMESPANS)}; SEG_ORDER = {k: i for i, k in enumerate(hab.SEGMENT_IDS)}


def sha(p): return hashlib.sha256(open(p, "rb").read()).hexdigest()


def load():
    R = {k: [] for k in ("counts", "lift", "model", "perf", "shap", "profile")}; logs = []
    for f in sorted(glob.glob(str(CACHE / "cells" / "*.pkl"))):
        o = pd.read_pickle(f)
        for k in R: R[k] += o[k]
        logs.append(o["log"])
    T = {k: pd.DataFrame(v) for k, v in R.items()}
    S = {k: [] for k in ("cmp", "inter", "base", "players", "psum")}
    for ts in hab.TIMESPANS:
        o = pd.read_pickle(CACHE / "ts" / f"{ts}.pkl")
        for k in S: S[k].append(o[k])
    S = {k: pd.concat(v, ignore_index=True) for k, v in S.items()}
    return T, S, logs


def main(through="2026-11-09"):
    T, S, logs = load(); B.init(); WM = B.WM
    tabs = {}
    # ---- counts
    c = T["counts"]; tabs["big_night_counts"] = c
    # ---- model terms + ranks
    m = T["model"].copy()
    m["rank_in_cell"] = np.nan; m["ci_excludes_null"] = (m.or_lo > 1) | (m.or_hi < 1)
    ok = m.term.notna() & (~m.is_control.fillna(True).astype(bool)) & (~m.thin_flag.fillna(True).astype(bool))
    m.loc[ok, "rank_in_cell"] = m[ok].assign(a=lambda d: d.ame.abs()).groupby(["floor", "baseline", "event", "timespan", "segment", "lens"]).a.rank(ascending=False, method="first")
    tabs["big_night_models"] = m
    # ---- lift + adjusted
    L = T["lift"].copy()
    mm = m[m.term.notna() & (~m.is_control.fillna(True).astype(bool))][["floor", "baseline", "event", "timespan", "segment", "lens", "term", "odds_ratio", "or_lo", "or_hi", "ame", "ame_lo", "ame_hi", "rank_in_cell"]]
    mm = mm.rename(columns={"term": "factor", "odds_ratio": "adj_odds_ratio", "or_lo": "adj_or_lo", "or_hi": "adj_or_hi", "ame": "adj_pp_effect", "ame_lo": "adj_pp_lo", "ame_hi": "adj_pp_hi", "rank_in_cell": "adj_rank_in_cell"})
    for cc in ("adj_pp_effect", "adj_pp_lo", "adj_pp_hi"): mm[cc] = mm[cc] * 100
    mm = mm[mm.lens == "A"]    # the lens-B model is an accounting identity (its terms are conditional on the spikes), so no 'adjusted' column is attached to same-game lifts
    L = L.merge(mm, on=["floor", "baseline", "event", "timespan", "segment", "lens", "factor"], how="left")
    for a, b in (("rd", "pp"), ("rd_lo", "pp_lo"), ("rd_hi", "pp_hi")): L[f"raw_{b}"] = L[a] * 100
    tabs["big_night_factor_lift"] = L
    # ---- performance, shap, profile
    P = T["perf"].copy(); P["beats_logistic_pregame"] = P.get("beats_logistic_pregame")
    tabs["big_night_model_performance"] = P
    pr = T["profile"].copy()
    for c_ in ("share_minutes", "share_shot_rate", "share_efficiency"): pr.loc[pr.group != "big_night", c_] = np.nan     # log-shares are only defined for the excess of the event games
    tabs["big_night_shap"] = T["shap"]; tabs["big_night_same_game_profile"] = pr
    # ---- stars, players
    tabs["big_night_stars_vs_nonstars"] = S["cmp"]; tabs["big_night_stars_interactions"] = S["inter"]; tabs["big_night_star_base_rates"] = S["base"]
    pl = S["players"]
    tabs["big_night_player_patterns"] = pl
    ps = S["psum"].copy()
    z = pl.assign(absz=pl.z.abs() >= 2.5).groupby(["timespan", "analysis", "outcome"]).absz.sum().rename("n_abs_z_ge_2_5").reset_index()
    ps = ps.merge(z, on=["timespan", "analysis", "outcome"], how="left")
    tabs["big_night_player_summary"] = ps
    # ---- event-level mart
    keep = ["season", "game_id", "game_date", "player_id", "team_id", "opp_team_id", "pos", "pts", "min", "fga", "fta", "fg3a", "usg_pct", "ts_pct", "avg_std", "avg_l10", "prior_sd_std", "prior_sd_l10", "n_prior_season", "dev_std", "dev_l10", "z_std", "z_l10"]
    keep += [f"e_{e}_{w}" for w in B.BASELINES for e in B.EVENTS]
    keep += ["bb_last1", "bb_last2", "bb_l3mean", "hot_last1", "hot_l3mean", "hot_l5", "cold_l5", "bignight_last1", "def_tier", "pace_tier", "opp_def_u", "opp_pace_u", "b2b_state", "rest_cat", "home", "opp_b2b", "opp_form_l1", "opp_form_l5",
             "out_n", "out_ppg", "out_max_ppg", "out_top1", "out_starter", "vac_tier", "opp_out_ppg", "min_trend_l5", "role_promoted", "role_demoted", "phase", "cup_game",
             "ot", "margin", "total_pts", "opp_starters_pf5", "opp_team_pf", "min_delta", "lg_min", "lg_rate", "lg_eff"]
    ev = WM[keep].copy(); ev["game_date"] = ev.game_date.dt.date
    ev["floor8_default"] = (ev.avg_std >= 8)
    ev["provisional_2026_27"] = ev.season == "2026-27"
    ev = ev.rename(columns={"min": "minutes", "pos": "position", "pts": "points"})
    tabs["big_night_events"] = ev
    for name, df in tabs.items():
        if "timespan" in df.columns:
            sort = ["timespan"] + (["segment"] if "segment" in df.columns else [])
            df = df.sort_values(sort, key=lambda s: s.map(TS_ORDER if s.name == "timespan" else SEG_ORDER), kind="mergesort").reset_index(drop=True)
        tabs[name] = df; df.to_parquet(OUT / f"{name}.parquet", index=False, compression="zstd")
    con = duckdb.connect(str(OUT / "nba_phase1.duckdb"))
    for name in tabs: con.execute(f"CREATE OR REPLACE VIEW {name} AS SELECT * FROM read_parquet('{(OUT / f'{name}.parquet').resolve()}')")
    con.close()
    meta = pd.read_pickle(CACHE / "bn_meta.pkl")
    man = dict(script="scripts/python/big_nights_data.py + big_nights_analysis.py + big_nights_players.py + big_nights_assemble.py + big_nights_summary.py + big_nights_report.py", through=through, rows=int(len(WM)), rows_by_season={k: int(v) for k, v in WM.season.value_counts().items()},
               rows_floor8=int((WM.avg_std >= 8).sum()), date_cuts={k: str(v.date()) for k, v in meta["CUTS"].items()}, floors_games=meta["floors"], matchup_row_info=meta["info"], cell_logs=logs,
               tables={n: dict(rows=int(len(df)), sha256=sha(OUT / f"{n}.parquet")) for n, df in tabs.items()},
               definitions=dict(
                   eligibility=">=5 minutes played; >=5 prior games this season and >=5 overall; opponent with >=5 prior games; regular season (game_id prefix 002, NBA Cup group/knockout included, Cup final excluded)",
                   baselines="std = prior season-to-date mean PTS (primary); l10 = mean PTS of the last <=10 prior games (chronological, can span the previous season's end)",
                   events="x125/x150/x200: PTS >= 1.25/1.5/2.0 x baseline; p5/p10: PTS >= baseline + 5/10; z15: (PTS - baseline)/prior SD >= 1.5 (prior SD over the same window: std needs >=5 prior games this season, l10 needs a full 10; SD > 0.5)",
                   floors="prior average >= floor; floors 8 (default), 12, 5 and none (>0). Sensitivity tables carry every floor",
                   weak_last="last game < 0.75 x prior season-to-date average; last2 = both of the last 2 games below 0.75x; l3mean = mean of last 3 below 0.75x; hot_last1 >= 1.25x; bignight_last1 >= 1.5x; hot_l5 = last-5 mean >= 1.15x; cold_l5 < 0.85x",
                   opp_tiers="as-of season-to-date opponent DRtg rank (teams with >=5 games strictly before the date): worst5/worst6_10/middle/best6_10/best5; pace tiers likewise (fastest..slowest)",
                   opp_form="opponent DRtg over its last 5 (or last 1) games minus its season-to-date DRtg, all prior games; leaky = >= +3 (l5) / +10 (l1), tight = <= -3 / -10",
                   teammates_out="a teammate is a REGULAR if before the game: >=5 GP with the team this season, in >=50% of the team's games, >=20 min per game played. 'Out' = inactive list, or DNP for a non-coach reason (injury / illness / rest / personal / suspension / not with team); DNP-coach's-decision is not counted. Vacuum size = sum of the out regulars' prior PPG: none / <10 / 10-20 / 20+. Known at about tip-off (inactive list), not days ahead for late scratches",
                   minutes_role="min_up3 / min_dn3: last-5 minutes >= / <= 3 vs season average; role_promoted = started >=2 of last 3 while season start rate < 50%; role_demoted = started 0 of last 3 with season start rate >= 50%",
                   season_phase="early Oct-Nov, mid Dec-Feb, late Mar-Apr; cup_game = NBA Cup group or knockout game (game_meta.game_type)",
                   lens_B="same game, explains the night and is NOT predictive: minutes +5, FGA +4, FTA +3, 3PA +3, usage +5 pts, TS% +-10 pts vs prior; overtime (team minutes > 48.5); margin/blowout (15+) / close (<=5); combined score; opposing starter with >=5 fouls (box-score PF); exact log decomposition pts = minutes x shot rate x efficiency",
                   thin=[B.P.THIN_PLAYERS, B.P.THIN_GAMES], thin_events=f"cells with < {B.MIN_EVENTS_LIFT} events get no lifts; logistic needs >= {B.MIN_EVENTS_MODEL} events; AUC scoring needs >= {B.MIN_TRAIN_EV} train and >= {B.MIN_TEST_EV} test events; a lift is 'reportable' only if the cell and the level are not thin and the level and reference each have >= {B.MIN_LEVEL_EV} events",
                   test_split="date-based: last ~20% of dates per timespan (same cut-offs as points_drivers / matchups / deep); segment membership from train-period PPG ranks",
                   boosting="LightGBM on the pregame inputs, early stopping on the last 15% of train dates; kept (and SHAP computed) only if AUC gain >= 0.005 with paired player-cluster bootstrap CI above 0, log-loss CI below 0 and lower Brier than the pregame logistic",
                   bootstrap=dict(auc=B.BOOT, ame_draws=B.SIM_AME), watch_z=2.5, fdr_q=0.10))
    json.dump(man, open(MAN / "big_nights.json", "w"), indent=1, default=str)
    print({n: len(df) for n, df in tabs.items()})
    return tabs


if __name__ == "__main__":
    main()
