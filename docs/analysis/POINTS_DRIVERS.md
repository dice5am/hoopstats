# POINTS_DRIVERS: which variables are associated with player points (hoopstats)

Data through **2026-11-09** (2023-24 to 2026-27 to date). Built by `scripts/points_drivers.py` (report by `scripts/points_drivers_report.py`); seed 20261110; table `data/marts/points_drivers.parquet` (also the DuckDB view `points_drivers` in `data/marts/nba_phase1.duckdb`; 16,041 rows; sha256 `30bd65c869fd…`). Data deliverable only: not used by the app; no app changes.

**Language.** Everything below is *association / prediction*, never cause. "fga is associated with +6.5 PTS per SD" means players-games with more FGA have more PTS on average, holding the other kept variables fixed. It does not say that taking more shots would cause more points.

## 1. Table contract

One tidy row per lens × segment × timespan × model × driver. Columns, in order: `lens` (extra leading column: `explanatory` | `pregame`), `segment, timespan, model, driver, coef_std, ci_low, ci_high, rank_in_cell, kept_after_vif, shap_mean_abs, test_r2, test_mae, test_rmse, baseline_mae, n_games, n_players, thin_flag, notes`. Nulls, never NaN.

- `model`: `screen_pearson`, `screen_spearman` (step 2, screening only: `coef_std` = correlation with PTS, naive Fisher CI that ignores player clustering, one row per candidate incl. dropped ones, `kept_after_vif` says whether it survived steps 3), `ols_cluster`, `enet`, `mixedlm`, `gbm_shap`. A fit that was skipped for too few rows is `none`.
- Pregame models carry the input window in the name: `@l5` / `@l10` (mean of the last 5 / up to 10 prior games) and `@std` (this season's prior games), each also as `…+ppg` (the same inputs plus the player's prior average PTS for that window). **`@l10` (inputs only) is the pre-declared primary pregame spec**; the others are sensitivity runs.
- `coef_std`: change in PTS per +1 SD of the predictor (train-set mean/SD, after clipping at the train 0.5/99.5 percentiles); the target is raw points. `ci_low/ci_high`: 95% CI (OLS: player-cluster robust; MixedLM: model-based fixed-effect CI; elastic net has no CI, only survival = non-zero; boosting has none, only `shap_mean_abs` in PTS).
- `rank_in_cell`: rank by |`coef_std`| (|SHAP| for boosting) among the kept drivers; **null in thin cells**, for zeroed elastic-net drivers, and for boosting when it was not kept.
- `test_*`: score of the whole model on the held-out last-20%-of-dates rows (same value on each driver row of that model). `baseline_mae` = MAE of the naive baseline on the same test rows: the player's **prior season-to-date average PTS** (the game itself excluded). The baseline's R² / RMSE and its last-10 variant's MAE are in `notes` (`baseline_r2`, `baseline_rmse`, `baseline_l10_mae`).
- `n_games`, `n_players`: player-games and players in the cell (train + test) for that lens. `thin_flag` = fewer than 30 players or fewer than 300 player-games.

## 2. Data, coverage and gaps

Source: `player_game_box` (traditional) joined to `player_game_box_advanced` on (`game_id`, `player_id`). Regular season games only (game_id `002…`, includes NBA Cup group/knockout; the Cup final, play-in and playoffs are excluded, as in the app).

| season | games | played player-games | with advanced row | missing advanced | with ≥ 5 min |
|---|---|---|---|---|---|
| 2023-24 | 1,230 | 26,393 | 26,393 | 0 | 23,985 |
| 2024-25 | 1,230 | 26,302 | 26,302 | 0 | 23,996 |
| 2025-26 | 1,230 | 26,648 | 26,648 | 0 | 24,492 |
| 2026-27 | 154 | 3,479 | 3,479 | 0 | 3,134 |

**Advanced coverage is complete for 2023-24 and 2024-25 (and 2025-26, 2026-27): 0 played player-games lack an advanced row, and every advanced field is 100% non-null.** No gaps found. Known quirks (kept as returned, see `docs/warehouse-box-scores.md`): `ast_to` is 0 when a player had 0 turnovers (so it is not used); ratings and pace are extreme below ~5 minutes.

Modelling rows: player-games with ≥ 5 minutes (75,607); advanced rates below 5 min are unreliable. The player's prior games for the rolling inputs are also ≥ 5-minute games. A row is **eligible** (same rows for both lenses so baselines are comparable) when the player has ≥ 5 prior games overall and ≥ 3 prior games this season: **68,059 rows**. Segment ranks (PPG) still use all minutes > 0 games exactly as in the home/away rerun.

**Candidate drivers and what happened to each**

Used as candidates (screened for every cell): minutes, FGA, FTA, 3PA, USG%, TS%, eFG%, pace, AST%, OREB%, DREB%, TOV%, def rating, off rating, net rating, PIE, and (pregame `+ppg` runs only) the prior average PTS.

Present in the warehouse but not used as separate candidates:

| advanced column | reason |
|---|---|
| ast_ratio | near-duplicate of ast_pct (both per-possession assist rates) |
| ast_to | unusable as returned: source gives 0 for undefined (0 turnovers) in 18,770 rows |
| e_def_rating | duplicate of def_rating (estimated variant) |
| e_net_rating | duplicate of net_rating (estimated variant) |
| e_off_rating | duplicate of off_rating (NBA estimated variant) |
| e_pace | duplicate of pace (estimated variant) |
| e_tov_pct | duplicate of tov_pct (estimated variant) |
| e_usg_pct | duplicate of usg_pct (estimated variant) |
| pace_per40 | pace rescaled to 40 min (same information as pace) |
| possessions | ~ minutes x pace / 48 (near-duplicate of min and pace); used only as a weight |
| reb_pct | combination of oreb_pct and dreb_pct |
| sp_work_def_rating | duplicate of def_rating (tracking variant) |
| sp_work_net_rating | duplicate of net_rating (tracking variant) |
| sp_work_off_rating | duplicate of off_rating (tracking 'work' variant) |
| sp_work_pace | duplicate of pace (tracking variant) |

