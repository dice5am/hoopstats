# DEEP_ANALYSES: tiers, tails, interactions and per-player depth (hoopstats)

Data through **2026-11-09**; 66,592 eligible pregame player-games (2023-24 to 2026-27 to date). Scripts: `scripts/deep_data.py` (dataset), `scripts/deep_analyses.py` (cells, interactions, random slopes, per-player), `scripts/deep_assemble.py` (marts, views, manifest, `data/deep_analyses_summary.json`), `scripts/deep_report.py` (this file). Everything is **pregame** (strictly prior games). Language: *associated with / predicts*, never causes.

Cavin's challenge: *stars tend to have big nights against poor teams; linear mean-only models could miss that.* Tested below with tier cuts, splines, big-night tails, quantile regression, dispersion, interactions, partial pooling, per-player shrinkage. Nothing here was set up to confirm the claim: the same machinery also reports the opposite tail (good defences), the stability across seasons, and out-of-sample skill versus base rates.

## 1. Headline


**Do stars pop against poor defences? Partly on the mean, weakly on the tails, and the pattern is asymmetric and not stable across seasons.**

1. **Mean (unadjusted, vs the other defences).** Games against the 5 worst defences (as-of DRtg rank, pooled 2023-24 to 2025-26) are +0.63 PTS above the player's prior average relative to games against the other 25 defences for everyone [+0.49, +0.78], and **+1.21 [+0.74, +1.68] for the top 50 scorers** (bottom 10: +0.53 all, +0.86 [+0.50, +1.23] top 50). In points the star effect is about double the all-player effect, in relative terms (ratio of big-night rates) it is about the same.
2. **Tails (unadjusted).** Top-50 P(PTS >= prior avg + 10) is 12.7% against bottom-5 defences vs 10.3% against the rest (difference +2.4 pp [+0.2, +4.6], ratio 1.23); P(PTS >= 1.25 x prior avg) 26.6% vs 21.7% (+4.8 pp [+2.0, +7.6]).
3. **Adjusted tails (logit, controls for prior average, usage, minutes, role, position, season progress, pace, rest, home; vs the middle 10 defences).** Top-50 bottom-10 defences: big10 odds ratio 1.01 [0.89, 1.16] (absolute +0.1 pp [-1.0, +1.2]); x1.25: 1.06 [0.93, 1.20] (+0.9 pp [-1.0, +3.1]). **The CI includes 1: no credible extra big-night probability for top-50 stars against bottom-10 defences once the other conditions are held fixed.** All players pooled do show a small credible uplift (big10 OR 1.08 [1.02, 1.16]).
4. **The sharper asymmetry is on the other side.** Top-50 stars against top-10 defences: -0.90 PTS [-1.26, -0.54] vs the other defences; adjusted big10 OR 0.83 [0.72, 0.97], x1.25 OR 0.79 [0.71, 0.88] (CI excludes 1). Elite defences are associated with fewer big nights for stars; weak defences are associated with at most a small increase.
5. **Not stable across seasons.** Top-50 vs bottom-5 defences, PTS vs prior average: 2023-24 +2.10 [+1.24, +2.96], 2024-25 +1.13 [+0.24, +2.01], 2025-26 +0.52 [-0.37, +1.42]; big10 difference 2023-24 +7.7 pp, 2024-25 +0.3 pp, 2025-26 -1.7 pp. The adjusted top-50 big10 odds ratio for bottom-10 defences is 1.56 [1.17, 2.09] in 2023-24, 0.77 [0.58, 1.03] in 2024-25 and 1.05 [0.78, 1.40] in 2025-26. The pooled star effect leans heavily on 2023-24.
6. **Linear model miss?** Opponent-defence effect is nonlinear for stars (cluster-robust Wald test of the nonlinear part: p<0.01 for top 100, top 50 in both pooled windows, but p>0.4 for all players): a bump over the ~8 worst defences, about 0 through the middle, then a sharp fall against the best ~6 (spline: top 50 +0.78 PTS at rank 1, +0.04 at rank 15, -1.45 at rank 30). But **nonlinear forms do not predict better out of sample**: versus the linear opponent spec, tier bins, spline and gradient boosting never gain with a CI above 0 in a clear majority of cells (sections 4 and 5).
7. **Player-specific?** Per-player bottom-5/10 big-night effects have estimated between-player SD of 0 (DerSimonian-Laird): nothing beyond sampling noise, so no individual star has a player-specific credible big-night uplift (section 9). Watch-flag counts are at or below what chance alone gives for the big10 outcome.

Short version for the app: *poor defences are associated with a modest rise in scoring (about +0.6 PTS for all players, about +1.2 PTS for top-50 scorers, 1.2x the big-night rate), top defences with a clearly larger drop for stars; the star-specific "big night vs bad teams" signal is not distinguishable from the general effect and is not stable season to season.*

## 2. Definitions (all pregame)

| item | definition |
|---|---|
| rows | eligible rows of `matchups.parquet`: >= 5 minutes, >= 5 prior games overall, >= 3 prior this season, opponent with >= 5 prior games (66,592 rows) |
| prior_avg | player's season-to-date mean PTS over prior games (the baseline used everywhere in this doc) |
| dev | PTS - prior_avg |
| big5 / big10 | PTS >= prior_avg + 5 / + 10 |
| x125 | PTS >= 1.25 x prior_avg |
| def_tier | opponent as-of season-to-date DRtg rank among teams with >= 5 games strictly before the date: **worst5** (ranks 26-30 of 30), **worst6_10**, **middle** (11-20), **best6_10**, **best5**. Fractions of ranked teams 1/6, 1/3, 2/3, 5/6 when fewer than 30 teams are ranked. Exclusive levels are compared with `middle`. **Nested** groups: worst10 = worst5 + worst6_10, best10 likewise, compared with the **complement** (the other 20 / 25 defences) |
| pace_tier | same on as-of season-to-date pace (fastest5 ... slowest5) |
| usage_tier | player's prior season-to-date USG%: u1 < 18% <= u2 < 24% <= u3 < 28% <= u4 |
| min_tier | prior season-to-date minutes: m1 < 20 <= m2 < 28 <= m3 < 34 <= m4 |
| rest_days / b2b_state | own team rest 0 / 1 / 2 / 3+; 2nd / 1st night of a back-to-back / rested, from the schedule |
| role | starter if the player started >= 50% of his prior games this season (derived from `started` in the box), else bench. Tonight's lineup is unknown pregame, so role is the prior role |
| cells | 5 PPG segments (all, top100/50/25/10; membership = train-period PPG ranks, no look-ahead) x 6 timespans (same as the other analyses); thin = < 30 players or < 300 games |
| split | descriptive effects (tier tables, odds ratios, quantile shifts, dispersion, interactions): all eligible rows of the cell, player-clustered SEs. Out-of-sample skill (mean models, logistic/GBM, quantile pinball, calibration): fit on the first ~80% of game dates, scored on the last ~20% (cut-offs in the manifest) |

Base rates (pooled_2023_26, all eligible rows): P(big5) 20.9%, P(big10) 7.0%, P(x125) 32.7%; for the top-50 scorers P(big10) about 10%. The mean of dev is +0.38 for everyone (rows need >= 5 minutes today, prior averages include low-minute games) and about -0.4 for the highest-usage players (regression to the mean of the baseline): tier **main** effects on dev are partly baseline artefacts, so read *contrasts across conditions within a tier*, not the level of dev.

Table schemas: `tier_effects`, `spline_effects`, `tail_models`, `tail_performance`, `tail_calibration`, `dispersion_effects`, `interaction_effects`, `player_deep_splits`, `player_deep_summary` (DuckDB views of the same names, parquet in `data/marts/`).

## 3. Defence tiers (means and tails)

