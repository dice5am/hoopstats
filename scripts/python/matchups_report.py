"""Builds MATCHUPS.md from data/marts/matchups.parquet, matchup_player_splits.parquet and data/manifests/matchups.json. Usage: .venv/bin/python scripts/matchups_report.py"""
import json
from pathlib import Path
import numpy as np, pandas as pd

ROOT = Path(__file__).resolve().parents[1]
TS = ["pooled_2023_26", "pooled_2023_27", "2023_24", "2024_25", "2025_26", "2026_27"]; SG = ["all", "top100", "top50", "top25", "top10"]
LBL = {"min": "minutes", "fga": "FGA", "fta": "FTA", "fg3a": "3PA", "usg_pct": "USG%", "ts_pct": "TS%", "efg_pct": "eFG%", "pace": "pace (player on floor)", "ast_pct": "AST%", "oreb_pct": "OREB%",
       "dreb_pct": "DREB%", "tov_pct": "TOV%", "def_rating": "def rating (player)", "off_rating": "off rating (player)", "net_rating": "net rating", "pie": "PIE",
       "opp_drtg": "opponent DRtg", "opp_pace": "opponent pace", "opp_pts_allowed": "opponent pts allowed", "opp_pts_pos": "opp pts allowed to position /36",
       "is_home": "home", "team_rest": "own rest days", "team_b2b": "own B2B", "opp_rest": "opp rest days", "opp_b2b": "opp B2B"}
f = lambda v, d=3: "n/a" if v is None or pd.isna(v) else f"{v:.{d}f}"
ci = lambda r: f"{r.coef_std:+.2f} [{r.ci_low:+.2f}, {r.ci_high:+.2f}]" if pd.notna(r.ci_low) else f"{r.coef_std:+.2f}"
def tab(rows, head): return "\n".join(["| " + " | ".join(head) + " |", "|" + "---|" * len(head)] + ["| " + " | ".join(str(x) for x in r) + " |" for r in rows])


