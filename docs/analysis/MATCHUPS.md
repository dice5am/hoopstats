# MATCHUPS: opponent and matchup features for player points (hoopstats)

Data through **2026-11-09**, 2023-24 to 2026-27 to date. Scripts: `scripts/matchups.py` (build), `scripts/matchups_report.py` (this file), `scripts/matchup_source_probe.py` (matchup-endpoint coverage probe). Same rules as `POINTS_DRIVERS.md`: date split, cluster-robust CIs, MixedLM, VIF logging, thin flags, *associated with / predicts* (never causes), percentages from totals, nulls not NaN. Tables are in the DuckDB view layer (`matchups`, `matchup_player_splits`, `matchup_opponent_features`). Data deliverable only; not used by the app.

## 1. Headline

- Opponent and context features give a **small but real** lift in the default cell (pooled_2023_26 × all): OLS test MAE 4.761 → 4.746 (+0.015 pts, 95% CI [+0.009, +0.021]); MixedLM 4.748 → 4.730 (+0.018 [+0.012, +0.024]); prior-average baseline MAE 4.806. Test R² 0.4491 → 0.4532 (OLS), 0.4547 → 0.4590 (MixedLM). That is about 0.3% of MAE.
- Across the non-thin cells, the opponent features' MAE gain has a 95% CI above 0 in **8 of 34** OLS/MixedLM cell-fits (2023_24×all, 2025_26×all, pooled_2023_26×all, pooled_2023_27×all); in the others the gain is within noise or negative.
- Opponent pace and opponent DRtg are the opponent variables associated with more points; home is small positive; rest and back-to-back flags are within noise; points allowed to the player's position adds nothing beyond opponent DRtg (details in section 4).
- Per-player strong-vs-weak-defense splits: the league-average effect is about +0.6 PTS against weak vs strong defenses, individual deviations are small and mostly noise (section 7).

## 2. Definitions (all pregame, strictly prior games, season-bound)

**Opponent for every player-game** comes from `game_meta` (home / away team ids) joined to the box `team_id`; every one of the 3,844 regular-season games has exactly two team rows.

**Opponent features** are computed from the opposing team's **team totals** in its prior games (sum over its box rows with minutes), never from an average of player ratings:

| feature | definition | notes |
|---|---|---|
| opp_drtg | 100 × Σ points allowed / Σ possessions | possessions per game = ½ (own + opp estimate), estimate = FGA + 0.44 FTA − OREB + TOV (team totals) |
| opp_pace | 48 × Σ possessions / Σ game minutes | game minutes = team minutes / 5 (overtime counted); vs the minute-weighted player pace in the advanced table: corr 0.950, mean diff -0.15 |
| opp_pts_allowed | mean points allowed per game | overall (all positions) |
| opp_pts_pos | 36 × Σ points scored against the opponent by the player's position group / Σ that group's minutes | per-36 normalises for the minutes a position group happened to play; position = G / F / C, see below |
| is_home | 1 if the player's team is home | neutral-site games keep the box `home_away` label (12 games in 4 seasons) |
| team_rest, opp_rest | days since the team's previous game − 1, capped at 5 | from `game_meta` incl. the Cup final; first game of a season is null |
| team_b2b, opp_b2b | 1 if rest = 0 |  |

Windows: **l10** = last up to 10 prior games, **std** = all prior games this season, both within the season. Primary spec = player box inputs at l10 plus the opponent features at l10 (`@l10+opp`); sensitivity = opponent features at std (`@l10+opp_std`); reference = box-only on the same rows (`@l10`). Checked on 300 random team-games against a hand computation from the raw box: 0 mismatches; the game itself is excluded from every window.

**Position definition.** Primary position from the warehouse roster data used in the home/away analysis (`CommonTeamRoster` for that season, else `PlayerIndex`), first-listed letter of e.g. `G-F` → **G / F / C** (2,185 player-seasons, 0 missing). Points allowed to a position group counts every played minute of the attacking team's players of that group.

**Cold start.** A team's features need ≥ 5 prior games that season (no carry-over from the previous season, so nothing is imputed). Of 68,059 pregame-eligible player rows, **1,467 were dropped** because the opponent had fewer than 5 prior games (by season: 2023-24 86, 2024-25 466, 2025-26 457, 2026-27 458); **66,592 rows are modelled** (2023-24 21,268, 2024-25 21,729, 2025-26 22,185, 2026-27 1,410). Opponent-feature columns are null (never zero) for those team-games in `matchup_opponent_features` (`usable_for_models` = false for 600 team-games). The box-only reference is re-fitted on the same reduced rows, so its numbers differ slightly from `points_drivers` (which keeps the early-season rows).

**Splits and cells.** Identical to `POINTS_DRIVERS.md`: per timespan the last ~20% of game dates is the test set (cut-offs: pooled_2023_27 2026-01-15, pooled_2023_26 2026-01-03, 2023_24 2024-03-14, 2024_25 2025-03-13, 2025_26 2026-03-11, 2026_27 2026-11-07), pregame segment membership ranked on the train rows only, nested segments all/top100/top50/top25/top10 × 6 timespans, thin = fewer than 30 players or 300 player-games (counted after the cold-start drop), VIF threshold 10 with the same priority rule (opponent and context features sit below minutes/FGA/FTA/3PA/TS%/USG%/pace/AST%/REB%/TOV% and above eFG%, def/off rating, PIE), models OLS (player-cluster robust CI), elastic net (time-ordered CV), MixedLM (player intercept), LightGBM + SHAP (kept only if it clearly beats the best linear model).