Unadjusted contrast of each nested group with the complement, **pooled_2023_26**; est [95% CI] player-clustered. dev in PTS, big-night columns in percentage points of probability. Thin segments (top25, top10 < 30 players) are flagged.

| segment | vs | dev | big5 | big10 | x125 | games |
|---|---|---|---|---|---|---|
| all | worst5 | +0.63 [+0.49, +0.78] | +2.7 [+1.7, +3.6] | +1.3 [+0.7, +1.9] | +4.0 [+2.9, +5.0] | 11005 |
| all | worst10 | +0.53 [+0.43, +0.63] | +2.4 [+1.7, +3.1] | +1.2 [+0.8, +1.6] | +3.2 [+2.5, +4.0] | 21877 |
| all | best10 | -0.57 [-0.67, -0.46] | -2.8 [-3.5, -2.2] | -1.4 [-1.8, -1.0] | -3.7 [-4.5, -3.0] | 21667 |
| all | best5 | -0.50 [-0.64, -0.37] | -1.9 [-2.8, -1.1] | -1.2 [-1.7, -0.7] | -2.7 [-3.6, -1.7] | 10884 |
| top100 | worst5 | +0.97 [+0.64, +1.30] | +3.7 [+1.7, +5.7] | +2.0 [+0.6, +3.5] | +3.9 [+2.0, +5.9] | 2674 |
| top100 | worst10 | +0.74 [+0.50, +0.98] | +2.5 [+1.0, +4.0] | +1.7 [+0.7, +2.7] | +3.0 [+1.6, +4.5] | 5390 |
| top100 | best10 | -0.83 [-1.09, -0.57] | -3.7 [-5.2, -2.2] | -1.8 [-2.7, -1.0] | -3.8 [-5.3, -2.4] | 5516 |
| top100 | best5 | -1.05 [-1.36, -0.74] | -3.5 [-5.2, -1.8] | -1.9 [-3.0, -0.8] | -4.1 [-5.8, -2.3] | 2725 |
| top50 | worst5 | +1.21 [+0.74, +1.68] | +4.9 [+2.0, +7.8] | +2.4 [+0.2, +4.6] | +4.8 [+2.0, +7.6] | 1378 |
| top50 | worst10 | +0.86 [+0.50, +1.23] | +3.4 [+1.0, +5.7] | +1.8 [+0.4, +3.1] | +3.6 [+1.4, +5.8] | 2715 |
| top50 | best10 | -0.90 [-1.26, -0.54] | -4.9 [-7.0, -2.8] | -2.2 [-3.5, -0.9] | -4.7 [-6.6, -2.9] | 2800 |
| top50 | best5 | -1.14 [-1.55, -0.73] | -4.8 [-7.0, -2.6] | -1.5 [-3.1, +0.1] | -4.5 [-6.6, -2.4] | 1398 |
| top25 (thin) | worst5 | +0.75 [+0.10, +1.39] | +2.4 [-0.7, +5.6] | +2.5 [-0.4, +5.3] | +3.6 [+0.8, +6.4] | 700 |
| top25 (thin) | worst10 | +0.42 [-0.07, +0.91] | +1.5 [-1.7, +4.6] | +2.2 [+0.3, +4.0] | +2.5 [-0.6, +5.6] | 1372 |
| top25 (thin) | best10 | -0.49 [-0.96, -0.01] | -3.4 [-6.4, -0.5] | -2.0 [-3.9, -0.2] | -3.1 [-5.8, -0.5] | 1397 |
| top25 (thin) | best5 | -0.84 [-1.45, -0.23] | -3.2 [-6.8, +0.5] | -0.7 [-3.1, +1.7] | -3.1 [-6.7, +0.4] | 694 |
| top10 (thin) | worst5 | +0.86 [-0.33, +2.05] | +4.6 [-1.1, +10.4] | +4.7 [-1.6, +10.9] | +5.6 [+1.1, +10.2] | 298 |
| top10 (thin) | worst10 | +0.41 [-0.50, +1.31] | +3.6 [-2.4, +9.5] | +4.2 [+1.6, +6.8] | +5.0 [+0.7, +9.3] | 592 |
| top10 (thin) | best10 | -0.13 [-0.94, +0.69] | -5.5 [-10.7, -0.3] | -3.5 [-6.4, -0.7] | -4.6 [-8.8, -0.3] | 607 |
| top10 (thin) | best5 | -0.35 [-1.38, +0.68] | -1.5 [-7.1, +4.0] | -0.6 [-4.5, +3.3] | -2.9 [-8.8, +2.9] | 299 |

Exclusive five-way tiers (vs middle 11-20), top 50 and all players, dev (PTS):

| segment | worst5 | worst6_10 | best6_10 | best5 |
|---|---|---|---|---|
| all | +0.51 [+0.36, +0.65] | +0.16 [+0.02, +0.29] | -0.36 [-0.49, -0.22] | -0.44 [-0.59, -0.29] |
| top100 | +0.75 [+0.42, +1.07] | +0.12 [-0.23, +0.46] | -0.29 [-0.61, +0.03] | -0.94 [-1.27, -0.61] |
| top50 | +0.97 [+0.47, +1.47] | +0.10 [-0.36, +0.57] | -0.28 [-0.73, +0.17] | -0.98 [-1.42, -0.54] |

Reading: the lift is concentrated in the worst 5 (ranks 26-30); ranks 21-25 look like the middle; the best 10 defences carry the larger, cleaner effect (negative).

### Stability by season (bottom-5 defences vs the other 25, PTS vs prior average and big10 pp)

| segment | 2023_24 dev | 2023_24 big10 | 2024_25 dev | 2024_25 big10 | 2025_26 dev | 2025_26 big10 |
|---|---|---|---|---|---|---|
| all | +0.67 [+0.41, +0.92] | +1.9 [+0.8, +3.0] | +0.56 [+0.33, +0.80] | +0.8 [-0.2, +1.7] | +0.68 [+0.43, +0.92] | +1.3 [+0.3, +2.3] |
| top100 | +1.71 [+1.11, +2.31] | +6.1 [+3.4, +8.7] | +0.51 [-0.08, +1.10] | -0.3 [-2.4, +1.9] | +0.63 [+0.01, +1.25] | +0.7 [-1.5, +2.9] |
| top50 | +2.10 [+1.24, +2.96] | +7.7 [+4.3, +11.1] | +1.13 [+0.24, +2.01] | +0.3 [-3.3, +3.8] | +0.52 [-0.37, +1.42] | -1.7 [-4.3, +0.8] |

**Counts (expected by chance if there were no effect: about 2.5% of cells per side, i.e. 0.4 of ~15):** across the non-thin cells (overlapping windows, so not independent), CI above 0 for worst5/worst10 in 10-13 of 15-16 cells and CI below 0 for best5/best10 in 9-14 of 15-16 cells, for dev, big5, big10 and x1.25 alike (full counts in `tier_effects`). The direction is consistent; the star-specific part is what the interaction tests in section 7 address.

## 4. Splines and non-linearity (mean of PTS - prior average)

Cluster-robust Wald test that a natural cubic spline (df 5) adds anything to the linear term, given the other linear controls; non-thin cells; BH is not applied across these (counts vs chance shown instead).