def main():
    df = pd.read_parquet(ROOT / "data/marts/matchups.parquet"); S = pd.read_parquet(ROOT / "data/marts/matchup_player_splits.parquet")
    m = json.load(open(ROOT / "data/manifests/matchups.json")); L = pd.DataFrame(m["lifts"])
    mod = df[~df.model.str.startswith("screen") & (df.model != "none")].copy()
    mod["base_model"] = mod.model.str.split("@").str[0]; mod["spec"] = mod.model.str.split("@").str[1]
    A = []; add = A.append
    mr = m["matchup_rows"]
    add("# MATCHUPS: opponent and matchup features for player points (hoopstats)\n")
    add(f"Data through **{m['through']}**, 2023-24 to 2026-27 to date. Scripts: `scripts/matchups.py` (build), `scripts/matchups_report.py` (this file), `scripts/matchup_source_probe.py` (matchup-endpoint coverage probe). Same rules as `POINTS_DRIVERS.md`: date split, "
        "cluster-robust CIs, MixedLM, VIF logging, thin flags, *associated with / predicts* (never causes), percentages from totals, nulls not NaN. Tables are in the DuckDB view layer (`matchups`, `matchup_player_splits`, `matchup_opponent_features`). Data deliverable only; not used by the app.\n")
    add("## 1. Headline\n")
    d0 = L[(L.ts == "pooled_2023_26") & (L.seg == "all") & (L.spec == "l10+opp")].set_index("model")
    add(f"- Opponent and context features give a **small but real** lift in the default cell (pooled_2023_26 × all): OLS test MAE {d0.loc['ols_cluster'].mae_box:.3f} → {d0.loc['ols_cluster'].mae_opp:.3f} "
        f"({d0.loc['ols_cluster'].mae_gain:+.3f} pts, 95% CI [{d0.loc['ols_cluster'].mae_gain_ci[0]:+.3f}, {d0.loc['ols_cluster'].mae_gain_ci[1]:+.3f}]); MixedLM {d0.loc['mixedlm'].mae_box:.3f} → {d0.loc['mixedlm'].mae_opp:.3f} "
        f"({d0.loc['mixedlm'].mae_gain:+.3f} [{d0.loc['mixedlm'].mae_gain_ci[0]:+.3f}, {d0.loc['mixedlm'].mae_gain_ci[1]:+.3f}]); prior-average baseline MAE {d0.loc['ols_cluster'].mae_base:.3f}. Test R² {d0.loc['ols_cluster'].r2_box:.4f} → {d0.loc['ols_cluster'].r2_opp:.4f} (OLS), "
        f"{d0.loc['mixedlm'].r2_box:.4f} → {d0.loc['mixedlm'].r2_opp:.4f} (MixedLM). That is about {d0.loc['ols_cluster'].mae_gain / d0.loc['ols_cluster'].mae_box:.1%} of MAE.")
    nl = L[(L.spec == "l10+opp") & L.model.isin(["ols_cluster", "mixedlm"]) & ~L.thin]
    pos = nl[nl.mae_gain_ci.map(lambda x: x[0] > 0)]
    add(f"- Across the non-thin cells, the opponent features' MAE gain has a 95% CI above 0 in **{len(pos)} of {len(nl)}** OLS/MixedLM cell-fits ({', '.join(sorted(set(pos.ts + '×' + pos.seg)))}); in the others the gain is within noise or negative.")
    add("- Opponent pace and opponent DRtg are the opponent variables associated with more points; home is small positive; rest and back-to-back flags are within noise; points allowed to the player's position adds nothing beyond opponent DRtg (details in section 4).")
    add("- Per-player strong-vs-weak-defense splits: the league-average effect is about +0.6 PTS against weak vs strong defenses, individual deviations are small and mostly noise (section 7).\n")
    add("## 2. Definitions (all pregame, strictly prior games, season-bound)\n")
    add("**Opponent for every player-game** comes from `game_meta` (home / away team ids) joined to the box `team_id`; every one of the 3,844 regular-season games has exactly two team rows.\n")
    add("**Opponent features** are computed from the opposing team's **team totals** in its prior games (sum over its box rows with minutes), never from an average of player ratings:\n")
    add(tab([("opp_drtg", "100 × Σ points allowed / Σ possessions", "possessions per game = ½ (own + opp estimate), estimate = FGA + 0.44 FTA − OREB + TOV (team totals)"),
             ("opp_pace", "48 × Σ possessions / Σ game minutes", "game minutes = team minutes / 5 (overtime counted); vs the minute-weighted player pace in the advanced table: corr %.3f, mean diff %+.2f" % (m["checks"]["team_pace_vs_minute_weighted_player_pace"]["corr"], m["checks"]["team_pace_vs_minute_weighted_player_pace"]["mean_diff"])),
             ("opp_pts_allowed", "mean points allowed per game", "overall (all positions)"),
             ("opp_pts_pos", "36 × Σ points scored against the opponent by the player's position group / Σ that group's minutes", "per-36 normalises for the minutes a position group happened to play; position = G / F / C, see below"),
             ("is_home", "1 if the player's team is home", "neutral-site games keep the box `home_away` label (12 games in 4 seasons)"),
             ("team_rest, opp_rest", "days since the team's previous game − 1, capped at 5", "from `game_meta` incl. the Cup final; first game of a season is null"),
             ("team_b2b, opp_b2b", "1 if rest = 0", "")], ["feature", "definition", "notes"]))
    add("\nWindows: **l10** = last up to 10 prior games, **std** = all prior games this season, both within the season. Primary spec = player box inputs at l10 plus the opponent features at l10 (`@l10+opp`); sensitivity = opponent features at std (`@l10+opp_std`); reference = box-only on the same rows (`@l10`). "
        "Checked on 300 random team-games against a hand computation from the raw box: 0 mismatches; the game itself is excluded from every window.\n")
    add("**Position definition.** Primary position from the warehouse roster data used in the home/away analysis (`CommonTeamRoster` for that season, else `PlayerIndex`), first-listed letter of e.g. `G-F` → **G / F / C** (2,185 player-seasons, 0 missing). "
        "Points allowed to a position group counts every played minute of the attacking team's players of that group.\n")
    add(f"**Cold start.** A team's features need ≥ 5 prior games that season (no carry-over from the previous season, so nothing is imputed). Of {mr['eligible_pregame_rows']:,} pregame-eligible player rows, **{mr['dropped_opp_cold_start_lt5_prior']:,} were dropped** because the opponent had fewer than 5 prior games "
        f"(by season: " + ", ".join(f"{k} {v:,}" for k, v in mr["dropped_by_season"].items()) + f"); **{mr['kept_rows']:,} rows are modelled** (" + ", ".join(f"{k} {v:,}" for k, v in mr["kept_by_season"].items()) + "). "
        "Opponent-feature columns are null (never zero) for those team-games in `matchup_opponent_features` (`usable_for_models` = false for 600 team-games). The box-only reference is re-fitted on the same reduced rows, so its numbers differ slightly from `points_drivers` (which keeps the early-season rows).\n")
    add("**Splits and cells.** Identical to `POINTS_DRIVERS.md`: per timespan the last ~20% of game dates is the test set (cut-offs: " + ", ".join(f"{k} {v}" for k, v in m["date_cuts"].items()) + "), pregame segment membership ranked on the train rows only, nested segments all/top100/top50/top25/top10 × 6 timespans, "
        "thin = fewer than 30 players or 300 player-games (counted after the cold-start drop), VIF threshold 10 with the same priority rule (opponent and context features sit below minutes/FGA/FTA/3PA/TS%/USG%/pace/AST%/REB%/TOV% and above eFG%, def/off rating, PIE), "
        "models OLS (player-cluster robust CI), elastic net (time-ordered CV), MixedLM (player intercept), LightGBM + SHAP (kept only if it clearly beats the best linear model).\n")
    add("**Table.** `matchups.parquet` has the `points_drivers` schema (`lens` is always `pregame`). `model` = `<screen_pearson|screen_spearman|ols_cluster|enet|mixedlm|gbm_shap>@<spec>`; spec `l10` = box-only reference, `l10+opp`, `l10+opp_std` = box + opponent. "
        "The `notes` of every `+opp` model row carry the lift versus the box-only model on the same rows (MAE gain, player-cluster bootstrap 95% CI, R² and RMSE before → after).\n")
    add("## 3. Matchup-source decision (nba_api `BoxScoreMatchupsV3`, `LeagueSeasonMatchups`)\n")
    add("**Available:** both endpoints answer for 2022-23 through 2026-27 (checked live: `BoxScoreMatchupsV3` for a 2022-23, a 2023-24 and a 2026-27 game; `LeagueSeasonMatchups` for 2023-24 and 2026-27). `BoxScoreMatchupsV3` is one call per game (≈ 3,844 calls for full coverage); `LeagueSeasonMatchups` is per season but only offers season totals, which would mix in the games being predicted.\n")
    add("**Coverage probe** (`scripts/matchup_source_probe.py`, stratified sample of 160 regular-season games, 40 per season): 159 of 160 games returned rows (1 failed); 3,488 of the 3,504 played player rows in the sampled games matched an offensive player in the matchup data; "
        "a player's matchup points equal his box points exactly for 80.2% of players and the matchup data attributes 99.1% of all box points (free throws and some possessions are unassigned); `positionOff` is blank for 51.4% of rows (bench players).\n")
    add("**Decision: not used in any model.** (1) For a pregame model the useful quantity is who will guard the player tonight, which is unknown before tip-off; prior-game defender assignments would have to be aggregated per opponent, which reproduces what the position-level points-allowed feature already measures. "
        "(2) `positionOff` is blank for about half of the rows, so a defence-by-position feature from it would need the same roster-based position as I already use. (3) Points reconcile exactly for only 80% of players (99.1% of points), so it is not a drop-in verified source. "
        "(4) It would need ≈ 3,844 additional calls for a feature the data cannot be shown to improve on. The box-score-derived opponent features are fully reproducible from the warehouse. The endpoints remain available if Cavin wants a player-vs-defender study later.\n")
    # ---- default cell
    add("## 4. Opponent effects, default cell (pooled_2023_26 × all)\n")
    d = mod[(mod.timespan == "pooled_2023_26") & (mod.segment == "all")]
    o, mx = d[d.model == "ols_cluster@l10+opp"].set_index("driver"), d[d.model == "mixedlm@l10+opp"].set_index("driver")
    en = d[d.model == "enet@l10+opp"].set_index("driver"); sh = d[d.model == "gbm_shap@l10+opp"].set_index("driver")
    rows = [(int(o.loc[k].rank_in_cell), LBL[k] + ("  **(opponent/context)**" if k.startswith(("opp", "is_home", "team_")) else ""), ci(o.loc[k]), int(mx.loc[k].rank_in_cell), ci(mx.loc[k]), f(en.loc[k].coef_std, 2), f(sh.loc[k].shap_mean_abs, 3)) for k in o.sort_values("rank_in_cell").index]
    add("Standardised effects: PTS per +1 SD, 95% CI (OLS player-cluster robust; MixedLM model-based). Associations, not causes.\n")
    add(tab(rows, ["OLS rank", "driver", "OLS", "MixedLM rank", "MixedLM", "elastic net", "SHAP"]))
    lg = [c for c in m["cells"] if c["ts"] == "pooled_2023_26" and c["seg"] == "all" and c.get("spec") == "l10+opp"][0]
    add("\nVIF / definition drops (default cell, `@l10+opp`): " + "; ".join(f"**{LBL.get(x['driver'], x['driver'])}** ({x['reason']})" for x in lg["drops"]) + f". Max VIF after drops {max(lg['vif_final'].values()):.1f}; max |r| among kept {lg['max_corr_kept']:.2f}. "
        f"Elastic net survivors {len(lg['enet']['survivors'])}/{len(lg['kept'])}; MixedLM player variance {lg['mixedlm']['player_var']:.2f} vs residual {lg['mixedlm']['resid_var']:.1f}.\n")
    add("**Read.** Holding the player's own last-10 box profile fixed, a game against an opponent with a higher pregame DRtg (a worse defence) or a faster pace is associated with more points: roughly +0.2 PTS per SD for each (CIs above 0). Home is associated with about +0.08. "
        "Own and opponent rest days and back-to-back flags have CIs that include 0. Points allowed to the player's position (per 36) has a CI that includes 0 once opponent DRtg is in the model. Opponent points allowed per game was dropped by VIF (it is a near-duplicate of DRtg and pace). "
        "These effects are small next to the player's own volume (FGA +4.8 per SD).\n")
    add("### Test fit in the default cell (last 20% of dates)\n")
    sc = d.groupby("model").agg(r2=("test_r2", "first"), mae=("test_mae", "first"), rmse=("test_rmse", "first"), base=("baseline_mae", "first")).reset_index()
    sc = sc[~sc.model.str.startswith("screen")]
    b0 = sc.iloc[0]
    rows = []
    for mod_ in ("ols_cluster", "enet", "mixedlm", "gbm_shap"):
        for sp in ("l10", "l10+opp", "l10+opp_std"):
            r = sc[sc.model == f"{mod_}@{sp}"].iloc[0]
            rows.append((mod_, {"l10": "box only (reference)", "l10+opp": "box + opponent (l10)", "l10+opp_std": "box + opponent (std)"}[sp], f(r.r2), f(r.mae), f(r.rmse), f"{(r.base - r.mae) / r.base:+.1%}"))
    nb = d.notes[d.model == "ols_cluster@l10+opp"].iloc[0]
    import re
    br2, brm = re.search(r"baseline_r2=([\d.-]+)", nb).group(1), re.search(r"baseline_rmse=([\d.-]+)", nb).group(1)
    add(f"Baseline (prior season-to-date average): R² {br2}, MAE {b0.base:.3f}, RMSE {brm}.\n")
    add(tab(rows, ["model", "inputs", "test R²", "test MAE", "test RMSE", "MAE vs baseline"]))
    gk = {k: ("KEPT" if "NOT kept" not in v else "not kept (linear is enough)") for k, v in d[d.model.str.startswith("gbm")].groupby("model").notes.first().items()}
    add("\nBoosting verdict, default cell: " + "; ".join(f"`{k}` {v}" for k, v in gk.items()) + ".\n")
    # ---- lift across cells
    add("## 5. Lift across segments and timespans\n")
    add("MAE in points on the same test rows. `gain` = box-only MAE − box+opponent MAE (positive = the opponent features help) with a player-cluster bootstrap 95% CI; `*` = thin cell (do not read). Primary spec `@l10+opp`, OLS and MixedLM.\n")
    for modl in ("ols_cluster", "mixedlm"):
        rows = []
        for ts in TS:
            for sg in SG:
                x = L[(L.ts == ts) & (L.seg == sg) & (L.spec == "l10+opp") & (L.model == modl)]
                if x.empty: rows.append((ts, sg, "not fitted", "", "", "", "", "")); continue
                r = x.iloc[0]; star = "*" if r.thin else ""
                flag = " **gain**" if (r.mae_gain_ci[0] > 0 and not r.thin) else (" worse" if (r.mae_gain_ci[1] < 0 and not r.thin) else "")
                rows.append((ts, sg + star, f"{r.n_players} / {r.n_games:,}", f(r.mae_base), f(r.mae_box), f(r.mae_opp), f"{r.mae_gain:+.3f} [{r.mae_gain_ci[0]:+.3f}, {r.mae_gain_ci[1]:+.3f}]{flag}", f"{r.r2_box:.3f} → {r.r2_opp:.3f}"))
        add(f"**{modl}**\n"); add(tab(rows, ["timespan", "segment", "players / games", "baseline MAE", "box-only MAE", "box+opp MAE", "gain [95% CI]", "R² box → box+opp"])); add("")
    gl = L[(L.spec == "l10+opp") & L.model.isin(["ols_cluster", "mixedlm"]) & ~L.thin]
    add("**Who gains.** " + "; ".join(f"{k}: {sum(1 for _ in v.itertuples() if _.mae_gain > 0)}/{len(v)} cell-fits with a positive gain" for k, v in gl.groupby("seg")) + ". "
        "The gain is concentrated in the all-player segment of the complete seasons (pooled windows, 2023-24 and 2025-26 with CIs above 0; 2024-25 is flat). In top100 / top50 the point gains are positive in the pools but the CIs include 0. "
        "In 2026-27 (3 test dates, ~1,400 modelled rows after the cold start) the box+opponent model is worse, with a CI that includes 0: provisional and too small to read.\n")
    s = L[(L.spec == "l10+opp_std") & (L.model == "ols_cluster") & (L.ts == "pooled_2023_26") & (L.seg == "all")].iloc[0]
    add(f"Sensitivity: with the opponent features at season-to-date (`@l10+opp_std`) the default-cell OLS gain is {s.mae_gain:+.3f} [{s.mae_gain_ci[0]:+.3f}, {s.mae_gain_ci[1]:+.3f}], smaller than at l10 (the last-10 window is the better pre-declared choice).\n")
    add("**Versus the prior-average baseline** (the thing a bettor already has): in the default cell the box+opponent MixedLM test MAE is %.3f against %.3f for the baseline (%+.1f%%)." % (d0.loc["mixedlm"].mae_opp, d0.loc["mixedlm"].mae_base, 100 * (d0.loc["mixedlm"].mae_base - d0.loc["mixedlm"].mae_opp) / d0.loc["mixedlm"].mae_base) +
        " Gains over the baseline in the high-scorer segments remain small or negative; see the baseline column.\n")
    # opponent effects across cells
    add("## 6. Opponent effects across cells (OLS @l10+opp, PTS per +1 SD, 95% cluster-robust CI)\n")
    for drv in ("opp_drtg", "opp_pace", "is_home", "opp_pts_pos"):
        rows = []
        for ts in TS:
            row = [ts]
            for sg in SG:
                x = mod[(mod.model == "ols_cluster@l10+opp") & (mod.timespan == ts) & (mod.segment == sg) & (mod.driver == drv)]
                if x.empty:
                    z = df[(df.model == "screen_pearson@l10+opp") & (df.timespan == ts) & (df.segment == sg) & (df.driver == drv)]
                    row.append("dropped (VIF)" if len(z) and (z.kept_after_vif.iloc[0] == False) else "not fitted"); continue
                r = x.iloc[0]; row.append(ci(r) + ("*" if r.thin_flag else ""))
            rows.append(row)
        add(f"**{LBL[drv]}** (`*` = thin cell, not ranked; read as unreliable)\n"); add(tab(rows, ["timespan"] + SG)); add("")
    # thin
    th = df[df.thin_flag].groupby(["timespan", "segment"]).agg(p=("n_players", "first"), g=("n_games", "first"), fit=("model", lambda s: not (s == "none").all())).reset_index()
    add("## 6b. Thin cells (< 30 players or < 300 player-games after the cold-start drop): no ranking\n")
    add(tab([(r.timespan, r.segment, r.p, f"{int(r.g):,}", "fitted, unranked" if r.fit else "NOT fitted (too few rows)") for r in th.itertuples()], ["timespan", "segment", "players", "player-games", "status"]))
    add("\nAll top25 and top10 cells are thin (25 and 10 players). 2026-27 top50 is thin too after the cold start (fewer than 300 player-games), and 2026-27 top25 / top10 are not fitted.\n")
    # splits
    add("## 7. Per-player points vs strong / mid / weak defenses (`matchup_player_splits`)\n")
    add("**Definition.** Each opponent is ranked by its pregame season-to-date DRtg among the teams with ≥ 5 games *strictly before that date* (as-of league table, no look-ahead); lowest third = **strong** defense, middle = mid, highest third = **weak**. "
        "Per player and timespan (all his minutes > 0 regular-season games with a ranked opponent): mean PTS vs strong, mid, weak; **raw diff = PPG vs weak − PPG vs strong** (positive = scores more against weak defenses). "
        "SE = the player's game-to-game SD over all his games in the timespan × √(1/n_weak + 1/n_strong), 95% CI with t(gp − 1), as in the home/away splits. **Shrinkage:** DerSimonian–Laird between-player variance τ² over qualifying players of the timespan, shrunk = league mean + w·(raw − league mean), w = τ²/(τ² + se²); "
        "the shrunk interval is the normal-normal posterior (shrunk ± 1.96·√w·se; ignores uncertainty in τ and the mean, so is slightly optimistic). z, p and Benjamini–Hochberg q (strong flag q < 0.10) as before; 'watch' = |z| ≥ 2.5 (nominal). "
        "Floors: games floor per timespan (50 / 40 / 20 / 20 / 20 / 3) and ≥ 5 games vs strong and ≥ 5 vs weak (≥ 3 each in 2026-27). `n_strong`, `n_mid`, `n_weak` are in the table; membership flags `in_all … in_top10` use the app's full-window segments. "
        "Caveats: strong/weak opponents differ in venue, pace and minutes; the contrast is descriptive, not a defender effect.\n")
    rows = []
    for ts in TS:
        v = m["splits"][ts]
        rows.append((ts, v["players_with_floor"], v["players_qualify"], f(v["league_mean_diff_weak_minus_strong"], 2), f(v["tau"], 2), v["n_flag_strong"], f"{v['n_flag_watch']} (≈ {v['expected_watch_by_chance']:.1f} by chance)", f"{v['games_with_tercile_share']:.1%}"))
    add(tab(rows, ["timespan", "players ≥ games floor", "qualify (≥ 5/side)", "league mean diff (pts)", "τ between players (pts)", "strong flags (FDR)", "watch flags", "games with a ranked opponent"]))
    add("\n**Reading.** The league-average player scores about +0.6 more PTS against weak than strong defenses (pooled_2023_26 %.2f, pooled_2023_27 %.2f); between-player variation of the true effect is small (τ ≈ %.2f pts), so shrinkage pulls individual estimates to within about ±1 point of the league mean; "
        "**no player is flagged strong after FDR in any timespan**; the watch flags are 1.1 to 2.0 times the number expected by chance (nominal, not multiplicity-adjusted). 2026-27 is effectively unavailable: only about half the games have an opponent with 5 prior games and only %d players have ≥ 3 games on each side, so it is shown but should not be used.\n" %
        (m["splits"]["pooled_2023_26"]["league_mean_diff_weak_minus_strong"], m["splits"]["pooled_2023_27"]["league_mean_diff_weak_minus_strong"], m["splits"]["pooled_2023_26"]["tau"], m["splits"]["2026_27"]["players_qualify"]))
    for ts in ("pooled_2023_26",):
        x = S[(S.timespan == ts) & S.raw_diff.notna()]
        add(f"**Largest shrunk effects, {ts}** (raw diff with 95% CI, shrunk with interval, shrink weight w, n games vs strong / weak):\n")
        for title, y in (("Scores more vs weak defenses", x.sort_values("shrunk_diff", ascending=False).head(8)), ("Scores less vs weak defenses (relatively better vs strong)", x.sort_values("shrunk_diff").head(8))):
            add(f"*{title}*\n")
            add(tab([(r.player_name, r.position, int(r.gp), f"{int(r.n_strong)} / {int(r.n_weak)}", f"{r.ppg_strong:.1f} / {r.ppg_weak:.1f}", f"{r.raw_diff:+.2f} [{r.ci_low:+.2f}, {r.ci_high:+.2f}]", f"{r.shrunk_diff:+.2f} [{r.shrunk_ci_low:+.2f}, {r.shrunk_ci_high:+.2f}]", f"{r.shrink_weight:.2f}", f"{r.q:.2f}", r.flag or "") for r in y.itertuples()],
                    ["player", "pos", "gp", "n strong / weak", "PPG strong / weak", "raw diff [95% CI]", "shrunk [interval]", "w", "q", "flag"])); add("")
    add("## 8. Data gaps and limitations\n")
    for t in ["Cold start: 1,467 pregame-eligible rows (opponent with < 5 prior games) are excluded from the opponent models; no previous-season carry-over was used, so early-season games are absent from the matchup cells. 2026-27 loses 458 of 1,868 eligible rows.",
              "2026-27 is provisional: 15 game dates, 3 test dates, ~1,400 modelled rows, and half of the games have a ranked opponent for the strong/weak splits (5 players qualify).",
              "Opponent features are team-level and not adjusted for schedule strength; league scoring level differs between seasons (pooled cells share one coefficient). Opponent features are the opponent's *prior* performance, not tonight's lineup, injuries or defender assignments (unavailable pregame).",
              "Possessions are estimated from team totals (FGA + 0.44 FTA − OREB + TOV, averaged over both teams); they track the minute-weighted player pace from the advanced table at corr %.3f." % m["checks"]["team_pace_vs_minute_weighted_player_pace"]["corr"],
              "Position is the primary roster position (G / F / C) of the player-season; hybrid players are assigned their first-listed position. Points allowed per 36 to a position group depend on who played that position for the attacking teams.",
              "Test lifts are one date-split per cell; the paired player-cluster bootstrap measures sampling noise over players, not over different test periods.",
              "The matchup endpoints were checked on a sample only (section 3); no matchup-endpoint data enters any table."]:
        add("- " + t)
    Path(ROOT / "data/marts/MATCHUPS.md").write_text("\n".join(A) + "\n"); print("wrote MATCHUPS.md", len(A))


if __name__ == "__main__":
    main()