**Table.** `matchups.parquet` has the `points_drivers` schema (`lens` is always `pregame`). `model` = `<screen_pearson|screen_spearman|ols_cluster|enet|mixedlm|gbm_shap>@<spec>`; spec `l10` = box-only reference, `l10+opp`, `l10+opp_std` = box + opponent. The `notes` of every `+opp` model row carry the lift versus the box-only model on the same rows (MAE gain, player-cluster bootstrap 95% CI, R² and RMSE before → after).

## 3. Matchup-source decision (nba_api `BoxScoreMatchupsV3`, `LeagueSeasonMatchups`)

**Available:** both endpoints answer for 2022-23 through 2026-27 (checked live: `BoxScoreMatchupsV3` for a 2022-23, a 2023-24 and a 2026-27 game; `LeagueSeasonMatchups` for 2023-24 and 2026-27). `BoxScoreMatchupsV3` is one call per game (≈ 3,844 calls for full coverage); `LeagueSeasonMatchups` is per season but only offers season totals, which would mix in the games being predicted.

**Coverage probe** (`scripts/matchup_source_probe.py`, stratified sample of 160 regular-season games, 40 per season): 159 of 160 games returned rows (1 failed); 3,488 of the 3,504 played player rows in the sampled games matched an offensive player in the matchup data; a player's matchup points equal his box points exactly for 80.2% of players and the matchup data attributes 99.1% of all box points (free throws and some possessions are unassigned); `positionOff` is blank for 51.4% of rows (bench players).

**Decision: not used in any model.** (1) For a pregame model the useful quantity is who will guard the player tonight, which is unknown before tip-off; prior-game defender assignments would have to be aggregated per opponent, which reproduces what the position-level points-allowed feature already measures. (2) `positionOff` is blank for about half of the rows, so a defence-by-position feature from it would need the same roster-based position as I already use. (3) Points reconcile exactly for only 80% of players (99.1% of points), so it is not a drop-in verified source. (4) It would need ≈ 3,844 additional calls for a feature the data cannot be shown to improve on. The box-score-derived opponent features are fully reproducible from the warehouse. The endpoints remain available if Cavin wants a player-vs-defender study later.

## 4. Opponent effects, default cell (pooled_2023_26 × all)

Standardised effects: PTS per +1 SD, 95% CI (OLS player-cluster robust; MixedLM model-based). Associations, not causes.

| OLS rank | driver | OLS | MixedLM rank | MixedLM | elastic net | SHAP |
|---|---|---|---|---|---|---|
| 1 | FGA | +4.79 [+4.60, +4.97] | 1 | +3.84 [+3.58, +4.09] | 4.75 | 3.614 |
| 2 | FTA | +1.34 [+1.18, +1.50] | 2 | +1.06 [+0.93, +1.19] | 1.33 | 0.583 |
| 3 | TS% | +0.26 [+0.16, +0.37] | 12 | +0.07 [-0.04, +0.18] | 0.21 | 0.161 |
| 4 | DREB% | +0.25 [+0.10, +0.39] | 6 | +0.25 [+0.13, +0.37] | 0.14 | 0.032 |
| 5 | OREB% | -0.22 [-0.30, -0.13] | 5 | -0.25 [-0.36, -0.15] | -0.13 | 0.088 |
| 6 | opponent pace  **(opponent/context)** | +0.21 [+0.15, +0.27] | 7 | +0.20 [+0.15, +0.26] | 0.18 | 0.146 |
| 7 | opponent DRtg  **(opponent/context)** | +0.18 [+0.12, +0.25] | 8 | +0.18 [+0.12, +0.25] | 0.16 | 0.124 |
| 8 | off rating (player) | +0.17 [+0.10, +0.24] | 10 | +0.11 [+0.04, +0.18] | 0.15 | 0.099 |
| 9 | minutes | +0.11 [-0.03, +0.24] | 3 | +0.39 [+0.24, +0.55] | 0.13 | 0.532 |
| 10 | TOV% | +0.09 [+0.02, +0.15] | 9 | +0.12 [+0.05, +0.19] | 0.05 | 0.068 |
| 11 | home  **(opponent/context)** | +0.08 [+0.02, +0.14] | 11 | +0.08 [+0.03, +0.14] | 0.05 | 0.027 |
| 12 | own rest days  **(opponent/context)** | -0.07 [-0.15, +0.01] | 13 | -0.07 [-0.15, +0.01] | -0.05 | 0.016 |
| 13 | AST% | +0.06 [-0.08, +0.20] | 4 | +0.26 [+0.14, +0.39] | 0.03 | 0.046 |
| 14 | PIE | +0.06 [-0.14, +0.26] | 20 | -0.00 [-0.19, +0.18] | 0.12 | 0.197 |
| 15 | opp pts allowed to position /36  **(opponent/context)** | +0.04 [-0.02, +0.10] | 14 | +0.05 [-0.01, +0.12] | 0.03 | 0.050 |
| 16 | pace (player on floor) | -0.04 [-0.10, +0.03] | 15 | -0.05 [-0.11, +0.02] | -0.00 | 0.018 |
| 17 | opp B2B  **(opponent/context)** | +0.03 [-0.05, +0.10] | 18 | +0.02 [-0.05, +0.10] | 0.00 | 0.001 |
| 18 | own B2B  **(opponent/context)** | +0.02 [-0.06, +0.10] | 17 | +0.03 [-0.05, +0.10] | 0.00 | 0.002 |
| 19 | opp rest days  **(opponent/context)** | -0.01 [-0.10, +0.07] | 19 | -0.02 [-0.10, +0.07] | -0.00 | 0.003 |
| 20 | def rating (player) | -0.01 [-0.07, +0.05] | 16 | +0.03 [-0.04, +0.09] | 0.00 | 0.020 |