| variable | segment | n | cells p<0.05 | expected by chance |
|---|---|---|---|---|
| min_prior | all | 6 | 4.0 | 0.3 |
| min_prior | top100 | 5 | 1.0 | 0.3 |
| min_prior | top50 | 5 | 3.0 | 0.3 |
| opp_def_u | all | 6 | 0.0 | 0.3 |
| opp_def_u | top100 | 5 | 3.0 | 0.3 |
| opp_def_u | top50 | 5 | 4.0 | 0.3 |
| opp_pace_u | all | 6 | 0.0 | 0.3 |
| opp_pace_u | top100 | 5 | 1.0 | 0.3 |
| opp_pace_u | top50 | 5 | 4.0 | 0.3 |
| prior_avg | all | 6 | 6.0 | 0.3 |
| prior_avg | top100 | 5 | 4.0 | 0.3 |
| prior_avg | top50 | 5 | 5.0 | 0.3 |
| usg_prior | all | 6 | 4.0 | 0.3 |
| usg_prior | top100 | 5 | 1.0 | 0.3 |
| usg_prior | top50 | 5 | 2.0 | 0.3 |

Fitted PTS vs prior average (spline, other covariates at mean) by opponent rank from the worst defence (1) to the best (30), and for pace from the fastest (1) to the slowest (30); CIs are in `spline_effects`:

| variable | segment | 1.0 | 5.0 | 10.0 | 15.0 | 20.0 | 25.0 | 30.0 |
|---|---|---|---|---|---|---|---|---|
| opp_def_u | all | 0.81 | 0.61 | 0.45 | 0.37 | 0.19 | -0.01 | -0.09 |
| opp_def_u | top50 | 0.78 | 0.42 | 0.11 | 0.04 | 0.12 | -0.25 | -1.45 |
| opp_pace_u | all | 0.69 | 0.57 | 0.45 | 0.33 | 0.19 | 0.07 | -0.01 |
| opp_pace_u | top50 | 1.44 | 0.32 | -0.09 | 0.2 | -0.08 | -0.51 | -0.9 |

Shape: for all players the opponent curves are close to linear (Wald p about 0.4-0.97). For the top 100 and top 50 scorers the defence curve is elevated over the worst ~8 defences (+0.4 to +0.8), about 0 across ranks 10-22 and then falls steeply (top 50: -1.45 at rank 30); the top-25 curve is flat to rank 22 and then falls. The pace curve is steeper at the fast end for top 25/50.

Out-of-sample (non-thin cells, test = last ~20% of dates, MAE of PTS; paired player-cluster bootstrap CI on the gain). `controls` = prior avg, usage, minutes, season progress, role; `linear` adds linear opponent DRtg/pace, home, B2B; `tiers` bins; `spline` df 4; `spline_plus_player` also splines the player terms.

| model | cells | beats_controls | beats_linear | worse_than_linear | beats_prior_avg |
|---|---|---|---|---|---|
| controls | 16 |  |  |  | 2.0 |
| linear | 16 | 7.0 |  |  | 2.0 |
| prior_average | 16 | 2.0 |  |  |  |
| spline | 16 | 7.0 | 1.0 | 1.0 | 2.0 |
| spline_plus_player | 16 | 6.0 | 2.0 | 3.0 | 3.0 |
| tiers | 16 | 8.0 | 1.0 | 2.0 | 2.0 |

**Result:** adding opponent context beats controls-only in about half the cells, but tier bins and splines are **not** better than the linear specification in a majority of cells (gain vs linear has CI above 0 in 1-2 of 16, below 0 in 1-3 of 16). The prior season-to-date average alone is a hard baseline to beat; a regression of dev on controls does not beat it in the test period for the star segments (late-season dev is lower than in training; see calibration note). Non-linearity is real in-sample for stars, but it does not translate into out-of-sample accuracy gains at this sample size.

## 5. Pace, usage, minutes, rest tiers

pooled_2023_26, dev (PTS vs prior average) and big10 (pp), contrasts with the reference level (pace and defence: middle; usage u2; minutes m2; rest r1 = one day). Segments all and top50. Cells with < 30 games are null.

| segment | dimension | level | games | dev | big10 |
|---|---|---|---|---|---|
| all | opp_pace_tier | fastest5 | 10886 | +0.51 [+0.37, +0.66] | +1.3 [+0.7, +1.9] |
| all | opp_pace_tier | fast6_10 | 10882 | +0.31 [+0.16, +0.45] | +0.8 [+0.2, +1.4] |
| all | opp_pace_tier | slow6_10 | 10913 | -0.19 [-0.32, -0.05] | -0.4 [-0.9, +0.1] |
| all | opp_pace_tier | slowest5 | 10704 | -0.27 [-0.41, -0.13] | -0.6 [-1.2, -0.0] |
| all | usage_tier | u1_low | 35499 | +0.12 [-0.06, +0.31] | -3.4 [-4.0, -2.7] |
| all | usage_tier | u3_high | 6387 | -0.41 [-0.71, -0.12] | +1.1 [-0.1, +2.2] |
| all | usage_tier | u4_very_high | 4363 | -0.86 [-1.22, -0.51] | +1.4 [+0.2, +2.5] |
| all | minutes_tier | m1_lt20 | 21604 | +0.28 [+0.12, +0.44] | -1.8 [-2.4, -1.2] |
| all | minutes_tier | m3_28_34 | 15800 | -0.51 [-0.71, -0.31] | +1.1 [+0.3, +1.8] |
| all | minutes_tier | m4_ge34 | 6384 | -0.93 [-1.19, -0.67] | +2.1 [+1.0, +3.2] |
| all | rest_days | r0 | 11574 | +0.26 [+0.12, +0.40] | +0.8 [+0.3, +1.4] |
| all | rest_days | r2 | 9232 | -0.09 [-0.23, +0.05] | +0.1 [-0.5, +0.7] |
| all | rest_days | r3plus | 3371 | -0.33 [-0.53, -0.12] | -1.1 [-1.9, -0.3] |
| top50 | opp_pace_tier | fastest5 | 1391 | +1.09 [+0.56, +1.61] | +3.7 [+1.6, +5.9] |
| top50 | opp_pace_tier | fast6_10 | 1391 | +0.11 [-0.43, +0.65] | +0.2 [-1.5, +2.0] |
| top50 | opp_pace_tier | slow6_10 | 1376 | -0.38 [-0.85, +0.09] | -1.3 [-3.0, +0.4] |
| top50 | opp_pace_tier | slowest5 | 1325 | -0.91 [-1.31, -0.51] | -2.3 [-4.0, -0.7] |
| top50 | usage_tier | u1_low | 2 | n/a (n<30) | n/a (n<30) |
| top50 | usage_tier | u3_high | 3227 | -0.71 [-1.36, -0.06] | -0.9 [-3.4, +1.6] |
| top50 | usage_tier | u4_very_high | 3939 | -1.27 [-1.95, -0.59] | -1.4 [-3.7, +1.0] |
| top50 | minutes_tier | m1_lt20 | 5 | n/a (n<30) | n/a (n<30) |
| top50 | minutes_tier | m3_28_34 | 3875 | -0.49 [-2.59, +1.61] | -2.8 [-7.7, +2.1] |
| top50 | minutes_tier | m4_ge34 | 4124 | -1.15 [-3.25, +0.95] | -3.6 [-8.5, +1.3] |
| top50 | rest_days | r0 | 1364 | -0.02 [-0.49, +0.45] | +0.4 [-1.6, +2.3] |
| top50 | rest_days | r2 | 1241 | +0.17 [-0.32, +0.65] | +0.0 [-1.8, +1.9] |
| top50 | rest_days | r3plus | 462 | +0.20 [-0.52, +0.91] | -0.7 [-3.8, +2.3] |

Reading: **opponent pace is as strong as opponent defence** and also nonlinear for stars (fastest 5: top-50 +1.1 PTS, big10 +3.7 pp; slowest 5: -0.9 PTS, -2.3 pp). Rest: more rest days go with a smaller excess over the prior average for everyone (r0 +0.26, r2 -0.09, r3+ -0.33 PTS vs r1), not for the top 50 (null). Usage and minutes tiers: the high-usage/high-minutes tiers sit lower on dev (baseline regression, see section 2); in the star segments the usage and minutes cells are nearly empty at the low tiers (2-5 games, suppressed). Within-tier interaction with defence is in section 7.