Not available in the warehouse (so not analysed): opponent / defender matchup features; game total / spread / betting lines; injury, lineup and teammate-out context; shot-location / tracking / play-type data (touches, drives, shot quality); team pace or opponent pace as a pregame input (only player-on-floor pace exists); starter status as a pregame input (lineups are not known when props are bet; `started` exists but is same-game).

## 3. Method (playbook order)

1. **Stack**: free Python only: statsmodels 0.15.0, scikit-learn 1.9.1, shap 0.54.1, lightgbm 4.7.0 (gradient boosting; chosen over scikit-learn's boosting for speed and native SHAP), pandas 3.1.1, duckdb 2.0.0. statsmodels, scikit-learn, shap and lightgbm were not installed in `nba-phase1/.venv` and were pip-installed there.
2. **Correlation screen**: Pearson and Spearman of each candidate with PTS on the train rows. Screening only; never a finding on its own.
3. **Multicollinearity**: standardise (clip at train 0.5/99.5 percentiles, then z-score with train mean/SD). Pre-specified definition drops first (net rating = off − def exactly). In the explanatory lens PIE is dropped because the same-game PIE contains the player's own PTS by construction. Then VIF on the train rows: while the largest VIF is > 10, take that variable and the variables it is correlated with at |r| ≥ 0.6 and drop the lowest-priority one (priority, high to low: prior PPG, minutes, FGA, FTA, 3PA, TS%, USG%, pace, AST%, OREB%, DREB%, TOV%, eFG%, def rating, off rating, PIE, net rating: direct box counts before rates before composites). Every drop and reason is in the `notes` of the screen rows and in `data/manifests/points_drivers.json`.
4. **OLS** on the train rows with player-cluster robust standard errors and 95% CIs.
5. **Elastic net** (`ElasticNetCV`, l1_ratio 0.3/0.6/1.0, 40 alphas) with **time-ordered CV inside train** (up to 5 expanding date chunks; validation always later than fitting). Survivors = non-zero coefficients.
6. **MixedLM** (statsmodels), player random intercept, REML, fixed effects with 95% CIs. Test predictions = fixed effects + the player's intercept for players seen in train (prior information, since train precedes test).
7. **Gradient boosting + SHAP** (LightGBM, number of trees chosen by the same time-ordered CV; SHAP on ≤ 3,000 test rows). Kept only if it clearly beats the best linear model on test: **MAE lower by ≥ 2% with a player-cluster bootstrap 95% CI for the MAE gain above 0 and a higher R²**. Otherwise "linear is enough" (rows are still written, with `rank_in_cell` null and the verdict in `notes`).

**Split**: by date only. For each timespan the unique game dates are ordered; train = the earlier 80% of dates, test = the last 20% (cut-offs below). The same date cut is used for every segment of a timespan, and every segment is modelled separately.

| timespan | first date | last date | game dates | test starts | test dates |
|---|---|---|---|---|---|
| pooled_2023_27 | 2023-11-02 | 2026-11-09 | 481 | 2026-01-15 | 96 |
| pooled_2023_26 | 2023-11-02 | 2026-04-12 | 466 | 2026-01-03 | 93 |
| 2023_24 | 2023-11-02 | 2024-04-14 | 151 | 2024-03-14 | 30 |
| 2024_25 | 2024-10-28 | 2025-04-13 | 157 | 2025-03-13 | 31 |
| 2025_26 | 2025-10-27 | 2026-04-12 | 158 | 2026-03-11 | 32 |
| 2026_27 | 2026-10-25 | 2026-11-09 | 15 | 2026-11-07 | 3 |

**Segments**: nested all / top100 / top50 / top25 / top10 by PPG within the timespan, with the app's games floors (pooled_2023_27: 50, pooled_2023_26: 40, 2023_24: 20, 2024_25: 20, 2025_26: 20, 2026_27: 3; tiebreak PPG, games played, lower player_id), using `analysis_home_away_b2b.py`'s own functions.
- **Explanatory lens**: membership = the app's segments, ranked on the whole window. This uses PPG from the test dates too, so the player pool is selected partly on the outcome being modelled. Fine for describing how points are produced, but its test scores are not a forecast.
- **Pregame lens**: membership fixed *before* the test window: ranked on the **train rows only**, with the games floor scaled by the train share of player-games. No look-ahead. Players with no train games in the window are not in the cell. Segment sizes therefore differ slightly between the two lenses.

**Lenses**

- **Explanatory**: same-game box stats (minutes, FGA, FTA, 3PA, USG%, TS%, … of the same game). These describe how points are produced; they are **not** pregame predictors. Warning: PTS = 2 × TS% × (FGA + 0.44 × FTA) is an accounting identity, so TS%, FGA and FTA 'explain' points almost by construction, and a non-linear model recovers that product almost exactly (this is why boosting is kept in most explanatory cells). Read it as an accounting of where points come from, not as a finding about what to bet on.
- **Pregame**: every input is strictly prior. For each player, chronologically across seasons: `l5` = mean over the last 5 prior games, `l10` = mean over up to the last 10 prior games (≥ 5 are guaranteed), `std` = mean over this season's prior games (≥ 3). The game itself is excluded (checked on about 200 random player-games against a hand computation: 0 mismatches). Percentages come from totals: TS% = Σ PTS / (2 (Σ FGA + 0.44 Σ FTA)), eFG% = (Σ FGM + 0.5 Σ 3PM) / Σ FGA; USG%, pace, AST%, OREB%, DREB%, TOV%, PIE are minutes-weighted pooled, off/def rating possession-weighted pooled (never an unweighted average of per-game rates).

## 4. Results, default cell (pooled_2023_26 × all)

### Explanatory (same-game): standardised effects, PTS per +1 SD, 95% CI

| OLS rank | driver | OLS (cluster-robust) | MixedLM rank | MixedLM | elastic net coef | SHAP mean abs |
|---|---|---|---|---|---|---|
| 1 | FGA | +6.48 [+6.38, +6.57] | 1 | +6.44 [+6.39, +6.49] | 6.45 | 4.966 |
| 2 | TS% | +2.64 [+2.51, +2.77] | 2 | +2.63 [+2.61, +2.65] | 2.64 | 3.195 |
| 3 | FTA | +1.93 [+1.87, +1.98] | 3 | +1.92 [+1.89, +1.94] | 1.92 | 1.124 |
| 4 | off rating | +0.42 [+0.38, +0.46] | 4 | +0.41 [+0.39, +0.43] | 0.41 | 0.012 |
| 5 | minutes | -0.22 [-0.28, -0.16] | 6 | -0.24 [-0.28, -0.20] | -0.18 | 0.236 |
| 6 | 3PA | +0.17 [+0.09, +0.25] | 5 | +0.27 [+0.24, +0.31] | 0.16 | 0.068 |
| 7 | TOV% | +0.12 [+0.09, +0.15] | 7 | +0.13 [+0.11, +0.16] | 0.11 | 0.005 |
| 8 | OREB% | -0.07 [-0.10, -0.04] | 8 | -0.09 [-0.12, -0.07] | -0.06 | 0.010 |
| 9 | DREB% | +0.05 [+0.02, +0.07] | 12 | +0.02 [-0.01, +0.04] | 0.04 | 0.002 |
| 10 | AST% | -0.03 [-0.08, +0.01] | 11 | -0.02 [-0.05, +0.00] | -0.02 | 0.003 |
| 11 | def rating | +0.03 [+0.01, +0.05] | 9 | +0.04 [+0.01, +0.06] | 0.02 | 0.001 |
| 12 | pace | +0.02 [-0.00, +0.05] | 10 | +0.03 [+0.01, +0.05] | 0.02 | 0.005 |

VIF / definition drops: **net rating** (definition drop: = off_rating - def_rating exactly (perfect collinearity); keep the two components); **PIE** (mechanical drop: same-game PIE contains the player's own PTS by construction (leakage of the target); screen only); **eFG%** (VIF drop: ts_pct had VIF 13.0 > 10; efg_pct (VIF 12.6) is the lowest-priority of its correlated set (ts_pct) so it was dropped); **USG%** (VIF drop: fga had VIF 12.5 > 10; usg_pct (VIF 6.3) is the lowest-priority of its correlated set (fga, min, fg3a) so it was dropped). Max |r| among kept = 0.76; max VIF after drops = 3.9.
Elastic net: alpha 0.0077, l1_ratio 1, survivors 12/12 (all kept). MixedLM player-intercept variance 0.18 vs residual 5.78.

### Pregame (primary spec: inputs = prior last-10 means): standardised effects, PTS per +1 SD, 95% CI

| OLS rank | driver | OLS (cluster-robust) | MixedLM rank | MixedLM | elastic net coef | SHAP mean abs |
|---|---|---|---|---|---|---|
| 1 | FGA | +4.74 [+4.55, +4.92] | 1 | +3.72 [+3.46, +3.97] | 4.71 | 3.550 |
| 2 | FTA | +1.36 [+1.21, +1.52] | 2 | +1.07 [+0.94, +1.20] | 1.35 | 0.633 |
| 3 | TS% | +0.25 [+0.14, +0.35] | 9 | +0.05 [-0.06, +0.16] | 0.19 | 0.169 |
| 4 | DREB% | +0.23 [+0.09, +0.37] | 6 | +0.21 [+0.10, +0.33] | 0.13 | 0.058 |
| 5 | OREB% | -0.22 [-0.31, -0.14] | 5 | -0.26 [-0.36, -0.15] | -0.13 | 0.099 |
| 6 | off rating | +0.20 [+0.13, +0.27] | 7 | +0.13 [+0.06, +0.20] | 0.17 | 0.102 |
| 7 | minutes | +0.12 [-0.02, +0.25] | 3 | +0.42 [+0.26, +0.58] | 0.14 | 0.584 |
| 8 | TOV% | +0.09 [+0.02, +0.15] | 8 | +0.12 [+0.05, +0.19] | 0.05 | 0.069 |
| 9 | PIE | +0.07 [-0.13, +0.27] | 12 | +0.02 [-0.17, +0.20] | 0.13 | 0.175 |
| 10 | AST% | +0.06 [-0.08, +0.20] | 4 | +0.27 [+0.15, +0.40] | 0.03 | 0.048 |
| 11 | pace | -0.03 [-0.09, +0.04] | 11 | -0.02 [-0.09, +0.04] | -0.00 (zeroed) | 0.024 |
| 12 | def rating | -0.00 [-0.06, +0.05] | 10 | +0.04 [-0.03, +0.11] | 0.00 (zeroed) | 0.038 |

VIF / definition drops: **net rating** (definition drop: = off_rating - def_rating exactly (perfect collinearity); keep the two components); **USG%** (VIF drop: fga had VIF 37.8 > 10; usg_pct (VIF 15.2) is the lowest-priority of its correlated set (fga, min, fta, fg3a) so it was dropped); **eFG%** (VIF drop: ts_pct had VIF 29.0 > 10; efg_pct (VIF 24.9) is the lowest-priority of its correlated set (ts_pct) so it was dropped); **3PA** (VIF drop: fga had VIF 11.9 > 10; fg3a (VIF 3.7) is the lowest-priority of its correlated set (fga, min, fta) so it was dropped). Max |r| among kept = 0.85; max VIF after drops = 9.1.
Elastic net: alpha 0.0357, l1_ratio 1, survivors 10/12 (minutes, FGA, FTA, TS%, AST%, OREB%, DREB%, TOV%, off rating, PIE). MixedLM player-intercept variance 1.77 vs residual 38.05.

### Test-set fit, default cell (last 20% of dates; baseline = prior season-to-date average)

Explanatory models use same-game inputs, so comparing them with the prior-average baseline is not a like-for-like forecast comparison; the baseline is shown for reference only. The pregame rows are the fair comparison.

| lens | model | test R² | test MAE | test RMSE | MAE vs baseline |
|---|---|---|---|---|---|
| explanatory | baseline: prior average | 0.428 | 4.815 | 6.262 | – |
| explanatory | enet | 0.918 | 1.658 | 2.372 | n/a (same-game inputs) |
| explanatory | gbm_shap | 0.998 | 0.175 | 0.405 | n/a (same-game inputs) |
| explanatory | mixedlm | 0.919 | 1.656 | 2.357 | n/a (same-game inputs) |
| explanatory | ols_cluster | 0.918 | 1.660 | 2.372 | n/a (same-game inputs) |
| pregame | baseline: prior average | 0.431 | 4.806 | 6.248 | – |
| pregame | enet@l10 | 0.449 | 4.761 | 6.148 | +0.9% |
| pregame | enet@l10+ppg | 0.449 | 4.766 | 6.151 | +0.8% |
| pregame | enet@l5 | 0.440 | 4.816 | 6.202 | -0.2% |
| pregame | enet@l5+ppg | 0.434 | 4.841 | 6.230 | -0.7% |
| pregame | enet@std | 0.433 | 4.848 | 6.238 | -0.9% |
| pregame | enet@std+ppg | 0.440 | 4.821 | 6.201 | -0.3% |
| pregame | gbm_shap@l10 | 0.448 | 4.778 | 6.154 | +0.6% |
| pregame | gbm_shap@l10+ppg | 0.449 | 4.771 | 6.152 | +0.7% |
| pregame | gbm_shap@l5 | 0.441 | 4.809 | 6.192 | -0.1% |
| pregame | gbm_shap@l5+ppg | 0.437 | 4.825 | 6.216 | -0.4% |
| pregame | gbm_shap@std | 0.434 | 4.846 | 6.231 | -0.8% |
| pregame | gbm_shap@std+ppg | 0.435 | 4.843 | 6.225 | -0.8% |
| pregame | mixedlm@l10 | 0.455 | 4.748 | 6.117 | +1.2% |
| pregame | mixedlm@l10+ppg | 0.453 | 4.760 | 6.127 | +1.0% |
| pregame | mixedlm@l5 | 0.452 | 4.767 | 6.134 | +0.8% |
| pregame | mixedlm@l5+ppg | 0.448 | 4.788 | 6.157 | +0.4% |
| pregame | mixedlm@std | 0.437 | 4.833 | 6.217 | -0.6% |
| pregame | mixedlm@std+ppg | 0.438 | 4.828 | 6.212 | -0.5% |
| pregame | ols_cluster@l10 | 0.449 | 4.761 | 6.150 | +0.9% |
| pregame | ols_cluster@l10+ppg | 0.448 | 4.768 | 6.153 | +0.8% |
| pregame | ols_cluster@l5 | 0.439 | 4.816 | 6.203 | -0.2% |
| pregame | ols_cluster@l5+ppg | 0.434 | 4.843 | 6.232 | -0.8% |
| pregame | ols_cluster@std | 0.433 | 4.847 | 6.238 | -0.8% |
| pregame | ols_cluster@std+ppg | 0.439 | 4.822 | 6.204 | -0.3% |

Boosting verdict, default cell: `gbm_shap`: KEPT; `gbm_shap@l10`: not kept (linear is enough); `gbm_shap@l10+ppg`: not kept (linear is enough); `gbm_shap@l5`: not kept (linear is enough); `gbm_shap@l5+ppg`: not kept (linear is enough); `gbm_shap@std`: not kept (linear is enough); `gbm_shap@std+ppg`: not kept (linear is enough).

## 5. Top drivers across segments and timespans

Ranked by |standardised OLS coefficient| (top 4). Thin cells are not ranked. Explanatory = OLS on same-game stats; pregame = OLS@l10 on prior last-10 means.

**explanatory** (`ols_cluster`)

| timespan | all | top100 | top50 | top25 | top10 |
|---|---|---|---|---|---|
| pooled_2023_26 | FGA, TS%, FTA, off rating | FGA, TS%, FTA, off rating | FGA, TS%, FTA, minutes | thin: not ranked | thin: not ranked |
| pooled_2023_27 | FGA, TS%, FTA, off rating | FGA, TS%, FTA, off rating | FGA, TS%, FTA, minutes | thin: not ranked | thin: not ranked |
| 2023_24 | FGA, TS%, FTA, off rating | FGA, TS%, FTA, off rating | FGA, TS%, FTA, minutes | thin: not ranked | thin: not ranked |
| 2024_25 | FGA, TS%, FTA, off rating | FGA, TS%, FTA, off rating | FGA, TS%, FTA, def rating | thin: not ranked | thin: not ranked |
| 2025_26 | FGA, TS%, FTA, off rating | FGA, TS%, FTA, 3PA | FGA, TS%, FTA, 3PA | thin: not ranked | thin: not ranked |
| 2026_27 | FGA, TS%, FTA, off rating | FGA, TS%, FTA, minutes | FGA, TS%, FTA, 3PA | thin: not ranked | not fitted (too few rows) |

**pregame** (`ols_cluster@l10`)

| timespan | all | top100 | top50 | top25 | top10 |
|---|---|---|---|---|---|
| pooled_2023_26 | FGA, FTA, TS%, DREB% | FGA, FTA, AST%, TS% | FGA, FTA, AST%, TS% | thin: not ranked | thin: not ranked |
| pooled_2023_27 | FGA, FTA, TS%, DREB% | FGA, FTA, AST%, TS% | FGA, FTA, AST%, TS% | thin: not ranked | thin: not ranked |
| 2023_24 | FGA, FTA, DREB%, OREB% | FGA, FTA, DREB%, OREB% | FTA, FGA, OREB%, DREB% | thin: not ranked | thin: not ranked |
| 2024_25 | FGA, FTA, TS%, off rating | FGA, FTA, AST%, TS% | FGA, FTA, off rating, pace | thin: not ranked | thin: not ranked |
| 2025_26 | FGA, FTA, PIE, TS% | FGA, FTA, TS%, pace | FGA, FTA, TS%, off rating | thin: not ranked | thin: not ranked |
| 2026_27 | FGA, FTA, off rating, 3PA | FGA, FTA, minutes, off rating | FGA, minutes, DREB%, off rating | thin: not ranked | not fitted (too few rows) |

Effect-size detail for the default timespan (pregame OLS@l10, PTS per +1 SD, 95% cluster-robust CI):

| segment | players | player-games | FGA | FTA | TS% | minutes |
|---|---|---|---|---|---|---|
| all | 668 | 66,094 | +4.74 [+4.55, +4.92] | +1.36 [+1.21, +1.52] | +0.25 [+0.14, +0.35] | +0.12 [-0.02, +0.25] |
| top100 | 100 | 16,563 | +3.01 [+2.70, +3.31] | +1.19 [+0.97, +1.41] | +0.37 [+0.20, +0.54] | +0.09 [-0.14, +0.33] |
| top50 | 50 | 8,389 | +1.92 [+1.42, +2.43] | +1.05 [+0.71, +1.40] | +0.51 [+0.22, +0.79] | +0.02 [-0.29, +0.33] |
| top25 (thin) | 25 | 4,220 | +1.27 [+0.77, +1.77] | +1.03 [+0.63, +1.43] | +0.36 [-0.11, +0.82] | +0.03 [-0.36, +0.43] |
| top10 (thin) | 10 | 1,778 | +0.62 [-0.04, +1.28] | +1.09 [+0.62, +1.55] | -0.41 [-0.94, +0.12] | +0.24 [-0.16, +0.63] |

Same for the explanatory lens (OLS, same-game stats):

| segment | FGA | TS% | FTA | minutes |
|---|---|---|---|---|
| all | +6.48 [+6.38, +6.57] | +2.64 [+2.51, +2.77] | +1.93 [+1.87, +1.98] | -0.22 [-0.28, -0.16] |
| top100 | +6.22 [+6.11, +6.32] | +4.25 [+4.04, +4.45] | +2.11 [+2.06, +2.17] | -0.19 [-0.25, -0.12] |
| top50 | +6.03 [+5.93, +6.13] | +4.69 [+4.53, +4.84] | +2.17 [+2.11, +2.24] | -0.11 [-0.19, -0.03] |
| top25 (thin) | +6.11 [+5.97, +6.25] | +4.93 [+4.77, +5.10] | +2.32 [+2.22, +2.41] | -0.09 [-0.16, -0.01] |
| top10 (thin) | +6.47 [+6.28, +6.66] | +4.95 [+4.64, +5.25] | +2.56 [+2.37, +2.76] | -0.08 [-0.22, +0.05] |

## 6. Fit versus the prior-average baseline, every cell

Test MAE (points). Baseline = prior season-to-date average on the same test rows. `best lin` = the best of OLS / elastic net / MixedLM on MAE. Pregame uses the primary spec `@l10`. `*` = thin cell.

**explanatory**

| timespan | segment | players / games | baseline MAE | best linear MAE | R² (best vs baseline) | MAE vs baseline | boosting MAE | boosting kept |
|---|---|---|---|---|---|---|---|---|
| pooled_2023_26 | all | 684 / 66,191 | 4.815 | 1.656 (mixedlm) | 0.919 vs 0.428 | n/a | 0.175 | kept |
| pooled_2023_26 | top100 | 100 / 16,499 | 5.962 | 1.181 (enet) | 0.952 vs 0.230 | n/a | 0.253 | kept |
| pooled_2023_26 | top50 | 50 / 8,216 | 6.181 | 1.031 (enet) | 0.965 vs 0.167 | n/a | 0.337 | kept |
| pooled_2023_26 | top25* | 25 / 4,242 | 6.226 | 0.955 (enet) | 0.969 vs 0.120 | n/a | 0.422 | kept |
| pooled_2023_26 | top10* | 10 / 1,778 | 6.489 | 0.916 (enet) | 0.972 vs 0.025 | n/a | 0.750 | kept |
| pooled_2023_27 | all | 710 / 68,059 | 4.873 | 1.655 (mixedlm) | 0.919 vs 0.419 | n/a | 0.178 | kept |
| pooled_2023_27 | top100 | 100 / 16,912 | 6.031 | 1.206 (enet) | 0.951 vs 0.238 | n/a | 0.247 | kept |
| pooled_2023_27 | top50 | 50 / 8,542 | 6.276 | 1.082 (enet) | 0.963 vs 0.189 | n/a | 0.320 | kept |
| pooled_2023_27 | top25* | 25 / 4,382 | 6.542 | 0.981 (enet) | 0.969 vs 0.097 | n/a | 0.437 | kept |
| pooled_2023_27 | top10* | 10 / 1,840 | 6.489 | 0.928 (enet) | 0.973 vs 0.100 | n/a | 0.834 | no |
| 2023_24 | all | 484 / 21,354 | 4.927 | 1.722 (mixedlm) | 0.919 vs 0.442 | n/a | 0.213 | kept |
| 2023_24 | top100 | 100 / 6,099 | 6.225 | 1.128 (enet) | 0.956 vs 0.149 | n/a | 0.396 | kept |
| 2023_24 | top50 | 50 / 2,990 | 6.609 | 1.064 (enet) | 0.952 vs 0.031 | n/a | 0.592 | kept |
| 2023_24 | top25* | 25 / 1,499 | 6.760 | 0.992 (enet) | 0.955 vs -0.017 | n/a | 0.922 | no |
| 2023_24 | top10* | 10 / 629 | 7.193 | 1.044 (enet) | 0.951 vs -0.026 | n/a | 1.027 | no |
| 2024_25 | all | 503 / 22,195 | 5.039 | 1.673 (mixedlm) | 0.920 vs 0.391 | n/a | 0.190 | kept |
| 2024_25 | top100 | 100 / 5,826 | 6.234 | 1.107 (enet) | 0.961 vs 0.133 | n/a | 0.349 | kept |
| 2024_25 | top50 | 50 / 2,962 | 6.749 | 1.022 (enet) | 0.966 vs 0.096 | n/a | 0.545 | kept |
| 2024_25 | top25* | 25 / 1,435 | 6.478 | 0.896 (enet) | 0.970 vs 0.076 | n/a | 0.894 | no |
| 2024_25 | top10* | 10 / 633 | 6.774 | 0.980 (enet) | 0.962 vs 0.019 | n/a | 0.973 | no |
| 2025_26 | all | 522 / 22,642 | 5.060 | 1.664 (mixedlm) | 0.920 vs 0.367 | n/a | 0.192 | kept |
| 2025_26 | top100 | 100 / 5,844 | 6.065 | 1.072 (enet) | 0.961 vs 0.180 | n/a | 0.363 | kept |
| 2025_26 | top50 | 50 / 2,869 | 6.297 | 1.029 (enet) | 0.966 vs 0.115 | n/a | 0.540 | kept |
| 2025_26 | top25* | 25 / 1,460 | 6.776 | 0.981 (enet) | 0.969 vs 0.080 | n/a | 0.891 | no |
| 2025_26 | top10* | 10 / 576 | 7.066 | 1.604 (enet) | 0.945 vs 0.053 | n/a | 2.023 | no |
| 2026_27 | all | 334 / 1,868 | 4.658 | 1.583 (mixedlm) | 0.928 vs 0.507 | n/a | 0.613 | kept |
| 2026_27 | top100 | 99 / 634 | 5.871 | 1.178 (enet) | 0.952 vs 0.275 | n/a | 0.924 | kept |
| 2026_27 | top50 | 50 / 320 | 6.236 | 1.116 (enet) | 0.961 vs 0.131 | n/a | 1.345 | no |
| 2026_27 | top25* | 25 / 161 | 7.139 | 1.004 (enet) | 0.976 vs -0.105 | n/a | 1.979 | no |
| 2026_27 | top10 | not fitted |  |  |  |  |  |  |

**pregame** (pregame `@l10`)

| timespan | segment | players / games | baseline MAE | best linear MAE | R² (best vs baseline) | MAE vs baseline | boosting MAE | boosting kept |
|---|---|---|---|---|---|---|---|---|
| pooled_2023_26 | all | 668 / 66,094 | 4.806 | 4.748 (mixedlm) | 0.455 vs 0.431 | +1.2% | 4.778 | no |
| pooled_2023_26 | top100 | 100 / 16,563 | 5.907 | 5.825 (mixedlm) | 0.286 vs 0.272 | +1.4% | 5.885 | no |
| pooled_2023_26 | top50 | 50 / 8,389 | 6.097 | 6.086 (mixedlm) | 0.203 vs 0.198 | +0.2% | 6.282 | no |
| pooled_2023_26 | top25* | 25 / 4,220 | 6.040 | 6.143 (mixedlm) | 0.147 vs 0.156 | -1.7% | 6.424 | no |
| pooled_2023_26 | top10* | 10 / 1,778 | 6.489 | 6.397 (mixedlm) | 0.023 vs 0.025 | +1.4% | 6.470 | no |
| pooled_2023_27 | all | 669 / 67,862 | 4.868 | 4.804 (mixedlm) | 0.445 vs 0.422 | +1.3% | 4.830 | no |
| pooled_2023_27 | top100 | 100 / 17,211 | 6.020 | 5.993 (mixedlm) | 0.280 vs 0.277 | +0.4% | 6.051 | no |
| pooled_2023_27 | top50 | 50 / 8,665 | 6.178 | 6.262 (mixedlm) | 0.202 vs 0.218 | -1.4% | 6.425 | no |
| pooled_2023_27 | top25* | 25 / 4,371 | 6.097 | 6.379 (mixedlm) | 0.140 vs 0.192 | -4.6% | 6.615 | no |
| pooled_2023_27 | top10* | 10 / 1,840 | 6.489 | 6.729 (mixedlm) | 0.034 vs 0.100 | -3.7% | 6.780 | no |
| 2023_24 | all | 479 / 21,344 | 4.929 | 4.820 (mixedlm) | 0.476 vs 0.443 | +2.2% | 4.836 | no |
| 2023_24 | top100 | 100 / 6,081 | 6.257 | 6.159 (mixedlm) | 0.197 vs 0.172 | +1.6% | 6.235 | no |
| 2023_24 | top50 | 50 / 3,031 | 6.496 | 6.441 (mixedlm) | 0.107 vs 0.094 | +0.8% | 6.465 | no |
| 2023_24 | top25* | 25 / 1,499 | 6.760 | 6.516 (enet) | 0.034 vs -0.017 | +3.6% | 6.537 | no |
| 2023_24 | top10* | 10 / 627 | 6.675 | 6.705 (enet) | -0.127 vs -0.111 | -0.5% | 6.734 | no |
| 2024_25 | all | 497 / 22,168 | 5.044 | 4.941 (mixedlm) | 0.425 vs 0.392 | +2.0% | 4.962 | no |
| 2024_25 | top100 | 100 / 5,751 | 6.104 | 6.107 (mixedlm) | 0.214 vs 0.207 | -0.0% | 6.084 | no |
| 2024_25 | top50 | 50 / 2,912 | 6.556 | 6.674 (mixedlm) | 0.122 vs 0.149 | -1.8% | 6.800 | no |
| 2024_25 | top25* | 25 / 1,435 | 6.478 | 6.482 (mixedlm) | 0.062 vs 0.076 | -0.1% | 6.527 | no |
| 2024_25 | top10* | 10 / 638 | 6.972 | 7.037 (ols_cluster) | -0.016 vs 0.053 | -0.9% | 7.177 | no |
| 2025_26 | all | 507 / 22,561 | 5.044 | 4.934 (mixedlm) | 0.405 vs 0.372 | +2.2% | 4.960 | no |
| 2025_26 | top100 | 100 / 5,770 | 6.025 | 5.994 (mixedlm) | 0.206 vs 0.203 | +0.5% | 6.108 | no |
| 2025_26 | top50 | 50 / 2,860 | 6.348 | 6.419 (mixedlm) | 0.122 vs 0.135 | -1.1% | 6.580 | no |
| 2025_26 | top25* | 25 / 1,460 | 6.776 | 6.843 (mixedlm) | 0.064 vs 0.080 | -1.0% | 6.958 | no |
| 2025_26 | top10* | 10 / 581 | 7.173 | 7.458 (enet) | -0.011 vs 0.059 | -4.0% | 7.489 | no |
| 2026_27 | all | 334 / 1,868 | 4.658 | 4.579 (ols_cluster) | 0.506 vs 0.507 | +1.7% | 4.782 | no |
| 2026_27 | top100 | 99 / 631 | 6.128 | 6.169 (ols_cluster) | 0.280 vs 0.304 | -0.7% | 6.321 | no |
| 2026_27 | top50 | 50 / 321 | 6.356 | 6.528 (ols_cluster) | 0.182 vs 0.225 | -2.7% | 7.003 | no |
| 2026_27 | top25* | 25 / 161 | 7.191 | 7.878 (enet) | -0.017 vs 0.082 | -9.6% | 7.825 | no |
| 2026_27 | top10 | not fitted |  |  |  |  |  |  |

**Pregame verdict (non-thin cells, `@l10`):** number of cells where the model beats the prior-average baseline, on MAE / on RMSE: ols_cluster: 8/18 (MAE), 9/18 (RMSE); enet: 8/18 (MAE), 9/18 (RMSE); mixedlm: 12/18 (MAE), 12/18 (RMSE); gbm_shap: 9/18 (MAE), 9/18 (RMSE).
 Best of the four models beats the baseline MAE in 13 of 18 non-thin cells.

Pregame window sensitivity, default cell (MAE improvement vs baseline; positive = better than the prior average):

| window | OLS | elastic net | MixedLM | boosting |
|---|---|---|---|---|
| l5 | 4.816 (-0.2%) | 4.816 (-0.2%) | 4.767 (+0.8%) | 4.809 (-0.1%) |
| l5+ppg | 4.843 (-0.8%) | 4.841 (-0.7%) | 4.788 (+0.4%) | 4.825 (-0.4%) |
| l10 | 4.761 (+0.9%) | 4.761 (+0.9%) | 4.748 (+1.2%) | 4.778 (+0.6%) |
| l10+ppg | 4.768 (+0.8%) | 4.766 (+0.8%) | 4.760 (+1.0%) | 4.771 (+0.7%) |
| std | 4.847 (-0.8%) | 4.848 (-0.9%) | 4.833 (-0.6%) | 4.846 (-0.8%) |
| std+ppg | 4.822 (-0.3%) | 4.821 (-0.3%) | 4.828 (-0.5%) | 4.843 (-0.8%) |

## 7. Thin cells (fewer than 30 players or fewer than 300 player-games): no driver ranking

| lens | timespan | segment | players | player-games | status |
|---|---|---|---|---|---|
| explanatory | 2023_24 | top10 | 10 | 629 | fitted, unranked |
| explanatory | 2023_24 | top25 | 25 | 1,499 | fitted, unranked |
| explanatory | 2024_25 | top10 | 10 | 633 | fitted, unranked |
| explanatory | 2024_25 | top25 | 25 | 1,435 | fitted, unranked |
| explanatory | 2025_26 | top10 | 10 | 576 | fitted, unranked |
| explanatory | 2025_26 | top25 | 25 | 1,460 | fitted, unranked |
| explanatory | 2026_27 | top10 | 10 | 62 | NOT fitted (too few rows) |
| explanatory | 2026_27 | top25 | 25 | 161 | fitted, unranked |
| explanatory | pooled_2023_26 | top10 | 10 | 1,778 | fitted, unranked |
| explanatory | pooled_2023_26 | top25 | 25 | 4,242 | fitted, unranked |
| explanatory | pooled_2023_27 | top10 | 10 | 1,840 | fitted, unranked |
| explanatory | pooled_2023_27 | top25 | 25 | 4,382 | fitted, unranked |
| pregame | 2023_24 | top10 | 10 | 627 | fitted, unranked |
| pregame | 2023_24 | top25 | 25 | 1,499 | fitted, unranked |
| pregame | 2024_25 | top10 | 10 | 638 | fitted, unranked |
| pregame | 2024_25 | top25 | 25 | 1,435 | fitted, unranked |
| pregame | 2025_26 | top10 | 10 | 581 | fitted, unranked |
| pregame | 2025_26 | top25 | 25 | 1,460 | fitted, unranked |
| pregame | 2026_27 | top10 | 10 | 62 | fitted, unranked |
| pregame | 2026_27 | top25 | 25 | 161 | fitted, unranked |
| pregame | pooled_2023_26 | top10 | 10 | 1,778 | fitted, unranked |
| pregame | pooled_2023_26 | top25 | 25 | 4,220 | fitted, unranked |
| pregame | pooled_2023_27 | top10 | 10 | 1,840 | fitted, unranked |
| pregame | pooled_2023_27 | top25 | 25 | 4,371 | fitted, unranked |

All top25 and top10 cells are thin by the 30-player rule (they have 25 and 10 players), whatever the timespan. The coefficients and test scores of those cells are still in the table for completeness, but should not be read as rankings. 2026-27 top10 is not fitted at all (62 player-games).

## 8. Plain-English read

**Explanatory lens (how points are produced; same-game).** In every non-thin cell the same three same-game measures carry most of the association with PTS: FGA, TS% and FTA, with minutes, 3PA and off rating a distant second tier. Default cell (OLS, PTS per +1 SD, 95% CI): FGA +6.48 [+6.38, +6.57], TS% +2.64 [+2.51, +2.77], FTA +1.93 [+1.87, +1.98]. Minutes has a small *negative* coefficient (-0.22 [-0.28, -0.16]) once FGA and FTA are in the model: minutes matter through the shots taken. USG% was dropped by VIF (it is a function of FGA, FTA, TOV and minutes). Pace, AST%, DREB%, def rating are near zero. Because PTS = 2·TS%·(FGA + 0.44·FTA), this lens reads like an accounting identity: high R² (OLS ≈ 0.92, boosting ≈ 0.998 in the default cell) tells us the stats add up to the points, not what to expect next game. The picture is stable across the 4 single seasons and the 2 pools; section 5 lists the ordering per cell.

**Pregame lens, per segment (default timespan pooled_2023_26; OLS@l10 drivers with 95% CI; test MAE vs the prior-average baseline):**

- **all (668 players, 66,094 player-games).** Pregame OLS@l10 top drivers: FGA +4.74 [+4.55, +4.92], FTA +1.36 [+1.21, +1.52], TS% +0.25 [+0.14, +0.35]. Test MAE: baseline 4.806, OLS 4.761, MixedLM 4.748, boosting 4.778.
- **top100 (100 players, 16,563 player-games).** Pregame OLS@l10 top drivers: FGA +3.01 [+2.70, +3.31], FTA +1.19 [+0.97, +1.41], AST% +0.41 [+0.18, +0.65]. Test MAE: baseline 5.907, OLS 5.887, MixedLM 5.825, boosting 5.885.
- **top50 (50 players, 8,389 player-games).** Pregame OLS@l10 top drivers: FGA +1.92 [+1.42, +2.43], FTA +1.05 [+0.71, +1.40], AST% +0.52 [+0.21, +0.82]. Test MAE: baseline 6.097, OLS 6.149, MixedLM 6.086, boosting 6.282.
- **top25 (thin: 25 players, 4,220 player-games).** Not ranked. Pregame test MAE: baseline 6.04, OLS 6.29, MixedLM 6.14; test R² OLS 0.12 vs baseline 0.16. Treat as unreliable.
- **top10 (thin: 10 players, 1,778 player-games).** Not ranked. Pregame test MAE: baseline 6.49, OLS 6.40, MixedLM 6.40; test R² OLS 0.02 vs baseline 0.02. Treat as unreliable.

**Pregame lens (what prior form predicts; the one relevant for points props).** Prior volume (FGA and FTA over the last 10 games) is by far the strongest pregame signal; efficiency and the other rates are weak by comparison, and rate stats such as pace, def rating and PIE carry intervals that include 0 in the default cell. Default cell (pregame OLS@l10): FGA +4.74 [+4.55, +4.92], FTA +1.36 [+1.21, +1.52], TS% +0.25 [+0.14, +0.35], minutes +0.12 [-0.02, +0.25]. When the prior average PTS is added (`+ppg`), it absorbs FGA, FTA and 3PA by VIF (they are near-duplicates of it); prior PPG then has +6.01 [+5.84, +6.19].

**How much better than 'the player's prior average'?** Not much. In the default cell the test MAE is 4.806 for the baseline against 4.761 (OLS) and 4.748 (MixedLM), i.e. 0.9% and 1.2% lower; R² 0.449 / 0.455 vs 0.431. In the high-scorer segments the linear models do **not** reliably beat the prior average on MAE (see section 6), and in the thin top-scorer cells they are usually worse. Per-game scoring is mostly noise around a player's level (residual SD ≈ 6 points), and the rolling box inputs do not remove it. Boosting was **not** kept in any pregame cell (it never clearly beats the best linear model), so for pregame "linear is enough"; it was kept in most explanatory cells only because of the TS%·(FGA+0.44·FTA) identity.

Boosting kept (explanatory): 20 of 29 fitted cells; not kept: 2023_24×top10, 2023_24×top25, 2024_25×top10, 2024_25×top25, 2025_26×top10, 2025_26×top25, 2026_27×top25, 2026_27×top50, pooled_2023_27×top10. Pregame: kept in 0 of 174 pregame cell-specs.

## 9. Limitations

- Associations, not causes; collinear box variables (FGA, FTA, minutes, USG%, prior PPG) share signal, so individual coefficients depend on which near-duplicates the VIF step dropped (logged).
- Explanatory lens is an accounting identity plus context (PTS = 2·TS%·(FGA + 0.44·FTA)); its high R² is not forecast skill. Its segment membership uses the full window's PPG (selection on the outcome).
- Pregame lens uses only prior box rolling inputs. It has no opponent, home/rest, injury, lineup, minutes-expectation or betting-line information (not in the warehouse), which are exactly what move a real points prop. Minutes are the prior-games average, not the expected minutes for tonight.
- The baseline is season-to-date prior average PTS (≥ 3 games), the pre-declared 'player's prior average'. A last-10 average is a slightly different baseline; its test MAE is in `notes` (`baseline_l10_mae`).
- Rows require ≥ 5 minutes, ≥ 5 prior games overall and ≥ 3 prior games this season: early-season games, rookies' first games and garbage-time cameos are excluded. Players with no train games in a window are not in its pregame cell.
- One time split per cell (last ~20% of game dates) gives one test score per model; differences of a few hundredths of a point are within noise (the player-cluster bootstrap is used only for the boosting decision). 2026-27 has 15 game dates, test = 3 dates (provisional, small).
- OLS CIs are player-cluster robust; the MixedLM CIs are model-based, and are narrower. The MixedLM test prediction uses the train-period player intercept, which is legitimate prior information but gives it an advantage over plain OLS. Elastic net and boosting have no interval for the effects.
- Winsorising the predictors at the train 0.5/99.5 percentiles trims the extreme advanced-rate values (ratings, pace) that the source returns for short stints.
- Players' minutes-weighted pooled rates for USG%, pace, AST%, OREB%, DREB%, TOV%, PIE are approximations of the exact pooled rate (they are not rebuilt from team totals).