VIF / definition drops (default cell, `@l10+opp`): **net rating** (definition drop: = off_rating - def_rating exactly (perfect collinearity); keep the two components); **USG%** (VIF drop: fga had VIF 37.8 > 10; usg_pct (VIF 15.2) is the lowest-priority of its correlated set (fga, min, fta, fg3a) so it was dropped); **opponent pts allowed** (VIF drop: opp_pts_allowed had VIF 36.8 > 10; opp_pts_allowed (VIF 36.8) is the lowest-priority of its correlated set (opp_drtg) so it was dropped); **eFG%** (VIF drop: ts_pct had VIF 28.9 > 10; efg_pct (VIF 24.8) is the lowest-priority of its correlated set (ts_pct) so it was dropped); **3PA** (VIF drop: fga had VIF 12.0 > 10; fg3a (VIF 3.7) is the lowest-priority of its correlated set (fga, min, fta) so it was dropped). Max VIF after drops 9.1; max |r| among kept 0.85. Elastic net survivors 17/20; MixedLM player variance 1.64 vs residual 37.9.

**Read.** Holding the player's own last-10 box profile fixed, a game against an opponent with a higher pregame DRtg (a worse defence) or a faster pace is associated with more points: roughly +0.2 PTS per SD for each (CIs above 0). Home is associated with about +0.08. Own and opponent rest days and back-to-back flags have CIs that include 0. Points allowed to the player's position (per 36) has a CI that includes 0 once opponent DRtg is in the model. Opponent points allowed per game was dropped by VIF (it is a near-duplicate of DRtg and pace). These effects are small next to the player's own volume (FGA +4.8 per SD).

### Test fit in the default cell (last 20% of dates)

Baseline (prior season-to-date average): R² 0.4312, MAE 4.806, RMSE 6.2484.

| model | inputs | test R² | test MAE | test RMSE | MAE vs baseline |
|---|---|---|---|---|---|
| ols_cluster | box only (reference) | 0.449 | 4.761 | 6.149 | +0.9% |
| ols_cluster | box + opponent (l10) | 0.453 | 4.746 | 6.127 | +1.3% |
| ols_cluster | box + opponent (std) | 0.453 | 4.750 | 6.129 | +1.2% |
| enet | box only (reference) | 0.449 | 4.761 | 6.148 | +0.9% |
| enet | box + opponent (l10) | 0.453 | 4.748 | 6.128 | +1.2% |
| enet | box + opponent (std) | 0.453 | 4.752 | 6.130 | +1.1% |
| mixedlm | box only (reference) | 0.455 | 4.748 | 6.118 | +1.2% |
| mixedlm | box + opponent (l10) | 0.459 | 4.730 | 6.094 | +1.6% |
| mixedlm | box + opponent (std) | 0.459 | 4.736 | 6.097 | +1.5% |
| gbm_shap | box only (reference) | 0.448 | 4.775 | 6.154 | +0.7% |
| gbm_shap | box + opponent (l10) | 0.451 | 4.761 | 6.138 | +0.9% |
| gbm_shap | box + opponent (std) | 0.451 | 4.765 | 6.139 | +0.9% |

Boosting verdict, default cell: `gbm_shap@l10` not kept (linear is enough); `gbm_shap@l10+opp` not kept (linear is enough); `gbm_shap@l10+opp_std` not kept (linear is enough).

## 5. Lift across segments and timespans

MAE in points on the same test rows. `gain` = box-only MAE − box+opponent MAE (positive = the opponent features help) with a player-cluster bootstrap 95% CI; `*` = thin cell (do not read). Primary spec `@l10+opp`, OLS and MixedLM.

**ols_cluster**