## 6. Tails: odds ratios, absolute differences, quantile shifts, skill

Logistic (player-clustered SEs, AME CI from 400 draws of the clustered covariance), controls: prior avg, usage, minutes, season progress (log prior games), role, position; terms vs the middle 10 defences/pace. `logit_ctx_nested` is used for the bottom-10/top-10 questions. Full-spec results (worst5 / worst6_10 separately, pace tiers, home, B2B) are in `tail_models`.

| segment | term | big5 OR | big5 abs pp | big10 OR | big10 abs pp | x125 OR | x125 abs pp |
|---|---|---|---|---|---|---|---|
| all | def_worst10 | 1.07 [1.02, 1.12] | +1.0 [+0.3, +1.7] | 1.08 [1.02, 1.16] | +0.5 [+0.1, +0.9] | 1.06 [1.02, 1.10] | +1.3 [+0.4, +2.0] |
| all | def_best10 | 0.88 [0.84, 0.92] | -2.1 [-2.8, -1.4] | 0.85 [0.79, 0.92] | -1.0 [-1.5, -0.6] | 0.89 [0.85, 0.92] | -2.6 [-3.5, -1.7] |
| top100 | def_worst10 | 1.00 [0.92, 1.09] | +0.1 [-1.6, +1.6] | 1.06 [0.95, 1.18] | +0.5 [-0.5, +1.6] | 1.04 [0.96, 1.13] | +0.7 [-0.9, +2.3] |
| top100 | def_best10 | 0.84 [0.77, 0.92] | -3.1 [-4.6, -1.6] | 0.87 [0.78, 0.97] | -1.2 [-2.2, -0.4] | 0.85 [0.78, 0.93] | -2.9 [-4.4, -1.3] |
| top50 | def_worst10 | 1.03 [0.91, 1.17] | +0.5 [-1.7, +2.7] | 1.01 [0.89, 1.16] | +0.1 [-1.0, +1.2] | 1.06 [0.93, 1.20] | +0.9 [-1.0, +3.1] |
| top50 | def_best10 | 0.79 [0.71, 0.89] | -4.3 [-6.2, -2.2] | 0.83 [0.72, 0.97] | -1.7 [-3.1, -0.4] | 0.79 [0.71, 0.88] | -3.9 [-5.8, -2.2] |
| top25 (thin) | def_worst10 | 0.97 [0.81, 1.17] | -0.6 [-4.3, +2.7] | 1.09 [0.90, 1.33] | +0.8 [-0.9, +2.6] | 1.06 [0.87, 1.29] | +0.9 [-2.1, +4.2] |
| top25 (thin) | def_best10 | 0.84 [0.71, 0.99] | -3.3 [-6.9, -0.1] | 0.90 [0.73, 1.11] | -1.0 [-3.2, +0.7] | 0.87 [0.73, 1.03] | -2.1 [-4.6, +0.5] |
| top10 (thin) | def_worst10 | 1.09 [0.79, 1.50] | +1.6 [-4.8, +7.1] | n/a (not fitted) | n/a | 1.30 [0.99, 1.72] | +3.7 [-0.4, +7.7] |
| top10 (thin) | def_best10 | 0.77 [0.58, 1.02] | -4.6 [-9.7, -0.4] | n/a (not fitted) | n/a | 0.84 [0.60, 1.16] | -2.4 [-6.3, +2.2] |

Quantile regression of dev (PTS vs prior avg), shift in PTS at the 75th and 90th percentile vs middle-10 defences (adjusted; 100 player-cluster bootstrap refits):

| segment | dev_q75 def_worst5 | dev_q75 def_best5 | dev_q90 def_worst5 | dev_q90 def_best5 |
|---|---|---|---|---|
| all | +0.36 [+0.18, +0.54] | -0.36 [-0.55, -0.17] | +0.32 [+0.00, +0.58] | -0.41 [-0.74, -0.15] |
| top100 | +0.42 [-0.10, +0.79] | -0.79 [-1.28, -0.45] | +0.20 [-0.38, +0.91] | -0.70 [-1.55, -0.00] |
| top50 | +0.61 [-0.14, +1.29] | -1.00 [-1.91, -0.31] | -0.40 [-1.20, +0.64] | -0.44 [-1.39, +0.54] |

The worst-5 shift at p75/p90 is positive for all players (p75 +0.36 [+0.18, +0.54]) and not distinguishable from 0 for stars (top 50 p75 +0.61 [-0.14, +1.29]; p90 -0.40 [-1.20, +0.64]); the best-5 shift at p75 is negative with CI below 0 for all/top100/top50. The p90 tail for stars is too noisy to say anything.


**Out-of-sample skill (non-thin cells; test = last ~20% of dates; log-loss gain with player-cluster bootstrap CI > 0).** Models: base rate (train rate), `logit_player` (player-level controls only), `logit_ctx` (+ defence/pace tiers, home, B2B, opp B2B), `gbm_player`/`gbm_ctx` (HistGradientBoosting, continuous opponent rank/pace, rest, home).

| outcome | model | cells | beats_base | ctx_beats_player | worse_than_player |
|---|---|---|---|---|---|
| big10 | gbm_ctx | 15 | 2.0 | 3.0 | 1.0 |
| big10 | gbm_player | 15 | 1.0 | 0.0 | 3.0 |
| big10 | logit_ctx | 16 | 1.0 | 3.0 | 1.0 |
| big10 | logit_player | 16 | 0.0 |  |  |
| big5 | gbm_ctx | 15 | 2.0 | 1.0 | 0.0 |
| big5 | gbm_player | 15 | 0.0 | 0.0 | 3.0 |
| big5 | logit_ctx | 17 | 3.0 | 3.0 | 0.0 |
| big5 | logit_player | 17 | 0.0 |  |  |
| x125 | gbm_ctx | 15 | 6.0 | 0.0 | 2.0 |
| x125 | gbm_player | 15 | 6.0 | 0.0 | 2.0 |
| x125 | logit_ctx | 17 | 6.0 | 5.0 | 0.0 |
| x125 | logit_player | 17 | 7.0 |  |  |

Default window pooled_2023_26, big10 and x1.25 (positive gain = better than reference):