| timespan | segment | players / games | baseline MAE | box-only MAE | box+opp MAE | gain [95% CI] | R² box → box+opp |
|---|---|---|---|---|---|---|---|
| pooled_2023_26 | all | 668 / 65,085 | 4.806 | 4.761 | 4.746 | +0.015 [+0.009, +0.021] **gain** | 0.449 → 0.453 |
| pooled_2023_26 | top100 | 100 / 16,240 | 5.907 | 5.889 | 5.876 | +0.012 [-0.012, +0.038] | 0.273 → 0.275 |
| pooled_2023_26 | top50 | 50 / 8,228 | 6.097 | 6.153 | 6.139 | +0.014 [-0.019, +0.049] | 0.195 → 0.194 |
| pooled_2023_26 | top25* | 25 / 4,142 | 6.040 | 6.296 | 6.305 | -0.009 [-0.052, +0.037] | 0.117 → 0.108 |
| pooled_2023_26 | top10* | 10 / 1,751 | 6.489 | 6.391 | 6.437 | -0.045 [-0.141, +0.061] | 0.024 → 0.021 |
| pooled_2023_27 | all | 669 / 66,399 | 4.854 | 4.801 | 4.783 | +0.019 [+0.013, +0.025] **gain** | 0.442 → 0.446 |
| pooled_2023_27 | top100 | 100 / 16,743 | 6.001 | 5.987 | 5.971 | +0.015 [-0.009, +0.039] | 0.272 → 0.274 |
| pooled_2023_27 | top50 | 50 / 8,431 | 6.175 | 6.268 | 6.248 | +0.019 [-0.021, +0.054] | 0.201 → 0.201 |
| pooled_2023_27 | top25* | 25 / 4,254 | 6.121 | 6.458 | 6.458 | +0.000 [-0.046, +0.047] | 0.116 → 0.111 |
| pooled_2023_27 | top10* | 10 / 1,797 | 6.547 | 6.692 | 6.734 | -0.042 [-0.147, +0.061] | 0.038 → 0.032 |
| 2023_24 | all | 479 / 21,258 | 4.929 | 4.826 | 4.812 | +0.015 [+0.001, +0.028] **gain** | 0.474 → 0.473 |
| 2023_24 | top100 | 100 / 6,051 | 6.257 | 6.187 | 6.172 | +0.015 [-0.051, +0.084] | 0.195 → 0.191 |
| 2023_24 | top50 | 50 / 3,018 | 6.496 | 6.499 | 6.451 | +0.048 [-0.061, +0.165] | 0.102 → 0.102 |
| 2023_24 | top25* | 25 / 1,492 | 6.760 | 6.555 | 6.531 | +0.023 [-0.214, +0.240] | 0.024 → 0.014 |
| 2023_24 | top10* | 10 / 626 | 6.675 | 6.939 | 6.626 | +0.313 [+0.145, +0.489] | -0.192 → -0.152 |
| 2024_25 | all | 497 / 21,702 | 5.044 | 4.954 | 4.949 | +0.004 [-0.007, +0.016] | 0.423 → 0.425 |
| 2024_25 | top100 | 100 / 5,598 | 6.104 | 6.113 | 6.130 | -0.017 [-0.055, +0.020] | 0.212 → 0.211 |
| 2024_25 | top50 | 50 / 2,831 | 6.556 | 6.705 | 6.700 | +0.005 [-0.044, +0.048] | 0.113 → 0.113 |
| 2024_25 | top25* | 25 / 1,392 | 6.478 | 6.589 | 6.601 | -0.011 [-0.094, +0.060] | 0.033 → 0.041 |
| 2024_25 | top10* | 10 / 621 | 6.972 | 7.038 | 7.062 | -0.023 [-0.207, +0.119] | -0.021 → -0.021 |
| 2025_26 | all | 507 / 22,104 | 5.044 | 4.941 | 4.915 | +0.026 [+0.013, +0.040] **gain** | 0.403 → 0.409 |
| 2025_26 | top100 | 100 / 5,614 | 6.025 | 6.036 | 6.030 | +0.006 [-0.032, +0.047] | 0.191 → 0.193 |
| 2025_26 | top50 | 50 / 2,779 | 6.348 | 6.464 | 6.464 | +0.000 [-0.088, +0.092] | 0.118 → 0.111 |
| 2025_26 | top25* | 25 / 1,418 | 6.776 | 6.897 | 6.936 | -0.039 [-0.162, +0.081] | 0.065 → 0.054 |
| 2025_26 | top10* | 10 / 564 | 7.173 | 7.564 | 7.875 | -0.311 [-0.736, +0.110] | -0.046 → -0.132 |
| 2026_27 | all | 327 / 1,410 | 4.658 | 4.583 | 4.658 | -0.075 [-0.164, +0.011] | 0.508 → 0.489 |
| 2026_27 | top100 | 95 / 465 | 6.128 | 6.226 | 6.238 | -0.012 [-0.225, +0.201] | 0.262 → 0.251 |
| 2026_27 | top50* | 48 / 237 | 6.356 | 6.707 | 6.435 | +0.272 [-0.143, +0.699] | 0.155 → 0.206 |
| 2026_27 | top25 | not fitted |  |  |  |  |  |
| 2026_27 | top10 | not fitted |  |  |  |  |  |

**mixedlm**

| timespan | segment | players / games | baseline MAE | box-only MAE | box+opp MAE | gain [95% CI] | R² box → box+opp |
|---|---|---|---|---|---|---|---|
| pooled_2023_26 | all | 668 / 65,085 | 4.806 | 4.748 | 4.730 | +0.018 [+0.012, +0.024] **gain** | 0.455 → 0.459 |
| pooled_2023_26 | top100 | 100 / 16,240 | 5.907 | 5.827 | 5.814 | +0.013 [-0.011, +0.040] | 0.285 → 0.289 |
| pooled_2023_26 | top50 | 50 / 8,228 | 6.097 | 6.093 | 6.076 | +0.017 [-0.016, +0.053] | 0.202 → 0.202 |
| pooled_2023_26 | top25* | 25 / 4,142 | 6.040 | 6.157 | 6.163 | -0.006 [-0.051, +0.041] | 0.145 → 0.136 |
| pooled_2023_26 | top10* | 10 / 1,751 | 6.489 | 6.385 | 6.426 | -0.040 [-0.136, +0.064] | 0.026 → 0.024 |
| pooled_2023_27 | all | 669 / 66,399 | 4.854 | 4.788 | 4.767 | +0.022 [+0.016, +0.028] **gain** | 0.447 → 0.451 |
| pooled_2023_27 | top100 | 100 / 16,743 | 6.001 | 5.947 | 5.931 | +0.016 [-0.008, +0.039] | 0.280 → 0.284 |
| pooled_2023_27 | top50 | 50 / 8,431 | 6.175 | 6.216 | 6.192 | +0.023 [-0.014, +0.055] | 0.205 → 0.206 |
| pooled_2023_27 | top25* | 25 / 4,254 | 6.121 | 6.327 | 6.319 | +0.008 [-0.035, +0.052] | 0.141 → 0.136 |
| pooled_2023_27 | top10* | 10 / 1,797 | 6.547 | 6.686 | 6.720 | -0.034 [-0.139, +0.065] | 0.040 → 0.035 |
| 2023_24 | all | 479 / 21,258 | 4.929 | 4.821 | 4.807 | +0.015 [+0.001, +0.029] **gain** | 0.476 → 0.475 |
| 2023_24 | top100 | 100 / 6,051 | 6.257 | 6.163 | 6.154 | +0.009 [-0.058, +0.075] | 0.196 → 0.192 |
| 2023_24 | top50 | 50 / 3,018 | 6.496 | 6.452 | 6.416 | +0.037 [-0.073, +0.160] | 0.105 → 0.106 |
| 2023_24 | top25* | 25 / 1,492 | 6.760 | 6.622 | 6.553 | +0.070 [-0.161, +0.295] | 0.016 → 0.017 |
| 2023_24 | top10* | 10 / 626 | 6.675 | 7.145 | 6.772 | +0.373 [+0.246, +0.527] | -0.251 → -0.180 |
| 2024_25 | all | 497 / 21,702 | 5.044 | 4.944 | 4.938 | +0.006 [-0.006, +0.017] | 0.425 → 0.427 |
| 2024_25 | top100 | 100 / 5,598 | 6.104 | 6.104 | 6.119 | -0.015 [-0.054, +0.021] | 0.216 → 0.215 |
| 2024_25 | top50 | 50 / 2,831 | 6.556 | 6.679 | 6.678 | +0.001 [-0.050, +0.047] | 0.122 → 0.122 |
| 2024_25 | top25* | 25 / 1,392 | 6.478 | 6.521 | 6.527 | -0.006 [-0.086, +0.062] | 0.053 → 0.065 |
| 2024_25 | top10* | 10 / 621 | 6.972 | 7.168 | 7.140 | +0.028 [-0.173, +0.182] | -0.009 → -0.009 |
| 2025_26 | all | 507 / 22,104 | 5.044 | 4.937 | 4.911 | +0.026 [+0.013, +0.040] **gain** | 0.404 → 0.410 |
| 2025_26 | top100 | 100 / 5,614 | 6.025 | 5.996 | 5.983 | +0.014 [-0.026, +0.058] | 0.205 → 0.207 |
| 2025_26 | top50 | 50 / 2,779 | 6.348 | 6.432 | 6.447 | -0.015 [-0.096, +0.072] | 0.119 → 0.109 |
| 2025_26 | top25* | 25 / 1,418 | 6.776 | 6.874 | 6.902 | -0.029 [-0.154, +0.095] | 0.059 → 0.050 |
| 2025_26 | top10* | 10 / 564 | 7.173 | 7.517 | 7.810 | -0.293 [-0.645, +0.071] | -0.037 → -0.125 |
| 2026_27 | all | 327 / 1,410 | 4.658 | 4.616 | 4.697 | -0.082 [-0.168, +0.005] | 0.505 → 0.487 |
| 2026_27 | top100 | 95 / 465 | 6.128 | 6.270 | 6.302 | -0.032 [-0.249, +0.186] | 0.266 → 0.254 |
| 2026_27 | top50* | 48 / 237 | 6.356 | 6.707 | 6.507 | +0.200 [-0.241, +0.665] | 0.155 → 0.200 |
| 2026_27 | top25 | not fitted |  |  |  |  |  |
| 2026_27 | top10 | not fitted |  |  |  |  |  |

**Who gains.** all: 10/12 cell-fits with a positive gain; top100: 8/12 cell-fits with a positive gain; top50: 9/10 cell-fits with a positive gain. The gain is concentrated in the all-player segment of the complete seasons (pooled windows, 2023-24 and 2025-26 with CIs above 0; 2024-25 is flat). In top100 / top50 the point gains are positive in the pools but the CIs include 0. In 2026-27 (3 test dates, ~1,400 modelled rows after the cold start) the box+opponent model is worse, with a CI that includes 0: provisional and too small to read.

Sensitivity: with the opponent features at season-to-date (`@l10+opp_std`) the default-cell OLS gain is +0.011 [+0.006, +0.017], smaller than at l10 (the last-10 window is the better pre-declared choice).

**Versus the prior-average baseline** (the thing a bettor already has): in the default cell the box+opponent MixedLM test MAE is 4.730 against 4.806 for the baseline (+1.6%). Gains over the baseline in the high-scorer segments remain small or negative; see the baseline column.

## 6. Opponent effects across cells (OLS @l10+opp, PTS per +1 SD, 95% cluster-robust CI)

**opponent DRtg** (`*` = thin cell, not ranked; read as unreliable)

| timespan | all | top100 | top50 | top25 | top10 |
|---|---|---|---|---|---|
| pooled_2023_26 | +0.18 [+0.12, +0.25] | +0.37 [+0.22, +0.52] | +0.41 [+0.18, +0.64] | +0.24 [-0.14, +0.63]* | -0.07 [-0.63, +0.49]* |
| pooled_2023_27 | +0.18 [+0.12, +0.24] | +0.36 [+0.22, +0.50] | +0.41 [+0.20, +0.63] | +0.24 [-0.12, +0.60]* | -0.05 [-0.56, +0.46]* |
| 2023_24 | +0.15 [+0.04, +0.26] | +0.31 [+0.07, +0.55] | +0.26 [-0.11, +0.63] | +0.11 [-0.50, +0.73]* | -0.13 [-0.87, +0.61]* |
| 2024_25 | +0.18 [+0.08, +0.29] | +0.47 [+0.22, +0.71] | +0.41 [+0.05, +0.78] | +0.29 [-0.08, +0.66]* | +0.32 [-0.36, +1.00]* |
| 2025_26 | +0.24 [+0.14, +0.34] | +0.41 [+0.20, +0.63] | +0.61 [+0.32, +0.91] | +0.55 [+0.15, +0.95]* | +0.99 [+0.24, +1.75]* |
| 2026_27 | +0.23 [-0.22, +0.68] | +0.35 [-0.58, +1.28] | +0.09 [-1.17, +1.34]* | not fitted | not fitted |