| segment | outcome | model | train rate | test rate | Brier | log-loss | AUC | LL gain vs base | LL gain vs player-only | cal slope |
|---|---|---|---|---|---|---|---|---|---|---|
| all | big10 | base_rate | 7.1 | 6.7 | 0.0629 | 0.2470 | 0.500 |  |  | n/a |
| all | big10 | logit_player | 7.1 | 6.7 | 0.0629 | 0.2463 | 0.558 | +0.0006 [-0.0009, +0.0024] |  | 0.58 |
| all | big10 | logit_ctx | 7.1 | 6.7 | 0.0627 | 0.2454 | 0.571 | +0.0016 [-0.0001, +0.0035] | +0.0010 [+0.0004, +0.0016] | 0.66 |
| all | big10 | gbm_ctx | 7.1 | 6.7 | 0.0627 | 0.2450 | 0.576 | +0.0020 [+0.0003, +0.0038] | +0.0013 [+0.0003, +0.0023] | 0.74 |
| all | x125 | base_rate | 32.7 | 32.7 | 0.2202 | 0.6322 | 0.500 |  |  | n/a |
| all | x125 | logit_player | 32.7 | 32.7 | 0.2142 | 0.6177 | 0.597 | +0.0145 [+0.0110, +0.0184] |  | 1.15 |
| all | x125 | logit_ctx | 32.7 | 32.7 | 0.2131 | 0.6153 | 0.607 | +0.0169 [+0.0133, +0.0210] | +0.0024 [+0.0017, +0.0032] | 1.18 |
| all | x125 | gbm_ctx | 32.7 | 32.7 | 0.2135 | 0.6166 | 0.605 | +0.0156 [+0.0122, +0.0192] | +0.0011 [-0.0006, +0.0026] | 1.21 |
| top100 | big10 | base_rate | 10.5 | 7.6 | 0.0712 | 0.2740 | 0.500 |  |  | n/a |
| top100 | big10 | logit_player | 10.5 | 7.6 | 0.0711 | 0.2731 | 0.539 | +0.0010 [-0.0015, +0.0033] |  | 0.62 |
| top100 | big10 | logit_ctx | 10.5 | 7.6 | 0.0709 | 0.2717 | 0.566 | +0.0023 [-0.0006, +0.0053] | +0.0014 [-0.0003, +0.0032] | 0.79 |
| top100 | big10 | gbm_ctx | 10.5 | 7.6 | 0.0713 | 0.2746 | 0.513 | -0.0006 [-0.0016, +0.0004] | -0.0016 [-0.0039, +0.0007] | 0.16 |
| top100 | x125 | base_rate | 26.1 | 20.8 | 0.1675 | 0.5188 | 0.500 |  |  | n/a |
| top100 | x125 | logit_player | 26.1 | 20.8 | 0.1656 | 0.5115 | 0.592 | +0.0073 [-0.0031, +0.0171] |  | 0.76 |
| top100 | x125 | logit_ctx | 26.1 | 20.8 | 0.1650 | 0.5097 | 0.597 | +0.0091 [-0.0013, +0.0189] | +0.0018 [+0.0001, +0.0036] | 0.78 |
| top100 | x125 | gbm_ctx | 26.1 | 20.8 | 0.1671 | 0.5157 | 0.583 | +0.0031 [-0.0067, +0.0127] | -0.0042 [-0.0087, -0.0002] | 0.67 |
| top50 | big10 | base_rate | 11.3 | 8.1 | 0.0751 | 0.2859 | 0.500 |  |  | n/a |
| top50 | big10 | logit_player | 11.3 | 8.1 | 0.0760 | 0.2995 | 0.533 | -0.0136 [-0.0337, +0.0009] |  | -0.00 |
| top50 | big10 | logit_ctx | 11.3 | 8.1 | 0.0761 | 0.2989 | 0.549 | -0.0130 [-0.0340, +0.0013] | +0.0006 [-0.0022, +0.0034] | 0.03 |
| top50 | big10 | gbm_ctx | 11.3 | 8.1 | 0.0775 | 0.2928 | 0.531 | -0.0069 [-0.0138, -0.0012] | +0.0067 [-0.0051, +0.0232] | 0.25 |
| top50 | x125 | base_rate | 23.5 | 18.1 | 0.1514 | 0.4821 | 0.500 |  |  | n/a |
| top50 | x125 | logit_player | 23.5 | 18.1 | 0.1515 | 0.4951 | 0.590 | -0.0130 [-0.0453, +0.0103] |  | 0.21 |
| top50 | x125 | logit_ctx | 23.5 | 18.1 | 0.1509 | 0.4930 | 0.597 | -0.0109 [-0.0428, +0.0114] | +0.0021 [-0.0010, +0.0051] | 0.25 |
| top50 | x125 | gbm_ctx | 23.5 | 18.1 | 0.1564 | 0.4904 | 0.589 | -0.0083 [-0.0264, +0.0077] | +0.0047 [-0.0071, +0.0217] | 0.47 |

**Reading.** (a) Big-night skill is **small**: AUC 0.55-0.61; against the train base rate, `logit_ctx` has a log-loss gain with CI above 0 in 1 of 16 big10, 3 of 17 big5 and 6 of 17 x1.25 cells (largest: x1.25 all players, about +0.017), and most of that comes from the player-level controls. (b) Adding defence/pace/rest/home context to the player-level logistic helps a little (x1.25 all players +0.0024 [+0.0017, +0.0032] log-loss; significantly better in 5 of 17 x1.25 cells, 3 of 16 big10, 3 of 17 big5) and does not help the star segments (CIs include 0). (c) **Gradient boosting never beats the additive logistic** (0 of 15 cells for each outcome, and significantly worse in 2-4), so there is no evidence that a flexible model finds a star x poor-defence interaction the logistic misses. (d) Calibration: in the star segments the **test-period big-night rate is lower than in training** (top 50 big10: 11.3% train, 8.1% test), so every model, including the base rate, is over-predicted in the test window (calibration slope 0-0.5, intercept about -1 to -2.4). That is a date-shift of the baseline definition (late-season prior averages are more stable; early-season ones noisier), not a failure specific to the context terms; the log-loss gains versus the player-only model are the cleaner comparison. Calibration deciles are in `tail_calibration`.

## 7. Dispersion (SD of PTS - prior average)

Ratio of SDs with a 500-resample player-cluster bootstrap CI (naive Levene/Brown-Forsythe p, which ignores clustering, is in `dispersion_effects.levene_p_naive`).

| segment | worst5 | worst10 | best10 | home | b2b_2nd |
|---|---|---|---|---|---|
| all | 1.027 [1.004, 1.050] | 1.016 [0.999, 1.033] | 0.991 [0.975, 1.006] | 0.996 [0.982, 1.012] | 1.025 [1.007, 1.043] |
| top100 | 1.041 [1.002, 1.086] | 1.036 [1.005, 1.069] | 1.007 [0.982, 1.034] | 0.979 [0.952, 1.004] | 1.027 [0.996, 1.061] |
| top50 | 1.047 [0.994, 1.103] | 1.050 [1.007, 1.088] | 1.005 [0.968, 1.045] | 0.951 [0.918, 0.990] | 1.044 [0.998, 1.096] |
| top25 (thin) | 1.097 [1.026, 1.166] | 1.099 [1.040, 1.154] | 1.022 [0.969, 1.078] | 0.932 [0.883, 0.982] | 1.077 [1.014, 1.140] |
| top10 (thin) | 1.148 [1.024, 1.242] | 1.176 [1.094, 1.242] | 0.958 [0.906, 1.021] | 0.953 [0.888, 1.023] | 1.145 [1.071, 1.236] |

Ratios are vs the middle 10 defences (worst5/worst10/best10), vs away (home), vs rested (b2b_2nd). Stars have more spread against poor defences (top 25: 1.10 [1.04, 1.16]; top 10: 1.18 [1.10, 1.24]; top 50: 1.05 [1.007, 1.09]); for all players the ratio is 1.016 [0.999, 1.033]. Stars are less dispersed at home (top 50: 0.95 [0.92, 0.99]). Counts over non-thin cells (CI above 1 / below 1; chance about 2.5% per side): b2b_1st 0/0 of 15; b2b_2nd 3/0 of 15; best10 0/0 of 16; best5 0/0 of 15; home 0/4 of 16; worst10 6/0 of 16; worst10_vs_best10 5/1 of 16; worst5 6/0 of 15. More upside variance vs weak defences is consistent with the larger unadjusted star mean shift; it is not the same as a higher probability of a +10 night after controls (section 6).

## 8. Interactions and partial pooling

Segment x condition and moderator x condition on the 'all players' population per timespan (train-only PPG-rank groups: 1-10, 11-25, 26-50, 51-100, rest). Model per condition (bottom-10 defence, bottom-5, top-10, home, B2B 2nd night): `outcome ~ condition x group + other conditions + prior-avg z + season progress` (OLS for dev, linear-probability and logit for big-night outcomes), player-clustered SEs; effect shown per level = condition + interaction; `interaction_p` = Wald test of the whole interaction block. Groups with < 30 players are flagged thin.