**opponent pace** (`*` = thin cell, not ranked; read as unreliable)

| timespan | all | top100 | top50 | top25 | top10 |
|---|---|---|---|---|---|
| pooled_2023_26 | +0.21 [+0.15, +0.27] | +0.48 [+0.34, +0.63] | +0.64 [+0.43, +0.85] | +0.69 [+0.39, +0.99]* | +0.74 [+0.34, +1.15]* |
| pooled_2023_27 | +0.20 [+0.14, +0.26] | +0.44 [+0.30, +0.58] | +0.61 [+0.41, +0.82] | +0.63 [+0.32, +0.94]* | +0.72 [+0.34, +1.11]* |
| 2023_24 | +0.25 [+0.15, +0.36] | +0.68 [+0.44, +0.92] | +0.82 [+0.46, +1.19] | +1.15 [+0.60, +1.70]* | +0.74 [-0.50, +1.98]* |
| 2024_25 | +0.26 [+0.16, +0.35] | +0.32 [+0.08, +0.55] | +0.36 [+0.00, +0.72] | +0.25 [-0.30, +0.81]* | +0.06 [-0.61, +0.72]* |
| 2025_26 | +0.25 [+0.15, +0.34] | +0.34 [+0.12, +0.56] | +0.41 [+0.10, +0.71] | +0.67 [+0.28, +1.07]* | +0.70 [-0.18, +1.58]* |
| 2026_27 | +0.32 [-0.11, +0.74] | +0.52 [-0.30, +1.33] | +1.16 [-0.14, +2.45]* | not fitted | not fitted |

**home** (`*` = thin cell, not ranked; read as unreliable)

| timespan | all | top100 | top50 | top25 | top10 |
|---|---|---|---|---|---|
| pooled_2023_26 | +0.08 [+0.02, +0.14] | +0.03 [-0.12, +0.18] | -0.06 [-0.30, +0.19] | -0.10 [-0.44, +0.24]* | -0.15 [-0.66, +0.36]* |
| pooled_2023_27 | +0.08 [+0.02, +0.14] | +0.04 [-0.10, +0.18] | -0.06 [-0.30, +0.17] | -0.12 [-0.45, +0.21]* | -0.21 [-0.72, +0.30]* |
| 2023_24 | +0.07 [-0.03, +0.17] | +0.18 [-0.06, +0.43] | +0.07 [-0.31, +0.44] | -0.13 [-0.71, +0.45]* | -0.05 [-1.12, +1.03]* |
| 2024_25 | +0.13 [+0.03, +0.22] | +0.01 [-0.23, +0.24] | -0.06 [-0.43, +0.30] | -0.21 [-0.62, +0.20]* | -0.31 [-1.01, +0.39]* |
| 2025_26 | +0.05 [-0.05, +0.14] | -0.04 [-0.27, +0.19] | -0.02 [-0.40, +0.36] | -0.21 [-0.76, +0.34]* | -0.21 [-1.01, +0.58]* |
| 2026_27 | -0.13 [-0.49, +0.23] | -0.03 [-0.72, +0.65] | +0.03 [-0.88, +0.93]* | not fitted | not fitted |

**opp pts allowed to position /36** (`*` = thin cell, not ranked; read as unreliable)

| timespan | all | top100 | top50 | top25 | top10 |
|---|---|---|---|---|---|
| pooled_2023_26 | +0.04 [-0.02, +0.10] | -0.03 [-0.18, +0.11] | -0.15 [-0.37, +0.08] | -0.28 [-0.65, +0.09]* | -0.16 [-0.69, +0.37]* |
| pooled_2023_27 | +0.04 [-0.02, +0.10] | -0.03 [-0.17, +0.11] | -0.14 [-0.36, +0.08] | -0.26 [-0.62, +0.09]* | -0.13 [-0.59, +0.34]* |
| 2023_24 | +0.01 [-0.10, +0.11] | -0.06 [-0.27, +0.14] | -0.06 [-0.39, +0.26] | -0.44 [-1.01, +0.13]* | -0.13 [-1.04, +0.77]* |
| 2024_25 | +0.08 [-0.03, +0.19] | -0.07 [-0.32, +0.19] | -0.09 [-0.50, +0.33] | -0.13 [-0.68, +0.42]* | +0.24 [-0.59, +1.07]* |
| 2025_26 | +0.01 [-0.09, +0.12] | -0.01 [-0.24, +0.23] | -0.06 [-0.42, +0.30] | -0.37 [-0.79, +0.05]* | +0.02 [-0.59, +0.63]* |
| 2026_27 | -0.05 [-0.48, +0.37] | -0.43 [-1.37, +0.51] | -1.48 [-3.18, +0.22]* | not fitted | not fitted |

## 6b. Thin cells (< 30 players or < 300 player-games after the cold-start drop): no ranking