| moderator | level | bottom-10 defence effect on dev (PTS) | interaction p | players | thin |
|---|---|---|---|---|---|
| ppg_rank_group | rest | +0.26 [+0.14, +0.39] | 0.0148 | 584 | False |
| ppg_rank_group | 51_100 | +0.42 [+0.11, +0.73] | 0.0148 | 50 | False |
| ppg_rank_group | 26_50 | +1.11 [+0.64, +1.57] | 0.0148 | 25 | True |
| ppg_rank_group | 11_25 | +0.23 [-0.27, +0.74] | 0.0148 | 15 | True |
| ppg_rank_group | 1_10 | +0.23 [-0.69, +1.16] | 0.0148 | 10 | True |
| position | C | +0.88 [+0.59, +1.17] | 0.0003 | 89 | False |
| position | F | +0.30 [+0.14, +0.46] | 0.0003 | 266 | False |
| position | G | +0.22 [+0.07, +0.37] | 0.0003 | 330 | False |
| usage_tier | u1_low | +0.24 [+0.10, +0.37] | 0.1852 | 555 | False |
| usage_tier | u2_mid | +0.40 [+0.21, +0.59] | 0.1852 | 402 | False |
| usage_tier | u3_high | +0.65 [+0.21, +1.08] | 0.1852 | 158 | False |
| usage_tier | u4_very_high | +0.44 [-0.04, +0.93] | 0.1852 | 76 | False |
| minutes_tier | m1_lt20 | +0.12 [-0.03, +0.27] | 0.0016 | 516 | False |
| minutes_tier | m2_20_28 | +0.31 [+0.11, +0.51] | 0.0016 | 410 | False |
| minutes_tier | m3_28_34 | +0.58 [+0.36, +0.79] | 0.0016 | 237 | False |
| minutes_tier | m4_ge34 | +0.59 [+0.22, +0.96] | 0.0016 | 109 | False |
| role | bench | +0.22 [+0.09, +0.35] | 0.0103 | 585 | False |
| role | starter | +0.48 [+0.31, +0.64] | 0.0103 | 365 | False |

Same for P(PTS >= 1.25 x prior avg), odds ratio of bottom-10 defences (logit):

| moderator | level | OR | interaction p | players | thin |
|---|---|---|---|---|---|
| ppg_rank_group | rest | 1.08 [1.03, 1.13] | 0.3171 | 584 | False |
| ppg_rank_group | 51_100 | 1.06 [0.97, 1.16] | 0.3171 | 50 | False |
| ppg_rank_group | 26_50 | 1.19 [1.02, 1.40] | 0.3171 | 25 | True |
| ppg_rank_group | 11_25 | 0.98 [0.77, 1.24] | 0.3171 | 15 | True |
| ppg_rank_group | 1_10 | 1.33 [1.02, 1.73] | 0.3171 | 10 | True |
| position | C | 1.35 [1.22, 1.49] | 0.0000 | 89 | False |
| position | F | 1.09 [1.02, 1.15] | 0.0000 | 266 | False |
| position | G | 1.02 [0.97, 1.07] | 0.0000 | 330 | False |
| role | bench | 1.06 [1.01, 1.11] | 0.1025 | 585 | False |
| role | starter | 1.12 [1.06, 1.18] | 0.1025 | 365 | False |

**Reading.** (1) The bottom-10-defence effect on dev **varies with segment** (interaction p = 0.015) but not monotonically: +0.26 for the rest, +0.42 (51-100), **+1.11 (26-50)**, +0.23 (11-25, thin), +0.24 (1-10, thin): the very top scorers do not show the largest effect, so there is no clean "bigger star, bigger pop". (2) **Position and role matter more:** centers +0.88 PTS vs guards +0.22 (p = 0.0003), starters +0.48 vs bench +0.22 (p = 0.010); minutes: +0.12 (<20) rising to +0.59 (34+) (p = 0.002); usage tier: no detectable difference (p = 0.19). In odds ratios for x1.25, centers 1.35 [1.23, 1.49] vs guards 1.02 [0.97, 1.07]. (3) Counts of interaction tests with p < 0.05 vs expected by chance are in `interaction_effects` (e.g. for dev: minutes 14 of 30, position 11 of 30, role 12 of 30, segment 16 of 30, usage 4 of 30, vs 1.5 expected; these tests are on overlapping windows and are not independent). Usage is the one moderator with no signal. (4) These are associations adjusted for the listed controls, not causes.

**Random slopes (partial pooling).** MixedLM with a random intercept and a random slope on bottom-10 defence per player (bfgs/powell; `lbfgs` is unreliable here): all fits report convergence but 11 of 18 (all 6 big10 fits and 5 of 6 dev fits) have a slope-intercept correlation of about +/-1 or a fixed effect that departs from the OLS estimate, i.e. are unstable; the 6 x1.25 fits are stable ("stable" flag in `interaction_effects`, model `mixedlm_random_slope`). Fixed effects agree with the OLS player-clustered estimate (dev, all players: MixedLM +0.32 [+0.21, +0.44] vs OLS +0.33 [+0.22, +0.44]; top 50 +0.54 [+0.10, +0.97] vs +0.55 [+0.18, +0.92]). Because the random-slope variance is not reliably identified, **the empirical-Bayes shrinkage in section 9 is the primary partial-pooling result** (DerSimonian-Laird tau, normal-normal shrinkage, with the pooled-mean uncertainty included in the intervals).

## 9. Per-player depth (shrunk effects, FDR and watch flags)