| timespan | segment | players | player-games | status |
|---|---|---|---|---|
| 2023_24 | top10 | 10 | 626 | fitted, unranked |
| 2023_24 | top25 | 25 | 1,492 | fitted, unranked |
| 2024_25 | top10 | 10 | 621 | fitted, unranked |
| 2024_25 | top25 | 25 | 1,392 | fitted, unranked |
| 2025_26 | top10 | 10 | 564 | fitted, unranked |
| 2025_26 | top25 | 25 | 1,418 | fitted, unranked |
| 2026_27 | top10 | 9 | 45 | NOT fitted (too few rows) |
| 2026_27 | top25 | 24 | 119 | NOT fitted (too few rows) |
| 2026_27 | top50 | 48 | 237 | fitted, unranked |
| pooled_2023_26 | top10 | 10 | 1,751 | fitted, unranked |
| pooled_2023_26 | top25 | 25 | 4,142 | fitted, unranked |
| pooled_2023_27 | top10 | 10 | 1,797 | fitted, unranked |
| pooled_2023_27 | top25 | 25 | 4,254 | fitted, unranked |

All top25 and top10 cells are thin (25 and 10 players). 2026-27 top50 is thin too after the cold start (fewer than 300 player-games), and 2026-27 top25 / top10 are not fitted.

## 7. Per-player points vs strong / mid / weak defenses (`matchup_player_splits`)

**Definition.** Each opponent is ranked by its pregame season-to-date DRtg among the teams with ≥ 5 games *strictly before that date* (as-of league table, no look-ahead); lowest third = **strong** defense, middle = mid, highest third = **weak**. Per player and timespan (all his minutes > 0 regular-season games with a ranked opponent): mean PTS vs strong, mid, weak; **raw diff = PPG vs weak − PPG vs strong** (positive = scores more against weak defenses). SE = the player's game-to-game SD over all his games in the timespan × √(1/n_weak + 1/n_strong), 95% CI with t(gp − 1), as in the home/away splits. **Shrinkage:** DerSimonian–Laird between-player variance τ² over qualifying players of the timespan, shrunk = league mean + w·(raw − league mean), w = τ²/(τ² + se²); the shrunk interval is the normal-normal posterior (shrunk ± 1.96·√w·se; ignores uncertainty in τ and the mean, so is slightly optimistic). z, p and Benjamini–Hochberg q (strong flag q < 0.10) as before; 'watch' = |z| ≥ 2.5 (nominal). Floors: games floor per timespan (50 / 40 / 20 / 20 / 20 / 3) and ≥ 5 games vs strong and ≥ 5 vs weak (≥ 3 each in 2026-27). `n_strong`, `n_mid`, `n_weak` are in the table; membership flags `in_all … in_top10` use the app's full-window segments. Caveats: strong/weak opponents differ in venue, pace and minutes; the contrast is descriptive, not a defender effect.

| timespan | players ≥ games floor | qualify (≥ 5/side) | league mean diff (pts) | τ between players (pts) | strong flags (FDR) | watch flags | games with a ranked opponent |
|---|---|---|---|---|---|---|---|
| pooled_2023_26 | 562 | 562 | 0.59 | 0.46 | 0 | 14 (≈ 7.0 by chance) | 93.7% |
| pooled_2023_27 | 527 | 527 | 0.64 | 0.43 | 0 | 11 (≈ 6.5 by chance) | 91.9% |
| 2023_24 | 445 | 435 | 0.59 | 0.67 | 0 | 9 (≈ 5.4 by chance) | 93.8% |
| 2024_25 | 456 | 448 | 0.61 | 0.69 | 0 | 6 (≈ 5.6 by chance) | 93.6% |
| 2025_26 | 452 | 441 | 0.78 | 0.47 | 0 | 8 (≈ 5.5 by chance) | 93.7% |
| 2026_27 | 418 | 5 | -1.20 | 2.37 | 0 | 0 (≈ 0.1 by chance) | 51.5% |

**Reading.** The league-average player scores about +0.6 more PTS against weak than strong defenses (pooled_2023_26 0.59, pooled_2023_27 0.64); between-player variation of the true effect is small (τ ≈ 0.46 pts), so shrinkage pulls individual estimates to within about ±1 point of the league mean; **no player is flagged strong after FDR in any timespan**; the watch flags are 1.1 to 2.0 times the number expected by chance (nominal, not multiplicity-adjusted). 2026-27 is effectively unavailable: only about half the games have an opponent with 5 prior games and only 5 players have ≥ 3 games on each side, so it is shown but should not be used.

**Largest shrunk effects, pooled_2023_26** (raw diff with 95% CI, shrunk with interval, shrink weight w, n games vs strong / weak):

*Scores more vs weak defenses*

| player | pos | gp | n strong / weak | PPG strong / weak | raw diff [95% CI] | shrunk [interval] | w | q | flag |
|---|---|---|---|---|---|---|---|---|---|
| Mark Williams | C | 123 | 40 / 38 | 10.9 / 16.7 | +5.81 [+2.81, +8.81] | +1.03 [+0.17, +1.89] | 0.08 | 0.12 | weak_better_watch |
| Zach Edey | C | 77 | 24 / 23 | 6.5 / 12.7 | +6.15 [+2.91, +9.40] | +1.00 [+0.13, +1.86] | 0.07 | 0.12 | weak_better_watch |
| Zeke Nnaji | F | 167 | 57 / 53 | 2.0 / 4.0 | +2.02 [+0.58, +3.46] | +1.00 [+0.24, +1.76] | 0.28 | 0.77 | nan |
| Isaiah Joe | G | 223 | 83 / 66 | 8.3 / 11.2 | +2.92 [+0.90, +4.93] | +0.98 [+0.16, +1.80] | 0.17 | 0.68 | nan |
| Karl-Anthony Towns | C | 209 | 68 / 67 | 20.0 / 24.8 | +4.75 [+1.90, +7.59] | +0.97 [+0.11, +1.83] | 0.09 | 0.34 | weak_better_watch |
| Khris Middleton | F | 155 | 47 / 59 | 10.6 / 14.4 | +3.82 [+1.31, +6.34] | +0.96 [+0.11, +1.81] | 0.11 | 0.44 | weak_better_watch |
| Julian Champagnie | F | 238 | 76 / 67 | 7.9 / 10.6 | +2.70 [+0.64, +4.76] | +0.93 [+0.11, +1.75] | 0.16 | 0.77 | nan |
| Rudy Gobert | C | 224 | 70 / 71 | 11.3 / 13.6 | +2.32 [+0.49, +4.15] | +0.93 [+0.12, +1.73] | 0.20 | 0.77 | nan |

*Scores less vs weak defenses (relatively better vs strong)*

| player | pos | gp | n strong / weak | PPG strong / weak | raw diff [95% CI] | shrunk [interval] | w | q | flag |
|---|---|---|---|---|---|---|---|---|---|
| Taj Gibson | F | 67 | 25 / 26 | 3.0 / 1.8 | -1.19 [-2.56, +0.18] | +0.04 [-0.71, +0.78] | 0.31 | 0.44 | weak_worse_watch |
| Kevon Looney | F | 171 | 59 / 45 | 4.9 / 4.1 | -0.81 [-2.03, +0.40] | +0.09 [-0.63, +0.81] | 0.36 | 0.68 | nan |
| Paul Reed | F | 192 | 54 / 67 | 8.4 / 6.2 | -2.13 [-4.05, -0.20] | +0.10 [-0.72, +0.91] | 0.18 | 0.34 | weak_worse_watch |
| Justin Minaya | F | 53 | 21 / 17 | 2.0 / 0.9 | -1.07 [-2.53, +0.39] | +0.12 [-0.64, +0.88] | 0.29 | 0.68 | nan |
| Ish Smith | G | 43 | 14 / 13 | 4.2 / 1.8 | -2.45 [-4.63, -0.26] | +0.13 [-0.70, +0.95] | 0.15 | 0.34 | weak_worse_watch |
| Kris Dunn | G | 222 | 76 / 60 | 7.0 / 6.1 | -0.88 [-2.26, +0.50] | +0.15 [-0.60, +0.90] | 0.30 | 0.77 | nan |
| Jordan McLaughlin | G | 146 | 46 / 46 | 2.9 / 2.3 | -0.65 [-1.89, +0.58] | +0.16 [-0.57, +0.88] | 0.35 | 0.77 | nan |
| Jarace Walker | F | 184 | 50 / 61 | 9.6 / 7.2 | -2.42 [-4.67, -0.16] | +0.17 [-0.66, +1.01] | 0.14 | 0.44 | weak_worse_watch |

## 8. Data gaps and limitations

- Cold start: 1,467 pregame-eligible rows (opponent with < 5 prior games) are excluded from the opponent models; no previous-season carry-over was used, so early-season games are absent from the matchup cells. 2026-27 loses 458 of 1,868 eligible rows.
- 2026-27 is provisional: 15 game dates, 3 test dates, ~1,400 modelled rows, and half of the games have a ranked opponent for the strong/weak splits (5 players qualify).
- Opponent features are team-level and not adjusted for schedule strength; league scoring level differs between seasons (pooled cells share one coefficient). Opponent features are the opponent's *prior* performance, not tonight's lineup, injuries or defender assignments (unavailable pregame).
- Possessions are estimated from team totals (FGA + 0.44 FTA − OREB + TOV, averaged over both teams); they track the minute-weighted player pace from the advanced table at corr 0.950.
- Position is the primary roster position (G / F / C) of the player-season; hybrid players are assigned their first-listed position. Points allowed per 36 to a position group depend on who played that position for the attacking teams.
- Test lifts are one date-split per cell; the paired player-cluster bootstrap measures sampling noise over players, not over different test periods.
- The matchup endpoints were checked on a sample only (section 3); no matchup-endpoint data enters any table.


## Update 2026-11-10: stars vs weak defences, tails and tiers (see DEEP_ANALYSES.md)

Section 1's "league-average about +0.6 PTS against weak vs strong defences; individual deviations are mostly noise" is refined, not reversed: against the 5 worst defences the excess over the prior average is +0.63 PTS [+0.49, +0.78] for all players and +1.21 [+0.74, +1.68] for the top 50 scorers (vs the other 25 defences); against the best 10 defences -0.57 [-0.67, -0.46] (all) and -0.90 [-1.26, -0.54] (top 50). Relative big-night rates are about 1.2x for both groups, and the adjusted top-50 big-night odds ratio for bottom-10 defences is 1.01 [0.89, 1.16] (the shared effect, not a star-specific one). The star effect is **not stable across seasons** (top-50 vs bottom-5, PTS: 2023-24 +2.10, 2024-25 +1.13, 2025-26 +0.52 [-0.37, +1.42]). Per-player big-night effects have estimated between-player SD 0, so no individual star differs credibly from the pooled effect. Opponent pace is as strong as opponent defence.