One row per player x condition x outcome in `player_deep_splits` (conditions: bottom-5 defences vs the rest, bottom-10 vs the rest, home vs away, B2B 2nd night vs rested; outcomes: dev, big5, big10, x1.25). Raw difference with a t-free normal CI (dev: SE from the player's SD of dev over all his eligible games; probabilities: Agresti-Caffo SE), DerSimonian-Laird tau^2 across qualifying players, normal-normal shrunk estimate and interval (including the pooled-mean uncertainty), z, p, **Benjamini-Hochberg q** (strong: q < 0.10), **watch** (|z| >= 2.5, not strong). **Expected-by-chance counts sit beside every flag count**: watch ~ k x 2 x P(|Z| >= 2.5) = 1.24% of players; p < 0.05 ~ 5%. Floors: bottom-5 >= 5 vs >= 10 games, bottom-10 >= 8 vs >= 10, home/away >= 8 each, B2B >= 5 vs >= 10 (provisional 2026-27: 2-3 vs 3-5). `credible_above_league` = the player's shrunk interval (player evidence only) lies above the pooled mean = this player differs from the typical player.

pooled_2023_26 (other timespans in the table):

| condition | outcome | players | league mean [CI] | tau | strong q<.10 | watch |z|>=2.5 | expected watch by chance | p<0.05 | expected p<0.05 | above league | below league |
|---|---|---|---|---|---|---|---|---|---|---|---|
| b2b_2nd_vs_rested | big10 | 532 | +0.008 [+0.002, +0.014] | 0.000 | 0 | 4 | 6.6 | 12 | 26.6 | 0 | 0 |
| b2b_2nd_vs_rested | big5 | 532 | +0.017 [+0.008, +0.026] | 0.045 | 6 | 6 | 6.6 | 38 | 26.6 | 0 | 5 |
| b2b_2nd_vs_rested | dev | 532 | +0.305 [+0.177, +0.433] | 0.543 | 0 | 10 | 6.6 | 37 | 26.6 | 0 | 0 |
| b2b_2nd_vs_rested | x125 | 532 | +0.022 [+0.011, +0.033] | 0.067 | 6 | 9 | 6.6 | 44 | 26.6 | 1 | 2 |
| home_vs_away | big10 | 549 | +0.002 [-0.002, +0.006] | 0.000 | 0 | 6 | 6.8 | 21 | 27.5 | 0 | 0 |
| home_vs_away | big5 | 549 | +0.005 [-0.001, +0.012] | 0.023 | 0 | 7 | 6.8 | 37 | 27.5 | 0 | 0 |
| home_vs_away | dev | 549 | +0.100 [+0.006, +0.194] | 0.376 | 0 | 3 | 6.8 | 35 | 27.5 | 0 | 0 |
| home_vs_away | x125 | 549 | +0.003 [-0.005, +0.010] | 0.030 | 0 | 7 | 6.8 | 32 | 27.5 | 0 | 0 |
| worst10 | big10 | 530 | +0.012 [+0.008, +0.017] | 0.000 | 0 | 1 | 6.6 | 13 | 26.5 | 0 | 0 |
| worst10 | big5 | 530 | +0.025 [+0.018, +0.031] | 0.021 | 1 | 4 | 6.6 | 34 | 26.5 | 0 | 0 |
| worst10 | dev | 530 | +0.493 [+0.397, +0.590] | 0.278 | 0 | 7 | 6.6 | 23 | 26.5 | 0 | 0 |
| worst10 | x125 | 530 | +0.030 [+0.022, +0.038] | 0.034 | 3 | 4 | 6.6 | 36 | 26.5 | 0 | 0 |
| worst5 | big10 | 520 | +0.015 [+0.010, +0.021] | 0.000 | 0 | 6 | 6.5 | 19 | 26.0 | 0 | 0 |
| worst5 | big5 | 520 | +0.028 [+0.018, +0.037] | 0.048 | 4 | 13 | 6.5 | 46 | 26.0 | 0 | 2 |
| worst5 | dev | 520 | +0.623 [+0.491, +0.756] | 0.652 | 0 | 10 | 6.5 | 40 | 26.0 | 0 | 0 |
| worst5 | x125 | 520 | +0.038 [+0.028, +0.049] | 0.057 | 4 | 13 | 6.5 | 44 | 26.0 | 1 | 0 |

**Top-50 scorers carrying a flag in the default window** (strong first). Compare with ~0.6 watch flags expected by chance per condition-outcome among 50 players:

| player | condition | outcome | n | raw | shrunk | z | q | flag |
|---|---|---|---|---|---|---|---|---|
| Victor Wembanyama | b2b_2nd_vs_rested | big10 | 24/112 | -0.170 | +0.008 | -3.42 | 0.249 | lower_watch |
| Jalen Green | b2b_2nd_vs_rested | x125 | 37/106 | -0.191 | -0.061 | -2.51 | 0.394 | lower_watch |
| Zion Williamson | b2b_2nd_vs_rested | x125 | 19/101 | -0.195 | -0.072 | -2.82 | 0.288 | lower_watch |
| Devin Booker | home_vs_away | big10 | 93/98 | -0.141 | +0.002 | -3.14 | 0.470 | lower_watch |
| Jamal Murray | home_vs_away | x125 | 93/93 | -0.161 | -0.026 | -2.51 | 0.748 | lower_watch |
| Devin Booker | home_vs_away | x125 | 93/98 | -0.187 | -0.036 | -3.19 | 0.748 | lower_watch |
| Shai Gilgeous-Alexander | worst10 | big5 | 61/143 | -0.135 | +0.006 | -2.77 | 0.727 | lower_watch |
| Victor Wembanyama | b2b_2nd_vs_rested | big5 | 24/112 | -0.298 | -0.076 | -4.59 | 0.001 | lower_strong |
| Joel Embiid | b2b_2nd_vs_rested | x125 | 8/61 | -0.377 | -0.083 | -3.54 | 0.043 | lower_strong |
| Victor Wembanyama | b2b_2nd_vs_rested | x125 | 24/112 | -0.271 | -0.123 | -4.31 | 0.004 | lower_strong |
| Lauri Markkanen | home_vs_away | big10 | 61/68 | +0.115 | +0.002 | +2.55 | 0.960 | higher_watch |
| Karl-Anthony Towns | worst10 | dev | 66/129 | +4.029 | +0.657 | +2.80 | 0.675 | higher_watch |
| Karl-Anthony Towns | worst10 | x125 | 66/129 | +0.239 | +0.073 | +3.15 | 0.220 | higher_watch |
| Joel Embiid | worst5 | big10 | 14/71 | +0.373 | +0.015 | +2.72 | 0.912 | higher_watch |
| Jalen Green | worst5 | big10 | 33/148 | +0.235 | +0.015 | +2.55 | 0.912 | higher_watch |
| Jalen Green | worst5 | big5 | 33/148 | +0.285 | +0.083 | +2.81 | 0.283 | higher_watch |
| Jalen Green | worst5 | dev | 33/148 | +5.451 | +1.191 | +2.71 | 0.443 | higher_watch |
| Karl-Anthony Towns | worst5 | x125 | 34/161 | +0.303 | +0.116 | +3.00 | 0.179 | higher_watch |
| Jalen Green | worst5 | x125 | 33/148 | +0.309 | +0.115 | +2.98 | 0.179 | higher_watch |
| Karl-Anthony Towns | worst10 | big5 | 66/129 | +0.284 | +0.047 | +3.81 | 0.074 | higher_strong |
| Karl-Anthony Towns | worst5 | big5 | 34/161 | +0.337 | +0.097 | +3.48 | 0.065 | higher_strong |

Largest raw bottom-10-defence dev differences among the top 25 (shrunk values collapse to the pooled mean, as the shrunk-interval overlap shows):

| player | games vs bottom-10 / other | raw diff (PTS) | shrunk | z | q |
|---|---|---|---|---|---|
| Joel Embiid | 33/52 | +4.36 | +0.57 [+0.02, +1.12] | +1.99 | 0.79 |
| Lauri Markkanen | 34/95 | +2.08 | +0.55 [+0.01, +1.10] | +1.13 | 0.90 |
| Devin Booker | 60/131 | +2.08 | +0.55 [+0.01, +1.09] | +1.10 | 0.90 |
| Giannis Antetokounmpo | 65/97 | +2.00 | +0.56 [+0.01, +1.10] | +1.13 | 0.90 |
| Anthony Davis | 36/96 | +1.68 | +0.52 [-0.03, +1.07] | +0.64 | 0.92 |

**Star answer.** For big-night probability (big10) the between-player SD is estimated as 0 for bottom-5, bottom-10, home/away and B2B in every pooled window, so every player's shrunk effect is the pooled mean (+1.2 pp for bottom-10, +1.5 pp for bottom-5, with a league CI above 0): **no top-25 or top-50 player has a player-specific credible big-night uplift versus bottom-5/10 defences; the shared effect applies to everyone**. For the PTS mean (dev) tau is 0.28 (bottom-10) and 0.65 (bottom-5), but no top-50 player's shrunk interval clears the league mean either (0 above-league). Watch counts for the star-relevant big10 outcome (1 of 530 for bottom-10, 6 of 520 for bottom-5 vs 6.6 and 6.5 expected) are at or below chance; the strong flags are Karl-Anthony Towns (big5, higher vs bottom-5/10; q = 0.065-0.074), and B2B-lower flags for Victor Wembanyama (big5, x1.25) and Joel Embiid (x1.25, 8 games), consistent with a handful of flags among ~500 players x 16 tests. Across the 16 condition-outcome tests x 50 stars (800 player-tests) there are 20 flags in the table above (5 strong, 15 watch) against about 10 watch-level flags expected by chance (1.24% of 800); outcomes of the same player are correlated, so these are not 800 independent tests. The flags that point to higher scoring against poor defences are Karl-Anthony Towns (big5 strong; x1.25 and dev watch), Jalen Green (watch on four outcomes vs bottom-5) and Joel Embiid (watch, 14 games); all have shrunk effects close to the pooled mean.

## 10. Home/away and back-to-back under the tail/tier lens

pooled_2023_26; dev in PTS, x1.25 in pp:

| segment | home vs away dev | home vs away x125 | B2B 2nd vs rested dev | B2B 2nd vs rested x125 | B2B 1st vs rested dev | B2B 1st vs rested x125 |
|---|---|---|---|---|---|---|
| all | +0.16 [+0.05, +0.26] | +0.8 [+0.1, +1.6] | +0.31 [+0.17, +0.45] | +2.8 [+1.7, +3.8] | +0.07 [-0.06, +0.19] | +0.7 [-0.2, +1.6] |
| top100 | +0.07 [-0.20, +0.33] | -0.6 [-2.0, +0.7] | -0.12 [-0.43, +0.19] | -0.8 [-2.6, +1.0] | -0.01 [-0.34, +0.33] | -0.2 [-2.1, +1.7] |
| top50 | -0.14 [-0.55, +0.27] | -1.6 [-3.5, +0.4] | -0.03 [-0.48, +0.42] | -1.4 [-3.7, +0.9] | +0.16 [-0.35, +0.67] | -0.0 [-2.6, +2.6] |
| top25 | -0.26 [-0.82, +0.30] | -1.2 [-3.8, +1.4] | +0.12 [-0.47, +0.72] | -0.2 [-3.3, +2.9] | +0.21 [-0.39, +0.81] | -0.7 [-3.8, +2.4] |
| top10 | -0.38 [-1.22, +0.46] | -0.8 [-4.2, +2.6] | +0.38 [-0.46, +1.21] | +1.0 [-3.7, +5.7] | +0.03 [-0.85, +0.91] | -0.5 [-4.4, +3.5] |

**Do the earlier conclusions still hold? Yes.** (Row sets differ slightly from the earlier analysis: eligible pregame rows with >= 5 minutes vs all games with minutes, and dev vs prior average rather than raw PPG.)

- **Back-to-back second night:** earlier: +0.28 PTS for all players, driven by minutes (+0.70 min), nothing for stars. Now: +0.31 PTS vs prior average for all players [+0.17, +0.46], big10 +0.9 pp, x1.25 +2.8 pp; top 100/50/25: dev -0.12, -0.03, +0.12 (all CIs include 0), x1.25 -0.8, -1.4, -0.2 pp (CIs include 0). **No hidden star effect in the tails.** Dispersion: B2B second-night SD ratio 1.025 [1.007, 1.043] for all players; top 10 1.14 (thin).
- **First night of a back-to-back:** null on every outcome, as before.
- **Home/away:** earlier: +0.09 PTS, tiny and not significant for stars. Now: +0.16 PTS [+0.05, +0.26] for all players (similar magnitude), stars -0.14 (top 50) with CI including 0; the big-night rates are lower at home for top 25 (-2.2 pp [-4.1, -0.2], nominal; one of many cells, so not a finding) and the SD of dev is lower at home for top 25/50 (0.93/0.95; CI excludes 1). New small observation: stars' results are a bit *less* dispersed at home.
- **Rest days:** 3+ days of rest is associated with a lower excess over the prior average for all players (-0.33 PTS vs one day rest); nothing for stars.
- Per player: no star clears the shared effect for home/away; B2B flags are the Wembanyama / Embiid entries above.

## 11. App insights that change, and how

No app-read JSON was regenerated (schemas untouched); a new, not-yet-read `data/deep_analyses_summary.json` carries the headline numbers per timespan x segment for App Builder.

| existing insight | status | change |
|---|---|---|
| Home/away league + per-player splits (`insights_home_away_b2b.json`, `insights_player_splits.json`) | **conclusions hold** | optional copy addition: "same picture for big nights: stars' big-night rates are not higher at home; their results are slightly less spread out at home (SD ratio 0.93-0.95 for top 25/50)". No number in the current visuals needs to change |
| Back-to-back (second night) | **holds** | optional addition: big-night rates (+2.8 pp x1.25 for all players, null for top 50) confirm it is a role-player/minutes effect, not a star effect. Add "3+ days rest: slightly lower than usual (-0.3 PTS)" if desired |
| Per-player B2B / home-away flags | **holds, new depth available** | `player_deep_splits` adds big-night probability and shrunk intervals; per-player flags should show the expected-by-chance counts (`player_deep_summary`) next to the flag count |
| Points drivers (linear standardised effects, `src/generated/points_drivers.json`) | **needs a caveat** | the drivers are per +1 SD linear mean effects; add: "effects of opponent defence and pace are not linear for the top scorers: a small bump over the few worst defences, about nothing through the middle, a clear drop against the best 10 (and similarly for pace)". The app model has no opponent features (matchups were parked); the lift from them is small (MATCHUPS.md) |
| Matchup/opponent insight (parked, `app/matchups-paused`) | **update before shipping** | replace "league-average +0.6 PTS vs weak defences, individual deviations mostly noise" by the tiered version: worst-5 defences +0.63 PTS (all) / +1.21 PTS (top 50) vs the other 25 defences; best-10 defences -0.57 (all) / -0.90 (top 50) vs the other 20; relative big-night rate about 1.2x vs bottom-5 for both groups; **not stable season to season for stars (2023-24 strong, 2024-25 and 2025-26 near 0)**; no player-specific big-night effect |
| New candidate insights | | (1) "Opponent tier" card (best 5 / 6-10 / middle / worst 6-10 / worst 5 from `tier_effects`); (2) "Big-night odds" panel (P(+10) and P(x1.25) by defence and pace tier); (3) role/position note (centers and starters gain more against poor defences). Do not present any star-specific "big night vs poor teams" claim |

## 12. Thin cells, gaps, caveats

- Thin (< 30 players or < 300 games): top25 and top10 in every timespan, top50 in the single seasons for the rarer outcomes; flagged in every table (`thin_flag`, `thin_level`); contrasts with < 30 games on a side are null (`suppressed_n_lt_30`). 2026-27 (about 1.4k rows) is provisional.
- Overlapping windows (pooled and single seasons, nested segments) are not independent: counts of significant cells are descriptive, shown with expected-by-chance but not corrected.
- The test split is by date (last ~20% of dates per timespan); for star segments the late-season big-night base rate is lower than in training, which spoils calibration of every model including the base rate; compare models with each other, not with absolute calibration.
- Logistic specs: `ctx_full` needs >= 120 events and >= 800 games, `ctx_nested` >= 60 events; otherwise not fitted (null) and the reason is in the manifest cell logs. Quantile models need >= 800 games and >= 15 players. GBM needs >= 1,500 train rows and >= 80 events.
- Baseline artefact: dev is relative to the prior season-to-date mean, early-season baselines are noisy and rows need >= 5 minutes today; level effects of usage/minutes tiers on dev are baseline artefacts, contrasts across conditions are not.
- Role is the prior-start share (>= 50%), not tonight's lineup (not known pregame).
- The Wald nonlinearity p-values and interaction p-values are not BH-adjusted (counts vs expected are given instead).
- Associations, not causes. Matchup endpoints (defender assignments) remain unused (see MATCHUPS.md section 3).

Files: marts `data/marts/{tier_effects,spline_effects,tail_models,tail_performance,tail_calibration,dispersion_effects,interaction_effects,player_deep_splits,player_deep_summary}.parquet` (+ DuckDB views of the same names in `nba_phase1.duckdb`), `data/manifests/deep_analyses.json` (copied as `data/marts/deep_analyses_manifest.json`), `data/deep_analyses_summary.json`.
