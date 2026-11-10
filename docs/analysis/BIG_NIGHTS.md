# BIG_NIGHTS: why do players score well above their average? (hoopstats)

Data through **2026-11-09**; 65,518 eligible player-games (42,024 with a prior average of 8+ PPG) from 2023-24 to 2026-27 to date (**2026-27 and any pooled span that includes it are provisional**). Scripts: `scripts/python/big_nights_data.py` (dataset), `big_nights_analysis.py` (cells: counts, lifts, logistic, boosting), `big_nights_players.py` (stars vs non-stars, per-player), `big_nights_assemble.py` (marts, views, manifest), `big_nights_summary.py` + `big_nights_report.py` (JSON and this file). Marts in `data/marts/big_night_*`, DuckDB views of the same names in `data/marts/nba_phase1.duckdb`, App Builder summary `data/big_nights_summary.json` (not wired into the app).

Language: *associated with / predicts*, never causes. **Lens A (pregame)** factors are knowable at about tip-off. **Lens B (same game)** factors describe how the night happened; they are close to an accounting identity with the points total and are **not predictive**; they are labelled that way everywhere.

## 1. Headline

**The pregame factors are weak. One thing stands out, the usage vacuum; almost everything else is small, partly an artefact of the baseline, or not distinguishable from nothing.**

1. **How common.** Against the player's prior season-to-date average (8+ PPG floor), 15.9% of player-games reach 1.5x (6,529 of 41,123), 28.9% reach 1.25x, 4.3% reach 2.0x (1,757), 22.5% reach +5, 8.1% reach +10 (3,313) and 9.4% reach z>=1.5 (pooled 2023-24 to 2025-26, all players). Top-50 scorers: 1.5x 8.5%, +10 10.7%.
2. **Strongest pregame factor: regular teammates out (the usage vacuum).** When regular teammates who average 20+ PPG together are missing, 22.2% of games reach 1.5x vs 11.4% when no regular is out (RR 1.96 [1.82, 2.10], +10.9 [+9.7, +12.0] pp) and 11.3% reach +10 vs 5.5% (RR 2.04 [1.85, 2.24]). Holding prior average, volatility, usage, minutes, role, position and all other pregame factors fixed, the 1.5x effect is OR 1.65 [1.52, 1.79], +6.6 pp [+5.5, +7.7] and the +10 effect is OR 1.77 [1.59, 1.97], +4.4 pp [+3.6, +5.1]. It is the top-ranked adjusted factor in every main cut and has the same sign in each of the three complete seasons.
3. **Second tier (small, +1 to +3 pp):** recent minutes up or a recent promotion to the starting five, the team's top scorer being out, a very recent hot game, early season (Oct-Nov), fast-pace opponents, bottom-10 defences. **Against the last-10 baseline the hot-game, minutes-up and promotion effects vanish** (RR near 1.0): they mostly show that the season-to-date average lags a player whose role is changing, not that heat carries over. Elite defences (best 10) cost about 1.4 pp; slow-pace opponents about 0.5 to 0.8 pp (the interval touches zero).
4. **No credible effect once the other factors are held fixed:** home vs away, rest days and back-to-back nights (raw second-night lift of +1.4 pp for 1.5x disappears: adjusted +0.4 pp [-0.6, +1.4]), the opponent's own last-game or last-5 defensive form, the opponent missing regulars, NBA Cup games, late season (raw +3.4 pp, adjusted about 0). **No bounce-back:** after a weak last game (below 0.75x) big nights are *less* likely in the raw data, not more (1.5x: RR 0.86 [0.82, 0.91]), and the adjusted odds ratio is 0.94 [0.87, 1.01] (no credible change); after two weak games in a row the adjusted +10 odds are lower (OR 0.77 [0.64, 0.92], -1.8 pp).
5. **Models.** On the date-split test the pregame logistic model adds 0.042 AUC over a controls-only model for 1.5x (0.699 vs 0.657) and 0.118 for +10 (0.655 vs 0.537): **a pregame big-night is hard to predict; AUC 0.62 to 0.70, far from a usable forecast**. Boosting clearly beats the logistic in only 2 of 173 fitted cells (x200 all pooled_2023_26, x200 all pooled_2023_27), with a gain of about 0.01 AUC; elsewhere linear is enough. The same-game model reaches AUC 0.99 and means nothing as a prediction: it is the points identity.
6. **Same game (how it happens, not predictive).** A typical 1.5x night has about 5.2 extra minutes, 4.8 extra FGA and 14.7 percentage points of extra TS% against the player's prior norms. Of the log excess, minutes carry about 28%, shots per minute about 36% and efficiency about 35% for all players; for the top 50 the split is about 18% / 44% / 38%: stars' big nights are shot volume per minute and shooting, not extra minutes. Overtime, close games and high-scoring games go with more big nights; blowout losses go with far fewer. An opposing starter with 5+ fouls goes with a modest increase.
7. **Stars vs non-stars.** Different baselines, similar mechanisms: top-50 players hit 1.5x 8.5% of the time vs 17.7% for everyone else (a high average is hard to double) but +10 10.7% vs 7.4%. The ratio effects of defence tier and the vacuum (at 1.5x) are about the same for both groups; at +10 the vacuum ratio is smaller for stars (RR 1.70 vs 2.30) although the percentage-point effect is the same (+6 pp). They differ in recent-form factors: non-stars show a hot-game lift and a weak-game drop that stars do not, and stars show a small home *deficit* and a larger slow-pace penalty in big nights (see section 7).
8. **Players.** After shrinkage, a few players have more big nights than their average, volatility and minutes imply, and there is more heterogeneity than chance in the 1.5x cut (20 players at |z|>=2.5 vs 3.8 expected), but **no top-25 star is credibly above the league and only 1 of the top 50 is**; for rest, home, defence tier, bounce-back and hot-game splits no player is credibly different from the league average, and only the teammates-out response shows real player heterogeneity (5 role players credibly more responsive, 4 credibly less). Details and expected-by-chance counts in section 8.

## 2. Method

**Eligible rows.** Regular season (game_id prefix 002; Cup group and knockout games count, the Cup final is excluded), >= 5 minutes played, >= 5 prior games this season and >= 5 overall, and an opponent with >= 5 prior games (cold start). That is the deep-analysis dataset with a stricter within-season minimum (5 instead of 3 prior games) so the prior SD is defined. The 5-minute rule uses same-game minutes (a convention carried from the earlier studies; players who barely play are not in the denominator).

**Baselines and events (12 cuts).** *std* = prior season-to-date mean PTS (primary); *l10* = mean of the last <= 10 prior games (chronological, so early in a season it can include the end of the previous one). Events: PTS >= 1.25x, 1.5x, 2.0x the baseline; PTS >= baseline + 5 and + 10; z >= 1.5 where z = (PTS - baseline) / prior SD (SD over the same prior window; std needs >= 5 prior games this season, l10 needs a full 10; SD must exceed 0.5, otherwise z is null). **Floor** on the prior average: 8 PPG (default); counts and lifts are also carried for no floor (average > 0), 5 and 12 (`floor` column in every mart).

**Segments and timespans.** all, top 100 / 50 / 25 / 10 by PPG (membership from train-period PPG ranks, as in the deep analyses) x the app's 6 timespans. **Thin rule:** a cell or level with < 30 players or < 300 player-games is thin: shown, never ranked. Top 25 and top 10 are therefore always thin (25 and 10 players) and are descriptive only. Extra rules for rare events: no lifts when a cell has < 30 events, no logistic below 60 events, AUC scored only with >= 30 train and >= 15 test events; a lift is `reportable` only if both the level and the reference have >= 10 events.

**Lens A factors (all strictly prior information).**
- Bounce-back: last game < 0.75x the season-to-date average (`bb_last1`); both of the last 2 games below (`bb_last2`); mean of the last 3 below (`bb_l3mean`). Hot streak: last game >= 1.25x / 1.5x, last-3 mean >= 1.25x, last-5 mean >= 1.15x (and < 0.85x = cold).
- Opponent defence and pace: as-of season-to-date DRtg / pace rank among teams with >= 5 games: worst 5, worst 10, best 10, best 5 and the 5-level ladder (vs the middle 10). Opponent form: the opponent's DRtg over its last 5 (or last 1) games minus its season-to-date DRtg (leaky = >= +3 over 5 games / +10 over one game, tight = the mirror image).
- Rest and venue: own rest days, own 2nd / 1st night of a back-to-back, opponent on a back-to-back, home.
- **Teammates out (usage vacuum).** A teammate is a *regular* if, before the game, he has >= 5 games for the team this season, appeared in >= 50% of the team's games, and averaged >= 20 minutes in the games he played. He is *out* if the box score lists him inactive, or DNP for a non-coach reason (injury, illness, rest, personal, suspension, not with team); DNP-coach's-decision is not counted. Vacuum size = sum of the out regulars' prior PPG: none / < 10 / 10-20 / 20+; also "team's top scorer out" (highest prior PPG among regulars) and "a regular starter out". Knowability: the inactive list is posted about 30 minutes before tip; later scratches are possible, and the injury report earlier in the day is not in the data.
- Role and minutes: last-5 minutes >= / <= 3 vs the season average; promoted (started >= 2 of the last 3 while the season start rate is < 50%) / demoted (the mirror).
- Season phase: early (Oct-Nov), mid (Dec-Feb), late (Mar-Apr); NBA Cup group / knockout games identified from `game_meta.game_type`.

**Lens B factors (same game, NOT predictive).** Minutes +5, FGA +4, FTA +3, 3PA +3, usage +5 points and TS% +/-10 points vs the player's prior averages; overtime (team minutes > 48.5); final margin (close <= 5, blowout 15+ win or loss), combined score (240+ / <= 215), own team won; opposing starter with >= 5 fouls and opponent team fouls >= 25 (box-score PF is available, so this is measured, not inferred). Exact decomposition of the excess: ln(PTS / prior avg) = ln(minutes ratio) + ln(shots-per-minute ratio) + ln(efficiency ratio), with shot volume = FGA + 0.44 FTA and efficiency = PTS per shot; shares are ratio-of-sums over the event games.

**Estimation.** Lift = rate with the factor vs the reference (risk ratio, odds ratio, absolute percentage-point difference) with 95% CIs from the player-clustered influence function (SE clustered by player). *Adjusted* = multivariable logistic regression with player-clustered robust SEs, controlling for log prior average, prior volatility (SD / average), prior usage, prior minutes, season progress (log prior games), prior start rate and position, plus all the Lens A terms together; absolute effects are average marginal effects with 95% CIs from 400 draws of the clustered covariance. **Models** are scored on a date split (last ~20% of dates per timespan, same cut-offs as the earlier studies) with AUC, Brier and log-loss and paired player-cluster bootstrap CIs (200 resamples): controls-only logistic, pregame logistic (controls + Lens A), same-game logistic (controls + Lens B; explanatory), and LightGBM on the pregame inputs. Boosting (with SHAP) is kept only if its AUC gain over the pregame logistic is >= 0.005 with the bootstrap CI above 0, the log-loss CI is below 0 and its Brier score is lower. Stars vs non-stars: pooled-segment comparison of ratios and percentage-point effects (independent clusters) plus a logistic interaction test per factor (controls + factor + star + factor x star). Per-player: DerSimonian-Laird heterogeneity and empirical-Bayes shrinkage, with expected-by-chance counts.

## 3. Counts per cut (floor 8 PPG, std baseline, pooled 2023-24 to 2025-26)

| segment | games | players | thin | 1.25x | 1.5x | 2.0x | +5 | +10 | z>=1.5 |
|---|---|---|---|---|---|---|---|---|---|
| all | 41,123 | 443 |  | 11,871 (28.9%) | 6,529 (15.9%) | 1,757 (4.3%) | 9,236 (22.5%) | 3,313 (8.1%) | 3,880 (9.4%) |
| top100 | 16,112 | 100 |  | 4,037 (25.1%) | 1,768 (11.0%) | 273 (1.7%) | 4,008 (24.9%) | 1,598 (9.9%) | 1,482 (9.2%) |
| top50 | 8,166 | 50 |  | 1,839 (22.5%) | 698 (8.5%) | 80 (1.0%) | 2,087 (25.6%) | 875 (10.7%) | 710 (8.7%) |
| top25 | 4,110 | 25 | yes | 824 (20.0%) | 276 (6.7%) | 22 (0.5%) | 1,046 (25.5%) | 442 (10.8%) | 316 (7.7%) |
| top10 | 1,733 | 10 | yes | 301 (17.4%) | 93 (5.4%) | 11 (0.6%) | 433 (25.0%) | 176 (10.2%) | 124 (7.2%) |

Same cuts against the **last-10 baseline** (floor 8, `baseline = l10`):

| segment | games | players | 1.25x | 1.5x | 2.0x | +5 | +10 | z>=1.5 |
|---|---|---|---|---|---|---|---|---|
| all | 42,124 | 514 | 11,479 (27.3%) | 6,061 (14.4%) | 1,653 (3.9%) | 8,878 (21.1%) | 3,174 (7.5%) | 3,942 (9.6%) |
| top100 | 16,085 | 100 | 4,071 (25.3%) | 1,796 (11.2%) | 331 (2.1%) | 4,017 (25.0%) | 1,601 (10.0%) | 1,559 (10.0%) |
| top50 | 8,165 | 50 | 1,902 (23.3%) | 729 (8.9%) | 94 (1.2%) | 2,115 (25.9%) | 898 (11.0%) | 794 (10.0%) |
| top25 | 4,110 | 25 | 895 (21.8%) | 310 (7.5%) | 26 (0.6%) | 1,087 (26.4%) | 486 (11.8%) | 371 (9.3%) |
| top10 | 1,733 | 10 | 322 (18.6%) | 93 (5.4%) | 11 (0.6%) | 440 (25.4%) | 186 (10.7%) | 151 (9.0%) |

**By timespan** (std baseline, floor 8; events and base rate; `*` = provisional; top 25 / top 10 are thin everywhere and in the mart):

| timespan | segment | games / players | thin | 1.25x | 1.5x | 2.0x | +5 | +10 | z>=1.5 |
|---|---|---|---|---|---|---|---|---|---|
| pooled_2023_27* | all | 41,913 / 451 |  | 12,074 (28.8%) | 6,635 (15.8%) | 1,784 (4.3%) | 9,402 (22.4%) | 3,372 (8.0%) | 3,967 (9.5%) |
| pooled_2023_27* | top100 | 16,558 / 100 |  | 4,148 (25.1%) | 1,819 (11.0%) | 285 (1.7%) | 4,110 (24.8%) | 1,632 (9.9%) | 1,530 (9.2%) |
| pooled_2023_27* | top50 | 8,352 / 50 |  | 1,882 (22.5%) | 709 (8.5%) | 83 (1.0%) | 2,131 (25.5%) | 892 (10.7%) | 730 (8.7%) |
| pooled_2023_26 | all | 41,123 / 443 |  | 11,871 (28.9%) | 6,529 (15.9%) | 1,757 (4.3%) | 9,236 (22.5%) | 3,313 (8.1%) | 3,880 (9.4%) |
| pooled_2023_26 | top100 | 16,112 / 100 |  | 4,037 (25.1%) | 1,768 (11.0%) | 273 (1.7%) | 4,008 (24.9%) | 1,598 (9.9%) | 1,482 (9.2%) |
| pooled_2023_26 | top50 | 8,166 / 50 |  | 1,839 (22.5%) | 698 (8.5%) | 80 (1.0%) | 2,087 (25.6%) | 875 (10.7%) | 710 (8.7%) |
| 2023_24 | all | 13,334 / 281 |  | 3,768 (28.3%) | 2,024 (15.2%) | 510 (3.8%) | 3,003 (22.5%) | 1,097 (8.2%) | 1,279 (9.6%) |
| 2023_24 | top100 | 6,044 / 100 |  | 1,603 (26.5%) | 708 (11.7%) | 122 (2.0%) | 1,584 (26.2%) | 651 (10.8%) | 614 (10.2%) |
| 2023_24 | top50 | 3,018 / 50 |  | 648 (21.5%) | 228 (7.6%) | 24 (0.8%) | 768 (25.4%) | 318 (10.5%) | 258 (8.5%) |
| 2024_25 | all | 13,900 / 319 |  | 4,196 (30.2%) | 2,369 (17.0%) | 645 (4.6%) | 3,239 (23.3%) | 1,150 (8.3%) | 1,364 (9.8%) |
| 2024_25 | top100 | 5,541 / 100 |  | 1,447 (26.1%) | 630 (11.4%) | 92 (1.7%) | 1,448 (26.1%) | 562 (10.1%) | 514 (9.3%) |
| 2024_25 | top50 | 2,806 / 50 |  | 644 (23.0%) | 248 (8.8%) | 24 (0.9%) | 737 (26.3%) | 316 (11.3%) | 245 (8.7%) |
| 2025_26 | all | 13,897 / 318 |  | 3,913 (28.2%) | 2,137 (15.4%) | 603 (4.3%) | 2,995 (21.6%) | 1,065 (7.7%) | 1,238 (8.9%) |
| 2025_26 | top100 | 5,542 / 100 |  | 1,287 (23.2%) | 554 (10.0%) | 96 (1.7%) | 1,294 (23.3%) | 506 (9.1%) | 442 (8.0%) |
| 2025_26 | top50 | 2,752 / 50 |  | 564 (20.5%) | 213 (7.7%) | 24 (0.9%) | 653 (23.7%) | 271 (9.8%) | 222 (8.1%) |
| 2026_27* | all | 840 / 208 |  | 221 (26.3%) | 115 (13.7%) | 28 (3.3%) | 179 (21.3%) | 64 (7.6%) | 95 (11.3%) |
| 2026_27* | top100 | 432 / 95 |  | 115 (26.6%) | 53 (12.3%) | 8 (1.9%) | 113 (26.2%) | 45 (10.4%) | 58 (13.4%) |
| 2026_27* | top50 | 221 / 48 | yes | 51 (23.1%) | 19 (8.6%) | 1 (0.5%) | 57 (25.8%) | 24 (10.9%) | 28 (12.7%) |

**Floor sensitivity** (all players, pooled 2023-24 to 2025-26, std baseline; events and base rate):

| floor | games | 1.25x | 1.5x | 2.0x | +5 | +10 | z>=1.5 |
|---|---|---|---|---|---|---|---|
| none (avg > 0) | 64,196 | 20,955 (32.6%) | 13,495 (21.0%) | 5,647 (8.8%) | 13,422 (20.9%) | 4,507 (7.0%) | 7,142 (11.1%) |
| 5+ PPG | 56,437 | 17,599 (31.2%) | 10,767 (19.1%) | 3,856 (6.8%) | 12,138 (21.5%) | 4,177 (7.4%) | 5,784 (10.2%) |
| 8+ PPG (default) | 41,123 | 11,871 (28.9%) | 6,529 (15.9%) | 1,757 (4.3%) | 9,236 (22.5%) | 3,313 (8.1%) | 3,880 (9.4%) |
| 12+ PPG | 24,128 | 6,127 (25.4%) | 2,836 (11.8%) | 496 (2.1%) | 5,639 (23.4%) | 2,160 (9.0%) | 2,117 (8.8%) |

The floor matters most for the 2.0x cut: with no floor 8.8% of games reach 2x (bench players scoring 6 instead of 3), at 8+ PPG 4.3%, at 12+ PPG 2.1%. The factor ranking is the same at every floor (section 4.4); the vacuum effect is slightly larger the lower the floor.

## 4. Lens A: pregame factors (knowable before tip-off)

### 4.1 Factor tables, all players, pooled 2023-24 to 2025-26, std baseline, floor 8

`rate with` / `rate without` = share of games that are big nights with and without the factor; RR = risk ratio; pp = absolute percentage-point difference; **adjusted** = same factor in the multivariable logistic with all the others and the controls (OR and average marginal effect in pp). Adjusted values exist for the non-redundant terms only. Full set for every cell in `big_night_factor_lift`.

**1.5x the prior average** (base rate 15.9%):

| dimension | factor | share_of_games | rate_with | rate_without | RR | pp | adj_OR | adj_pp |
|---|---|---|---|---|---|---|---|---|
| bounce_back | last game below 0.75x average | 29% | 14.2% | 16.5% | 0.86 [0.82, 0.91] | -2.3 [-3.1, -1.5] | 0.94 [0.87, 1.01] | -0.8 [-1.7, +0.1] |
| bounce_back | last 2 games both below 0.75x | 10% | 13.3% | 16.2% | 0.82 [0.75, 0.90] | -2.9 [-4.1, -1.7] | 0.89 [0.78, 1.00] | -1.5 [-2.8, +0.1] |
| bounce_back | last-3 mean below 0.75x | 16% | 13.8% | 16.3% | 0.85 [0.79, 0.90] | -2.5 [-3.5, -1.5] |  |  |
| hot_streak | last game at least 1.25x average | 29% | 20.1% | 14.1% | 1.42 [1.35, 1.50] | +6.0 [+5.1, +6.9] | 1.12 [1.05, 1.20] | +1.4 [+0.6, +2.4] |
| hot_streak | last game at least 1.5x average | 15% | 23.1% | 14.6% | 1.59 [1.49, 1.69] | +8.6 [+7.3, +9.8] |  |  |
| hot_streak | last-3 mean at least 1.25x average | 20% | 23.2% | 14.0% | 1.66 [1.56, 1.76] | +9.2 [+8.0, +10.5] |  |  |
| hot_streak | last-5 average at least 1.15x season average | 26% | 22.0% | 13.8% | 1.60 [1.50, 1.70] | +8.2 [+7.0, +9.4] | 1.10 [1.01, 1.18] | +1.2 [+0.2, +2.1] |
| hot_streak | last-5 average below 0.85x season average | 20% | 13.2% | 16.6% | 0.79 [0.74, 0.85] | -3.4 [-4.4, -2.5] | 0.89 [0.82, 0.98] | -1.4 [-2.4, -0.3] |
| opp_defence | opponent worst-5 defence | 17% | 18.4% | 15.4% | 1.19 [1.12, 1.27] | +3.0 [+1.9, +4.1] |  |  |
| opp_defence | opponent worst-10 defence | 33% | 17.3% | 15.2% | 1.15 [1.09, 1.20] | +2.2 [+1.4, +3.0] | 1.09 [1.03, 1.16] | +1.1 [+0.5, +2.0] |
| opp_defence | opponent best-10 defence | 34% | 14.3% | 16.7% | 0.86 [0.81, 0.90] | -2.4 [-3.2, -1.6] | 0.89 [0.83, 0.95] | -1.4 [-2.3, -0.6] |
| opp_defence | opponent best-5 defence | 17% | 14.3% | 16.2% | 0.88 [0.83, 0.94] | -1.9 [-2.8, -1.0] |  |  |
| opp_pace | opponent fastest-10 pace | 33% | 17.4% | 15.1% | 1.15 [1.10, 1.20] | +2.2 [+1.5, +3.0] | 1.12 [1.04, 1.19] | +1.4 [+0.6, +2.2] |
| opp_pace | opponent slowest-10 pace | 33% | 14.7% | 16.5% | 0.89 [0.85, 0.94] | -1.7 [-2.5, -1.0] | 0.94 [0.88, 1.00] | -0.8 [-1.6, +0.0] |
| rest | own 2nd night of a back-to-back | 17% | 17.0% | 15.6% | 1.09 [1.03, 1.15] | +1.4 [+0.4, +2.3] | 1.03 [0.96, 1.11] | +0.4 [-0.6, +1.4] |
| rest | own 1st night of a back-to-back | 18% | 15.8% | 15.6% | 1.01 [0.95, 1.08] | +0.2 [-0.7, +1.1] | 1.01 [0.94, 1.09] | +0.1 [-0.8, +1.1] |
| rest | opponent on a back-to-back | 18% | 16.6% | 15.7% | 1.06 [1.00, 1.12] | +0.9 [-0.1, +1.8] | 1.04 [0.96, 1.12] | +0.5 [-0.5, +1.4] |
| venue | home | 50% | 16.2% | 15.6% | 1.04 [0.99, 1.09] | +0.6 [-0.1, +1.4] | 1.05 [0.99, 1.11] | +0.6 [-0.1, +1.3] |
| opp_form | opponent last-5 DRtg 3+ worse than its season | 30% | 16.1% | 15.9% | 1.01 [0.96, 1.07] | +0.2 [-0.6, +1.0] | 0.99 [0.93, 1.05] | -0.2 [-1.0, +0.6] |
| opp_form | opponent last-5 DRtg 3+ better than its season | 22% | 15.7% | 15.9% | 0.99 [0.93, 1.05] | -0.2 [-1.1, +0.7] | 0.98 [0.91, 1.05] | -0.3 [-1.2, +0.6] |
| opp_form | opponent last-game DRtg 10+ worse than its season | 20% | 16.1% | 15.9% | 1.01 [0.96, 1.07] | +0.2 [-0.7, +1.1] | 1.00 [0.93, 1.07] | -0.0 [-0.9, +0.8] |
| opp_form | opponent last-game DRtg 10+ better than its season | 17% | 15.4% | 15.9% | 0.97 [0.91, 1.03] | -0.5 [-1.4, +0.5] | 0.93 [0.86, 1.00] | -0.9 [-1.8, -0.0] |
| teammates_out | any regular teammate out | 66% | 18.2% | 11.4% | 1.61 [1.51, 1.71] | +6.9 [+6.0, +7.8] |  |  |
| teammates_out | regulars out: <10 prior PPG | 9% | 12.5% | 11.4% | 1.10 [0.99, 1.22] | +1.1 [-0.1, +2.4] | 1.10 [0.98, 1.23] | +1.2 [-0.1, +2.6] |
| teammates_out | regulars out: 10-20 prior PPG | 21% | 14.0% | 11.4% | 1.24 [1.14, 1.33] | +2.7 [+1.7, +3.7] | 1.18 [1.09, 1.28] | +2.2 [+1.1, +3.3] |
| teammates_out | regulars out: 20+ prior PPG | 35% | 22.2% | 11.4% | 1.96 [1.82, 2.10] | +10.9 [+9.7, +12.0] | 1.65 [1.52, 1.79] | +6.6 [+5.5, +7.7] |
| teammates_out | a 20+ PPG teammate out | 23% | 22.6% | 13.8% | 1.64 [1.53, 1.74] | +8.8 [+7.5, +10.1] |  |  |
| teammates_out | team's top scorer out | 19% | 25.0% | 13.7% | 1.83 [1.70, 1.96] | +11.3 [+9.8, +12.8] | 1.22 [1.12, 1.33] | +2.6 [+1.5, +3.9] |
| teammates_out | a regular starter out | 56% | 19.1% | 11.7% | 1.63 [1.53, 1.73] | +7.4 [+6.4, +8.3] |  |  |
| teammates_out | opponent missing 10+ PPG of regulars | 61% | 16.4% | 15.1% | 1.09 [1.04, 1.14] | +1.3 [+0.6, +2.0] | 1.01 [0.96, 1.07] | +0.2 [-0.5, +0.9] |
| minutes_role | last-5 minutes 3+ above season | 17% | 24.5% | 14.4% | 1.70 [1.59, 1.82] | +10.1 [+8.7, +11.6] | 1.21 [1.12, 1.31] | +2.5 [+1.4, +3.6] |
| minutes_role | last-5 minutes 3+ below season | 12% | 12.0% | 14.4% | 0.83 [0.76, 0.90] | -2.5 [-3.5, -1.4] | 0.79 [0.70, 0.88] | -2.8 [-4.1, -1.7] |
| minutes_role | recently promoted to the starting five | 7% | 28.3% | 15.0% | 1.89 [1.74, 2.05] | +13.3 [+11.2, +15.4] | 1.25 [1.13, 1.37] | +2.9 [+1.7, +4.4] |
| minutes_role | recently demoted from the starting five | 3% | 12.5% | 15.0% | 0.83 [0.71, 0.97] | -2.5 [-4.5, -0.6] | 0.81 [0.68, 0.96] | -2.5 [-4.3, -0.6] |
| season_phase | early season (Oct-Nov) | 17% | 15.2% | 14.8% | 1.03 [0.96, 1.10] | +0.4 [-0.6, +1.5] | 1.22 [1.08, 1.38] | +2.6 [+1.1, +4.1] |
| season_phase | late season (Mar-Apr) | 29% | 18.2% | 14.8% | 1.23 [1.16, 1.31] | +3.4 [+2.4, +4.5] | 1.00 [0.92, 1.08] | +0.0 [-0.9, +0.9] |
| season_phase | NBA Cup group/knockout game | 5% | 15.1% | 15.9% | 0.95 [0.86, 1.05] | -0.8 [-2.4, +0.8] | 1.03 [0.90, 1.18] | +0.4 [-1.2, +2.3] |

**prior average + 10** (base rate 8.1%):

| dimension | factor | share_of_games | rate_with | rate_without | RR | pp | adj_OR | adj_pp |
|---|---|---|---|---|---|---|---|---|
| bounce_back | last game below 0.75x average | 29% | 6.4% | 8.7% | 0.74 [0.68, 0.80] | -2.3 [-2.9, -1.7] | 0.96 [0.86, 1.07] | -0.3 [-1.0, +0.5] |
| bounce_back | last 2 games both below 0.75x | 10% | 5.0% | 8.4% | 0.59 [0.51, 0.69] | -3.4 [-4.2, -2.6] | 0.77 [0.64, 0.92] | -1.8 [-2.8, -0.5] |
| bounce_back | last-3 mean below 0.75x | 16% | 5.6% | 8.5% | 0.66 [0.59, 0.74] | -2.9 [-3.6, -2.2] |  |  |
| hot_streak | last game at least 1.25x average | 29% | 9.9% | 7.3% | 1.35 [1.25, 1.47] | +2.6 [+1.9, +3.3] | 1.18 [1.07, 1.30] | +1.2 [+0.6, +1.9] |
| hot_streak | last game at least 1.5x average | 15% | 10.6% | 7.6% | 1.40 [1.27, 1.54] | +3.0 [+2.0, +4.0] |  |  |
| hot_streak | last-3 mean at least 1.25x average | 20% | 10.8% | 7.4% | 1.46 [1.34, 1.59] | +3.4 [+2.5, +4.2] |  |  |
| hot_streak | last-5 average at least 1.15x season average | 26% | 10.1% | 7.4% | 1.37 [1.26, 1.50] | +2.7 [+1.9, +3.6] | 1.07 [0.96, 1.19] | +0.5 [-0.3, +1.3] |
| hot_streak | last-5 average below 0.85x season average | 20% | 5.8% | 8.6% | 0.67 [0.61, 0.74] | -2.9 [-3.5, -2.2] | 0.88 [0.78, 0.99] | -0.9 [-1.6, -0.1] |
| opp_defence | opponent worst-5 defence | 17% | 9.5% | 7.8% | 1.22 [1.12, 1.33] | +1.7 [+1.0, +2.5] |  |  |
| opp_defence | opponent worst-10 defence | 33% | 9.0% | 7.6% | 1.18 [1.11, 1.26] | +1.4 [+0.9, +1.9] | 1.06 [0.98, 1.14] | +0.4 [-0.1, +1.0] |
| opp_defence | opponent best-10 defence | 34% | 6.9% | 8.6% | 0.80 [0.75, 0.86] | -1.7 [-2.2, -1.2] | 0.83 [0.77, 0.91] | -1.3 [-1.9, -0.7] |
| opp_defence | opponent best-5 defence | 17% | 6.7% | 8.3% | 0.81 [0.74, 0.89] | -1.6 [-2.2, -0.9] |  |  |
| opp_pace | opponent fastest-10 pace | 33% | 9.2% | 7.5% | 1.24 [1.16, 1.32] | +1.8 [+1.2, +2.3] | 1.18 [1.08, 1.28] | +1.2 [+0.6, +1.9] |
| opp_pace | opponent slowest-10 pace | 33% | 7.2% | 8.5% | 0.85 [0.79, 0.91] | -1.3 [-1.8, -0.7] | 0.93 [0.85, 1.02] | -0.5 [-1.1, +0.2] |
| rest | own 2nd night of a back-to-back | 17% | 8.8% | 7.8% | 1.13 [1.04, 1.23] | +1.0 [+0.3, +1.7] | 1.06 [0.96, 1.16] | +0.4 [-0.2, +1.1] |
| rest | own 1st night of a back-to-back | 18% | 8.1% | 7.8% | 1.04 [0.95, 1.13] | +0.3 [-0.4, +1.0] | 1.02 [0.93, 1.13] | +0.2 [-0.6, +0.9] |
| rest | opponent on a back-to-back | 18% | 8.7% | 7.9% | 1.10 [1.02, 1.19] | +0.8 [+0.1, +1.5] | 1.09 [1.00, 1.20] | +0.6 [+0.0, +1.4] |
| venue | home | 50% | 8.2% | 7.9% | 1.03 [0.96, 1.11] | +0.2 [-0.4, +0.8] | 1.03 [0.95, 1.12] | +0.2 [-0.4, +0.8] |
| opp_form | opponent last-5 DRtg 3+ worse than its season | 30% | 8.2% | 8.1% | 1.02 [0.94, 1.10] | +0.1 [-0.5, +0.8] | 0.99 [0.91, 1.08] | -0.1 [-0.7, +0.5] |
| opp_form | opponent last-5 DRtg 3+ better than its season | 22% | 7.8% | 8.1% | 0.97 [0.89, 1.06] | -0.2 [-0.9, +0.4] | 0.95 [0.86, 1.05] | -0.3 [-1.1, +0.4] |
| opp_form | opponent last-game DRtg 10+ worse than its season | 20% | 8.3% | 8.1% | 1.03 [0.94, 1.12] | +0.2 [-0.5, +0.9] | 1.02 [0.93, 1.12] | +0.1 [-0.5, +0.9] |
| opp_form | opponent last-game DRtg 10+ better than its season | 17% | 7.7% | 8.1% | 0.96 [0.88, 1.04] | -0.4 [-1.0, +0.3] | 0.94 [0.85, 1.04] | -0.5 [-1.3, +0.2] |
| teammates_out | any regular teammate out | 66% | 9.4% | 5.5% | 1.69 [1.55, 1.85] | +3.8 [+3.2, +4.4] |  |  |
| teammates_out | regulars out: <10 prior PPG | 9% | 6.5% | 5.5% | 1.18 [1.02, 1.36] | +1.0 [+0.1, +1.9] | 1.14 [0.98, 1.33] | +1.0 [-0.1, +2.0] |
| teammates_out | regulars out: 10-20 prior PPG | 21% | 7.4% | 5.5% | 1.34 [1.20, 1.48] | +1.9 [+1.2, +2.5] | 1.31 [1.18, 1.46] | +2.1 [+1.3, +3.0] |
| teammates_out | regulars out: 20+ prior PPG | 35% | 11.3% | 5.5% | 2.04 [1.85, 2.24] | +5.7 [+5.0, +6.5] | 1.77 [1.59, 1.97] | +4.4 [+3.6, +5.1] |
| teammates_out | a 20+ PPG teammate out | 23% | 11.5% | 7.0% | 1.64 [1.50, 1.80] | +4.5 [+3.6, +5.4] |  |  |
| teammates_out | team's top scorer out | 19% | 12.2% | 7.1% | 1.72 [1.56, 1.89] | +5.1 [+4.1, +6.1] | 1.32 [1.19, 1.48] | +2.1 [+1.3, +3.2] |
| teammates_out | a regular starter out | 56% | 9.9% | 5.8% | 1.71 [1.57, 1.86] | +4.1 [+3.5, +4.7] |  |  |
| teammates_out | opponent missing 10+ PPG of regulars | 61% | 8.2% | 7.8% | 1.04 [0.97, 1.12] | +0.4 [-0.2, +0.9] | 0.97 [0.90, 1.05] | -0.2 [-0.8, +0.3] |
| minutes_role | last-5 minutes 3+ above season | 17% | 11.1% | 7.8% | 1.42 [1.29, 1.57] | +3.3 [+2.3, +4.3] | 1.23 [1.10, 1.38] | +1.6 [+0.7, +2.4] |
| minutes_role | last-5 minutes 3+ below season | 12% | 5.4% | 7.8% | 0.70 [0.61, 0.79] | -2.4 [-3.1, -1.6] | 0.84 [0.73, 0.98] | -1.2 [-2.1, -0.2] |
| minutes_role | recently promoted to the starting five | 7% | 10.9% | 8.0% | 1.37 [1.17, 1.59] | +2.9 [+1.3, +4.6] | 1.13 [0.96, 1.33] | +0.9 [-0.3, +2.4] |
| minutes_role | recently demoted from the starting five | 3% | 4.3% | 8.0% | 0.54 [0.41, 0.70] | -3.7 [-4.8, -2.5] | 0.66 [0.51, 0.86] | -2.6 [-3.9, -1.1] |
| season_phase | early season (Oct-Nov) | 17% | 8.1% | 7.5% | 1.09 [0.99, 1.20] | +0.7 [-0.1, +1.5] | 1.35 [1.15, 1.58] | +2.4 [+1.1, +3.9] |
| season_phase | late season (Mar-Apr) | 29% | 9.1% | 7.5% | 1.22 [1.12, 1.32] | +1.6 [+0.9, +2.3] | 0.99 [0.90, 1.09] | -0.1 [-0.7, +0.7] |
| season_phase | NBA Cup group/knockout game | 5% | 8.1% | 8.1% | 1.00 [0.86, 1.16] | +0.0 [-1.2, +1.2] | 1.06 [0.88, 1.27] | +0.4 [-0.9, +1.9] |

**Tier ladders (vs the middle 10 teams), 1.5x and +10, RR [95% CI]:**

| level | 1.5x RR | 1.5x pp | +10 RR | +10 pp |
|---|---|---|---|---|
| worst 5 (vs middle 10) | 1.15 [1.07, 1.22] | +2.3 [+1.2, +3.5] | 1.15 [1.06, 1.25] | +1.2 [+0.5, +2.0] |
| worst 6-10 (vs middle 10) | 1.02 [0.95, 1.09] | +0.3 [-0.8, +1.4] | 1.03 [0.94, 1.12] | +0.2 [-0.6, +1.0] |
| best 6-10 (vs middle 10) | 0.89 [0.83, 0.95] | -1.7 [-2.7, -0.7] | 0.86 [0.78, 0.95] | -1.2 [-1.9, -0.4] |
| best 5 (vs middle 10) | 0.89 [0.83, 0.95] | -1.8 [-2.8, -0.8] | 0.82 [0.74, 0.90] | -1.5 [-2.2, -0.8] |
| fastest 5 (vs middle 10) | 1.12 [1.05, 1.19] | +1.9 [+0.9, +2.9] | 1.22 [1.11, 1.33] | +1.7 [+0.9, +2.5] |
| fast 6-10 (vs middle 10) | 1.11 [1.05, 1.19] | +1.8 [+0.7, +2.8] | 1.18 [1.07, 1.29] | +1.4 [+0.6, +2.2] |
| slow 6-10 (vs middle 10) | 0.96 [0.90, 1.02] | -0.7 [-1.7, +0.3] | 0.95 [0.87, 1.04] | -0.3 [-1.0, +0.3] |
| slowest 5 (vs middle 10) | 0.94 [0.88, 1.01] | -1.0 [-2.0, +0.1] | 0.91 [0.82, 1.02] | -0.7 [-1.4, +0.1] |
| own rest days 0 | 1.08 [1.02, 1.14] | +1.2 [+0.3, +2.2] | 1.12 [1.03, 1.22] | +0.9 [+0.2, +1.7] |
| own rest days 2 | 1.01 [0.95, 1.07] | +0.1 [-0.9, +1.1] | 1.03 [0.94, 1.13] | +0.2 [-0.5, +1.0] |
| own rest days 3+ | 0.92 [0.83, 1.02] | -1.3 [-2.8, +0.3] | 0.91 [0.78, 1.06] | -0.7 [-1.9, +0.4] |

The defence ladder is monotone but shallow: the worst-5 defences add about 2 pp to the 1.5x rate vs the middle 10 and the best-5 take away about 2 pp; nothing in the worst 6-10 band. The pace ladder is flatter.

### 4.2 What is strongest, by cut (adjusted, all players)

Top 6 non-control terms by absolute adjusted effect (average marginal effect, pp, with 95% CI); the base rate for context. `vac_large` = regular teammates averaging 20+ PPG together are out.

| cut | base rate | #1 | #2 | #3 | #4 | #5 | #6 |
|---|---|---|---|---|---|---|---|
| 1.25x | 28.9% | vac_large +8.6 pp [+7.2, +9.9] | role_demoted -4.5 pp [-7.1, -1.9] | out_top1 +4.2 pp [+2.8, +5.6] | min_up3 +3.7 pp [+2.4, +4.8] | role_promoted +3.7 pp [+2.2, +5.5] | min_dn3 -3.6 pp [-5.1, -2.1] |
| 1.5x | 15.9% | vac_large +6.6 pp [+5.5, +7.7] | role_promoted +2.9 pp [+1.7, +4.4] | min_dn3 -2.8 pp [-4.1, -1.7] | out_top1 +2.6 pp [+1.5, +3.9] | phase_early +2.6 pp [+1.1, +4.1] | min_up3 +2.5 pp [+1.4, +3.6] |
| 2.0x | 4.3% | vac_large +3.1 pp [+2.5, +3.7] | phase_early +2.1 pp [+1.0, +3.3] | vac_med +1.6 pp [+0.9, +2.4] | out_top1 +1.2 pp [+0.6, +1.8] | min_up3 +1.1 pp [+0.6, +1.7] | role_demoted -1.0 pp [-2.0, +0.4] |
| +5 | 22.5% | vac_large +8.0 pp [+6.8, +9.1] | role_demoted -4.2 pp [-6.3, -1.7] | out_top1 +4.0 pp [+2.5, +5.4] | min_dn3 -3.6 pp [-5.1, -2.1] | min_up3 +3.5 pp [+2.2, +4.9] | phase_early +3.1 pp [+1.5, +5.0] |
| +10 | 8.1% | vac_large +4.4 pp [+3.6, +5.1] | role_demoted -2.6 pp [-3.9, -1.1] | phase_early +2.4 pp [+1.1, +3.9] | out_top1 +2.1 pp [+1.3, +3.2] | vac_med +2.1 pp [+1.3, +3.0] | bb_last2 -1.8 pp [-2.8, -0.5] |
| z>=1.5 | 9.4% | vac_large +5.0 pp [+4.1, +5.9] | role_demoted -2.4 pp [-4.0, -0.8] | min_up3 +2.0 pp [+1.0, +3.0] | phase_early +2.0 pp [+0.8, +3.4] | out_top1 +1.9 pp [+0.9, +2.8] | bb_last2 -1.7 pp [-2.9, -0.4] |

### 4.3 Stability across seasons (adjusted effect in pp, all players, std baseline)

**1.5x** (`*` = provisional, ~115 events so far):

| factor | 2023_24 | 2024_25 | 2025_26 | pooled_2023_26 | 2026_27* |
|---|---|---|---|---|---|
| vac_large | +6.8 [+4.9, +8.8] | +8.4 [+6.3, +10.4] | +5.0 [+3.0, +6.8] | +6.6 [+5.5, +7.7] | +12.3 [+1.1, +27.8] |
| out_top1 | +1.4 [-0.4, +3.4] | +1.6 [-0.2, +3.6] | +4.8 [+2.9, +6.8] | +2.6 [+1.5, +3.9] | +10.3 [-2.1, +26.4] |
| hot_last1 | +2.0 [+0.6, +3.4] | +1.4 [-0.3, +3.3] | +0.9 [-0.7, +2.3] | +1.4 [+0.6, +2.4] | +7.3 [+1.2, +13.4] |
| bb_last1 | -0.2 [-1.8, +1.5] | -1.3 [-2.8, +0.4] | -0.8 [-2.2, +1.1] | -0.8 [-1.7, +0.1] | +2.9 [-3.2, +9.5] |
| bb_last2 | -2.4 [-4.5, +0.0] | -1.0 [-3.2, +1.5] | -0.9 [-3.3, +2.0] | -1.5 [-2.8, +0.1] | +0.4 [-6.8, +12.7] |
| def_worst10 | +0.8 [-0.9, +2.3] | +1.0 [-0.3, +2.5] | +1.7 [+0.7, +3.2] | +1.1 [+0.5, +2.0] | -2.4 [-7.9, +3.7] |
| def_best10 | -1.2 [-2.5, +0.3] | -1.4 [-2.9, +0.1] | -1.0 [-2.2, +0.3] | -1.4 [-2.3, -0.6] | -2.2 [-7.2, +3.3] |
| pace_fast10 | +2.6 [+1.1, +4.4] | +0.5 [-1.1, +2.0] | +1.4 [+0.1, +3.0] | +1.4 [+0.6, +2.2] | -3.4 [-9.0, +3.6] |
| b2b_2nd | +0.8 [-0.7, +2.5] | -0.9 [-2.6, +0.6] | +1.4 [-0.1, +3.1] | +0.4 [-0.6, +1.4] | +1.5 [-5.8, +11.9] |
| home | +0.8 [-0.3, +1.9] | +0.8 [-0.4, +2.0] | +0.3 [-0.9, +1.4] | +0.6 [-0.1, +1.3] | +1.7 [-3.5, +6.5] |
| min_up3 | +2.7 [+0.8, +5.0] | +0.4 [-1.1, +2.1] | +4.5 [+2.8, +6.8] | +2.5 [+1.4, +3.6] | +12.1 [-4.5, +38.5] |
| role_promoted | +3.2 [+0.9, +5.4] | +4.4 [+1.7, +7.0] | +1.4 [-0.8, +3.6] | +2.9 [+1.7, +4.4] | +3.0 [-7.3, +21.1] |
| phase_early | +2.1 [-0.7, +4.7] | +3.3 [+0.7, +6.1] | +2.5 [+0.2, +4.9] | +2.6 [+1.1, +4.1] |  |

**+10** (`*` = provisional, ~64 events so far):

| factor | 2023_24 | 2024_25 | 2025_26 | pooled_2023_26 | 2026_27* |
|---|---|---|---|---|---|
| vac_large | +4.0 [+2.6, +5.6] | +4.5 [+2.9, +5.9] | +4.9 [+3.7, +6.3] | +4.4 [+3.6, +5.1] | +10.1 [+0.0, +27.0] |
| out_top1 | +1.9 [+0.4, +3.6] | +2.4 [+0.8, +4.0] | +2.4 [+1.4, +3.9] | +2.1 [+1.3, +3.2] | +3.1 [-6.1, +20.1] |
| hot_last1 | +1.7 [+0.6, +3.0] | +1.1 [+0.0, +2.3] | +0.8 [-0.2, +1.9] | +1.2 [+0.6, +1.9] | +2.9 [-1.7, +8.7] |
| bb_last1 | -0.5 [-2.0, +0.9] | -0.5 [-1.7, +1.0] | +0.1 [-0.9, +1.4] | -0.3 [-1.0, +0.5] | -0.0 [-4.8, +5.7] |
| bb_last2 | -1.8 [-3.5, +0.7] | -1.5 [-3.4, +0.7] | -1.8 [-3.6, +0.2] | -1.8 [-2.8, -0.5] | +7.4 [-0.3, +19.5] |
| def_worst10 | +0.9 [-0.3, +2.1] | -0.5 [-1.6, +0.5] | +1.1 [-0.0, +2.1] | +0.4 [-0.1, +1.0] | -1.6 [-6.2, +3.1] |
| def_best10 | -1.2 [-2.5, +0.1] | -1.8 [-2.8, -0.8] | -0.4 [-1.3, +0.7] | -1.3 [-1.9, -0.7] | -2.3 [-6.8, +2.1] |
| pace_fast10 | +1.6 [+0.5, +2.8] | +0.3 [-0.9, +1.3] | +1.8 [+0.5, +3.0] | +1.2 [+0.6, +1.9] | -2.9 [-8.4, +1.8] |
| b2b_2nd | +0.7 [-0.5, +2.2] | -0.3 [-1.6, +0.9] | +0.8 [-0.3, +2.0] | +0.4 [-0.2, +1.1] | +3.4 [-2.9, +13.7] |
| home | -0.0 [-1.1, +1.0] | +0.7 [-0.2, +1.5] | -0.0 [-1.1, +0.9] | +0.2 [-0.4, +0.8] | +2.2 [-1.7, +6.7] |
| min_up3 | +1.2 [-0.1, +3.0] | +1.1 [-0.2, +2.6] | +2.5 [+0.9, +4.1] | +1.6 [+0.7, +2.4] | +0.7 [-6.8, +18.3] |
| role_promoted | +2.2 [+0.2, +4.8] | +1.1 [-1.0, +3.2] | -0.5 [-2.1, +1.3] | +0.9 [-0.3, +2.4] | +12.9 [-1.4, +39.7] |
| phase_early | +1.9 [-0.4, +4.4] | +4.0 [+1.7, +6.6] | +1.5 [-0.3, +3.5] | +2.4 [+1.1, +3.9] |  |

The vacuum, minutes-up and the two-weak-games drop keep their sign in every complete season (the promotion term does not at +10 in 2025-26). The defence and pace terms are inconsistent: for +10 bottom-10 defences are +0.9 pp (2023-24), -0.5 (2024-25), +1.1 (2025-26), and for 1.5x fast-pace opponents are +2.6 / +0.5 / +1.4 pp. The 2026-27 column is provisional and too noisy to read.

### 4.4 Sensitivity: baseline and floor (raw RR, all players, pooled 2023-24 to 2025-26)

| factor | 1.5x std baseline | 1.5x l10 baseline | +10 std baseline | +10 l10 baseline | 1.5x floor none | 1.5x floor 5 | 1.5x floor 12 |
|---|---|---|---|---|---|---|---|
| regulars out: 20+ prior PPG | 1.96 | 1.70 | 2.04 | 1.67 | 1.98 | 2.00 | 1.91 |
| team's top scorer out | 1.83 | 1.65 | 1.72 | 1.48 | 1.75 | 1.82 | 1.82 |
| last game at least 1.25x average | 1.42 | 1.08 | 1.35 | 1.02 | 1.41 | 1.44 | 1.43 |
| last game below 0.75x average | 0.86 | 1.08 | 0.74 | 0.94 | 0.90 | 0.87 | 0.87 |
| last-5 minutes 3+ above season | 1.70 | 1.12 | 1.42 | 0.90 | 1.55 | 1.67 | 1.64 |
| recently promoted to the starting five | 1.89 | 1.25 | 1.37 | 0.96 | 1.61 | 1.75 | 2.03 |
| opponent worst-10 defence | 1.15 | 1.13 | 1.18 | 1.22 | 1.12 | 1.12 | 1.15 |
| opponent best-10 defence | 0.86 | 0.86 | 0.80 | 0.80 | 0.88 | 0.87 | 0.85 |
| opponent fastest-10 pace | 1.15 | 1.17 | 1.24 | 1.26 | 1.12 | 1.13 | 1.19 |
| own 2nd night of a back-to-back | 1.09 | 1.08 | 1.13 | 1.14 | 1.16 | 1.15 | 1.07 |
| home | 1.04 | 1.02 | 1.03 | 1.02 | 1.03 | 1.04 | 1.01 |
| opponent last-5 DRtg 3+ worse than its season | 1.01 | 1.02 | 1.02 | 0.99 | 1.02 | 1.01 | 1.02 |

Reading: against the **last-10 baseline** the hot-game, minutes-up and promotion effects shrink to about 1.0 (the last-10 average already contains the recent form), and the weak-last-game penalty also fades; the vacuum drops from RR about 2.0 to about 1.7 but stays large; defence and pace tiers are unchanged. So *the carry-over of heat* is mostly the season-to-date baseline being stale for a player whose role is changing, while the *teammates-out* effect is a real shift in the conditions that the last-10 form only partly absorbs.

### 4.5 Segments (adjusted effect, pp; std baseline; pooled 2023-24 to 2025-26)

**1.5x** (top 10 is not modelled: 10 players):

| factor | all | top100 | top50 | top25 (thin) |
|---|---|---|---|---|
| vac_large | +6.6 [+5.5, +7.7] | +4.8 [+3.4, +6.4] | +5.6 [+4.0, +7.5] | +5.0 [+2.7, +7.6] |
| out_top1 | +2.6 [+1.5, +3.9] | +0.5 [-1.1, +2.2] | -0.4 [-1.9, +1.4] | -1.1 [-3.2, +2.3] |
| hot_last1 | +1.4 [+0.6, +2.4] | +1.2 [+0.2, +2.4] | -0.9 [-2.1, +0.3] | +0.0 [-1.8, +2.2] |
| bb_last1 | -0.8 [-1.7, +0.1] | -0.0 [-1.3, +1.3] | +0.4 [-1.4, +2.1] | +1.2 [-0.9, +4.2] |
| bb_last2 | -1.5 [-2.8, +0.1] | -1.4 [-3.0, +0.6] | -0.9 [-3.0, +2.2] | +0.5 [-3.1, +5.3] |
| def_worst10 | +1.1 [+0.5, +2.0] | +0.3 [-0.8, +1.5] | +0.0 [-1.3, +1.4] | +1.2 [-0.8, +3.2] |
| def_best10 | -1.4 [-2.3, -0.6] | -1.4 [-2.5, -0.2] | -1.2 [-2.4, -0.0] | +0.2 [-1.0, +1.5] |
| pace_fast10 | +1.4 [+0.6, +2.2] | +1.9 [+0.8, +3.1] | +1.2 [+0.0, +2.5] | +1.6 [+0.2, +3.2] |
| b2b_2nd | +0.4 [-0.6, +1.4] | -0.4 [-1.6, +0.8] | -0.6 [-2.3, +1.1] | +0.9 [-1.0, +3.2] |
| home | +0.6 [-0.1, +1.3] | -0.3 [-1.3, +0.6] | -1.2 [-2.7, +0.0] | -1.8 [-3.3, -0.3] |
| min_up3 | +2.5 [+1.4, +3.6] | +0.6 [-1.1, +2.6] | +1.2 [-1.0, +4.0] | +1.6 [-1.3, +6.1] |

**+10** (top 10 is not modelled: 10 players):

| factor | all | top100 | top50 | top25 (thin) |
|---|---|---|---|---|
| vac_large | +4.4 [+3.6, +5.1] | +4.8 [+3.5, +6.2] | +5.6 [+3.4, +7.6] | +5.9 [+3.1, +8.8] |
| out_top1 | +2.1 [+1.3, +3.2] | +1.0 [-0.5, +2.6] | -0.1 [-2.2, +2.3] | -1.3 [-4.9, +3.9] |
| hot_last1 | +1.2 [+0.6, +1.9] | +1.1 [+0.0, +2.3] | -0.4 [-1.7, +1.2] | +1.0 [-1.4, +3.5] |
| bb_last1 | -0.3 [-1.0, +0.5] | +0.2 [-1.2, +1.6] | +0.6 [-1.4, +2.8] | +1.0 [-1.9, +4.1] |
| bb_last2 | -1.8 [-2.8, -0.5] | -1.7 [-3.6, +0.3] | -0.7 [-3.8, +2.9] | +2.0 [-2.2, +8.6] |
| def_worst10 | +0.4 [-0.1, +1.0] | +0.6 [-0.2, +1.6] | +0.1 [-1.1, +1.3] | +0.8 [-1.1, +2.5] |
| def_best10 | -1.3 [-1.9, -0.7] | -1.3 [-2.2, -0.4] | -1.6 [-2.9, -0.4] | -0.8 [-2.7, +1.0] |
| pace_fast10 | +1.2 [+0.6, +1.9] | +1.4 [+0.4, +2.4] | +1.5 [+0.1, +3.0] | +1.8 [-0.0, +3.6] |
| b2b_2nd | +0.4 [-0.2, +1.1] | +0.4 [-0.8, +1.9] | -0.0 [-1.8, +2.0] | +1.8 [-0.7, +4.5] |
| home | +0.2 [-0.4, +0.8] | -0.4 [-1.4, +0.5] | -1.5 [-2.9, -0.0] | -2.1 [-4.1, -0.4] |
| min_up3 | +1.6 [+0.7, +2.4] | +1.1 [-0.4, +2.8] | +2.2 [-0.1, +4.6] | +2.6 [-0.7, +6.6] |

Top-100 and top-50 players show the same ordering: vacuum first by a wide margin, then fast opponents and elite defences. The top-25 column is thin and descriptive.

## 5. Lens B: same-game factors (explains how it happened; NOT predictive)

**Everything in this section is measured during the game.** Minutes, shot attempts, usage and TS% make up points, so their lifts are near-identities, not drivers. They are included to describe *how* the night came about, as requested, and must not be shown as a forecast.

**1.5x the prior average** (all players, pooled 2023-24 to 2025-26):

| factor | share_of_games | rate_with | rate_without | RR | pp |
|---|---|---|---|---|---|
| game went to overtime | 5% | 24.0% | 15.5% | 1.55 [1.42, 1.70] | +8.5 [+6.5, +10.6] |
| final margin within 5 | 24% | 17.8% | 15.3% | 1.16 [1.10, 1.23] | +2.5 [+1.6, +3.4] |
| own team won by 15+ | 18% | 16.6% | 15.7% | 1.05 [0.98, 1.14] | +0.8 [-0.4, +2.1] |
| own team lost by 15+ | 17% | 12.0% | 16.7% | 0.72 [0.66, 0.78] | -4.7 [-5.8, -3.6] |
| combined score 240+ | 30% | 20.9% | 15.0% | 1.39 [1.32, 1.47] | +5.9 [+4.9, +6.8] |
| combined score 215 or fewer | 25% | 11.4% | 15.0% | 0.76 [0.71, 0.81] | -3.7 [-4.5, -2.8] |
| own team won | 51% | 17.1% | 14.6% | 1.17 [1.10, 1.23] | +2.4 [+1.6, +3.3] |
| an opposing starter with 5+ fouls | 30% | 16.9% | 15.4% | 1.10 [1.04, 1.15] | +1.5 [+0.6, +2.3] |
| opponent team fouls 25+ | 9% | 18.0% | 15.7% | 1.15 [1.07, 1.24] | +2.3 [+1.0, +3.6] |
| minutes 5+ above prior average | 19% | 39.5% | 12.5% | 3.15 [2.99, 3.33] | +27.0 [+25.5, +28.4] |
| minutes 5+ below prior average | 18% | 1.9% | 12.5% | 0.15 [0.13, 0.19] | -10.6 [-11.3, -9.9] |
| FGA 4+ above prior average | 17% | 53.7% | 8.4% | 6.42 [6.12, 6.74] | +45.3 [+43.3, +47.3] |
| FTA 3+ above prior average | 12% | 37.5% | 13.0% | 2.88 [2.73, 3.03] | +24.5 [+22.5, +26.4] |
| 3PA 3+ above prior average | 10% | 48.4% | 12.2% | 3.98 [3.77, 4.20] | +36.2 [+34.0, +38.4] |
| usage 5+ points above prior | 17% | 40.0% | 10.9% | 3.68 [3.47, 3.90] | +29.1 [+27.6, +30.7] |
| TS% 10+ points above prior | 27% | 36.0% | 13.3% | 2.70 [2.54, 2.88] | +22.7 [+21.5, +23.9] |
| TS% 10+ points below prior | 29% | 1.2% | 13.3% | 0.09 [0.08, 0.11] | -12.1 [-13.0, -11.2] |

**prior average + 10** (all players, pooled 2023-24 to 2025-26):

| factor | share_of_games | rate_with | rate_without | RR | pp |
|---|---|---|---|---|---|
| game went to overtime | 5% | 16.0% | 7.7% | 2.09 [1.87, 2.33] | +8.4 [+6.6, +10.2] |
| final margin within 5 | 24% | 9.9% | 7.5% | 1.32 [1.23, 1.42] | +2.4 [+1.7, +3.1] |
| own team won by 15+ | 18% | 8.0% | 8.1% | 0.98 [0.89, 1.09] | -0.1 [-0.9, +0.7] |
| own team lost by 15+ | 17% | 4.1% | 8.9% | 0.47 [0.40, 0.54] | -4.7 [-5.4, -4.0] |
| combined score 240+ | 30% | 12.0% | 7.2% | 1.66 [1.54, 1.79] | +4.8 [+4.0, +5.6] |
| combined score 215 or fewer | 25% | 4.8% | 7.2% | 0.66 [0.59, 0.73] | -2.5 [-3.0, -1.9] |
| own team won | 51% | 9.2% | 6.9% | 1.33 [1.23, 1.43] | +2.3 [+1.6, +2.9] |
| an opposing starter with 5+ fouls | 30% | 9.5% | 7.5% | 1.27 [1.18, 1.37] | +2.0 [+1.3, +2.7] |
| opponent team fouls 25+ | 9% | 11.0% | 7.8% | 1.42 [1.29, 1.57] | +3.3 [+2.2, +4.3] |
| minutes 5+ above prior average | 19% | 21.1% | 6.1% | 3.44 [3.18, 3.73] | +15.0 [+13.8, +16.1] |
| minutes 5+ below prior average | 18% | 0.7% | 6.1% | 0.11 [0.08, 0.15] | -5.5 [-5.9, -5.0] |
| FGA 4+ above prior average | 17% | 35.4% | 2.6% | 13.57 [12.56, 14.66] | +32.8 [+31.6, +34.1] |
| FTA 3+ above prior average | 12% | 26.3% | 5.6% | 4.65 [4.35, 4.97] | +20.6 [+19.1, +22.1] |
| 3PA 3+ above prior average | 10% | 32.6% | 5.2% | 6.23 [5.77, 6.72] | +27.4 [+25.7, +29.1] |
| usage 5+ points above prior | 17% | 25.9% | 4.4% | 5.94 [5.50, 6.42] | +21.5 [+20.1, +22.9] |
| TS% 10+ points above prior | 27% | 19.8% | 6.1% | 3.24 [2.99, 3.51] | +13.7 [+12.7, +14.7] |
| TS% 10+ points below prior | 29% | 0.1% | 6.1% | 0.02 [0.01, 0.04] | -6.0 [-6.5, -5.5] |

**Profile of the event games vs the other games, and decomposition of the excess** (pooled 2023-24 to 2025-26, std baseline, floor 8). Deltas are vs the player's own prior season-to-date averages. Shares = share of ln(PTS / prior avg) from minutes, shots per minute and points per shot.

| segment | cut | events | pts_big | prior_avg_big | d_minutes | d_FGA | d_FTA | d_3PA | d_usage_pp | d_TS_pp | share_minutes | share_shot_rate | share_efficiency | mean_margin | OT | close | opp_foul_trouble |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| all | 1.25x | 11871 | 22.0 | 13.7 | +4.0 (other -1.3) | +3.8 (other -1.3) | +1.3 | +1.5 | +3.6 | +12.1 | 28% | 35% | 37% | +1.8 | 6.3% | 26.4% | 32% |
| all | 1.5x | 6529 | 23.3 | 12.7 | +5.2 (other -0.7) | +4.8 (other -0.7) | +1.7 | +2.0 | +4.6 | +14.7 | 29% | 36% | 35% | +1.8 | 6.8% | 26.8% | 32% |
| all | 2.0x | 1757 | 26.1 | 11.2 | +7.6 (other -0.1) | +6.8 (other -0.1) | +2.3 | +2.9 | +6.2 | +18.6 | 31% | 37% | 32% | +1.6 | 8.0% | 26.8% | 32% |
| all | +10 | 3313 | 29.7 | 15.6 | +5.6 (other -0.2) | +6.2 (other -0.4) | +2.4 | +2.6 | +5.9 | +15.9 | 27% | 39% | 34% | +2.8 | 9.0% | 29.4% | 35% |
| top100 | 1.25x | 4037 | 28.9 | 19.0 | +3.0 (other -1.0) | +4.2 (other -1.3) | +1.7 | +1.6 | +4.1 | +11.1 | 21% | 39% | 40% | +3.1 | 8.3% | 29.5% | 35% |
| top100 | 1.5x | 1768 | 31.5 | 18.0 | +3.9 (other -0.5) | +5.7 (other -0.6) | +2.5 | +2.3 | +5.5 | +14.2 | 21% | 41% | 38% | +3.4 | 9.9% | 30.7% | 36% |
| top100 | 2.0x | 273 | 36.1 | 16.2 | +6.0 (other -0.1) | +8.4 (other -0.1) | +3.8 | +3.4 | +8.1 | +18.6 | 23% | 42% | 35% | +3.9 | 13.9% | 31.5% | 34% |
| top100 | +10 | 1598 | 34.6 | 20.1 | +3.9 (other -0.4) | +6.1 (other -0.6) | +2.7 | +2.4 | +5.9 | +13.7 | 20% | 42% | 37% | +3.6 | 11.3% | 32.9% | 37% |
| top50 | 1.25x | 1839 | 33.3 | 22.4 | +2.8 (other -0.8) | +4.6 (other -1.3) | +2.0 | +1.7 | +4.5 | +10.3 | 19% | 42% | 39% | +4.0 | 8.9% | 30.9% | 39% |
| top50 | 1.5x | 698 | 37.1 | 21.6 | +3.6 (other -0.4) | +6.4 (other -0.6) | +3.1 | +2.5 | +6.4 | +13.6 | 18% | 44% | 38% | +4.7 | 10.6% | 31.5% | 41% |
| top50 | 2.0x | 80 | 43.7 | 20.0 | +5.3 (other -0.1) | +9.1 (other -0.1) | +4.9 | +3.2 | +8.8 | +20.1 | 19% | 42% | 39% | +4.3 | 15.0% | 31.2% | 49% |
| top50 | +10 | 875 | 37.7 | 22.9 | +3.4 (other -0.4) | +6.2 (other -0.7) | +2.9 | +2.3 | +6.1 | +12.4 | 18% | 44% | 37% | +4.2 | 11.1% | 33.1% | 41% |

Reading: for all players the 1.5x excess splits about evenly between minutes, shooting volume per minute and efficiency; for the top 50 the minutes share is smaller (they already play 34+ minutes) and the shot-rate share is the largest. Overtime is 6.8% of 1.5x nights vs 4.1% of other games. Blowout losses are the one game script that goes with far fewer big nights (the star sits); close games and a high combined score go with more. Opposing starters in foul trouble (5+ fouls) show a modest lift (9.5% vs 7.5% of games reach +10, RR 1.27). Referee, injury-during-game and garbage-time detail is not in the data.

**Foul-trouble data check.** Per-player personal fouls (`pf`) are in the full box score for every played row (2023-24 to 2026-27), so opposing starters' foul trouble is measured directly (starters with >= 5 PF; the team-level PF >= 25 flag is the second view). Not available: who guarded whom, referee crews, the minute at which a player got into foul trouble, and whether the opposing starter then sat.

## 6. Models: logistic vs boosting (date-split test)

Train on earlier dates, test on the last ~20% of dates of each timespan. `controls` = prior average, volatility, usage, minutes, progress, start rate, position only. `pregame` = controls + all Lens A terms. `boosting` = LightGBM on the same pregame inputs (continuous versions). `same-game` = controls + Lens B terms: **explanatory, not a forecast**. AUC with 95% player-cluster bootstrap CI; Brier and log-loss in the mart. d = AUC gain vs the reference model with its CI.

**all**, pooled 2023-24 to 2025-26:

| cut | test_events | controls | pregame | pregame_gain | boosting | boosting_vs_pregame | boosting_kept | pregame_logloss | boosting_logloss | same_game_AUC_explanatory |
|---|---|---|---|---|---|---|---|---|---|---|
| 1.25x | 2509 | 0.600 [0.583, 0.620] | 0.653 [0.637, 0.672] | +0.053 [+0.038, +0.068] | 0.653 | +0.001 [-0.006, +0.006] | no | 0.5713 | 0.5710 | 0.990 |
| 1.5x | 1381 | 0.657 [0.637, 0.681] | 0.699 [0.682, 0.721] | +0.042 [+0.031, +0.057] | 0.704 | +0.005 [-0.001, +0.012] | no | 0.4046 | 0.4024 | 0.993 |
| 2.0x | 407 | 0.738 [0.712, 0.765] | 0.787 [0.760, 0.811] | +0.049 [+0.035, +0.063] | 0.798 | +0.012 [+0.004, +0.020] | yes | 0.1640 | 0.1617 | 0.997 |
| +5 | 1909 | 0.518 [0.499, 0.535] | 0.623 [0.605, 0.640] | +0.105 [+0.083, +0.127] | 0.628 | +0.006 [-0.002, +0.014] | no | 0.5109 | 0.5088 | 0.989 |
| +10 | 651 | 0.537 [0.512, 0.562] | 0.655 [0.630, 0.674] | +0.118 [+0.088, +0.144] | 0.661 | +0.006 [-0.006, +0.021] | no | 0.2561 | 0.2552 | 0.995 |
| z>=1.5 | 741 | 0.553 [0.531, 0.578] | 0.658 [0.637, 0.678] | +0.104 [+0.079, +0.129] | 0.669 | +0.012 [+0.001, +0.022] | no | 0.2807 | 0.2785 | 0.994 |

**top100**, pooled 2023-24 to 2025-26:

| cut | test_events | controls | pregame | pregame_gain | boosting | boosting_vs_pregame | boosting_kept | pregame_logloss | boosting_logloss | same_game_AUC_explanatory |
|---|---|---|---|---|---|---|---|---|---|---|
| 1.25x | 617 | 0.595 [0.550, 0.634] | 0.630 [0.590, 0.658] | +0.035 [+0.016, +0.051] | 0.617 | -0.013 [-0.023, -0.001] | no | 0.5015 | 0.5056 | 0.992 |
| 1.5x | 254 | 0.654 [0.611, 0.698] | 0.671 [0.632, 0.712] | +0.017 [-0.005, +0.036] | 0.657 | -0.013 [-0.030, +0.001] | no | 0.2835 | 0.2854 | 0.996 |
| 2.0x | 40 | 0.791 [0.709, 0.868] | 0.792 [0.700, 0.870] | +0.002 [-0.047, +0.042] | 0.810 | +0.017 [-0.009, +0.040] | no | 0.0639 | 0.0632 | 1.000 |
| +5 | 616 | 0.534 [0.497, 0.565] | 0.587 [0.559, 0.615] | +0.052 [+0.026, +0.076] | 0.577 | -0.010 [-0.027, +0.009] | no | 0.5076 | 0.5118 | 0.992 |
| +10 | 226 | 0.524 [0.492, 0.556] | 0.602 [0.566, 0.639] | +0.078 [+0.036, +0.117] | 0.581 | -0.021 [-0.048, +0.004] | no | 0.2676 | 0.2699 | 0.996 |
| z>=1.5 | 202 | 0.600 [0.549, 0.643] | 0.632 [0.585, 0.671] | +0.032 [-0.001, +0.064] | 0.623 | -0.009 [-0.037, +0.020] | no | 0.2418 | 0.2472 | 0.997 |

**top50**, pooled 2023-24 to 2025-26:

| cut | test_events | controls | pregame | pregame_gain | boosting | boosting_vs_pregame | boosting_kept | pregame_logloss | boosting_logloss | same_game_AUC_explanatory | note |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1.25x | 277 | 0.593 [0.553, 0.646] | 0.639 [0.592, 0.682] | +0.046 [+0.023, +0.073] | 0.613 | -0.026 [-0.049, -0.008] | no | 0.4641 | 0.4729 | 0.996 |  |
| 1.5x | 100 | 0.649 [0.574, 0.718] | 0.652 [0.576, 0.721] | +0.003 [-0.043, +0.038] | 0.628 | -0.024 [-0.068, +0.015] | no | 0.2357 | 0.2404 | 0.998 |  |
| 2.0x |  |  |  |  |  |  |  |  |  |  | not scored (too few test events) |
| +5 | 320 | 0.541 [0.500, 0.579] | 0.598 [0.560, 0.637] | +0.057 [+0.023, +0.087] | 0.575 | -0.022 [-0.053, +0.009] | no | 0.5079 | 0.5162 | 0.995 |  |
| +10 | 123 | 0.540 [0.489, 0.593] | 0.594 [0.540, 0.662] | +0.054 [+0.013, +0.107] | 0.564 | -0.030 [-0.088, +0.014] | no | 0.2812 | 0.2838 | 0.997 |  |
| z>=1.5 | 101 | 0.606 [0.548, 0.683] | 0.652 [0.597, 0.733] | +0.046 [-0.005, +0.082] | 0.613 | -0.039 [-0.093, +0.000] | no | 0.2362 | 0.2416 | 0.996 |  |

**Does boosting earn its place? Rarely.** It beats the pregame logistic on the date-split test (gain >= 0.005 AUC, CI above 0, lower log-loss CI and Brier) in 2 of 173 scored cells: x200 / all / pooled_2023_27, x200 / all / pooled_2023_26. Only the all-players 2.0x cut qualifies (pooled 2023-24 to 2025-26 AUC gain 0.012, CI [0.004, 0.020]); in the top-100 and top-50 cells it is no better and often worse than the logistic. **Linear is enough** everywhere else. SHAP for the kept model (mean |SHAP|, pooled 2023-24 to 2025-26): lavg 0.54, out_ppg 0.22, cv 0.21, opp_def_u 0.10, min_trend_l5 0.09, opp_pace_u 0.08, out_max_ppg 0.08, usg 0.07. The prior average dominates; the vacuum input (`out_ppg`) and volatility come next, then opponent defence and pace, the other vacuum measure and the minutes trend: the same families the logistic picks out.

**Why AUC stays low.** The big-night cuts depend mostly on within-player noise in a game; the controls-only model already reaches 0.54 to 0.74 (it knows the player's average and volatility), and all the pregame context adds about 0.04 to 0.12. For top-50 stars the pregame model adds nothing credible for 1.5x (0.003 [-0.043, 0.038]) and only a small gain for +10 (0.054 [0.013, 0.107]).

## 7. Stars vs non-stars

Star = top 50 by PPG (train-period ranks), non-star = everyone else with a prior average of 8+; top 100 gives the same answer and top 25 / top 10 are thin (the mart carries them, flagged).

**Base rates** (std baseline, floor 8, pooled 2023-24 to 2025-26):

| cut | star_rate | non_star_rate | difference_pp | star_events | non_star_events |
|---|---|---|---|---|---|
| 1.25x | 22.5% [20.9%, 24.1%] | 30.5% [29.7%, 31.2%] | -7.9 [-9.7, -6.2] | 1839 | 10060 |
| 1.5x | 8.5% [7.5%, 9.6%] | 17.7% [17.1%, 18.4%] | -9.2 [-10.4, -7.9] | 698 | 5848 |
| 2.0x | 1.0% [0.7%, 1.3%] | 5.1% [4.7%, 5.5%] | -4.1 [-4.6, -3.6] | 80 | 1684 |
| +5 | 25.6% [24.4%, 26.7%] | 21.7% [21.1%, 22.4%] | +3.9 [+2.5, +5.2] | 2087 | 7166 |
| +10 | 10.7% [9.8%, 11.6%] | 7.4% [7.0%, 7.8%] | +3.3 [+2.3, +4.3] | 875 | 2447 |
| z>=1.5 | 8.7% [8.0%, 9.4%] | 9.6% [9.3%, 10.0%] | -0.9 [-1.7, -0.2] | 710 | 3179 |

Relative cuts (1.25x, 1.5x, 2.0x) are much harder for high-average players; absolute cuts (+5, +10) are slightly *easier* for them (more shots, more variance in points). So the question 'do stars have more big nights?' has opposite answers depending on the definition.

**1.5x: factor lift for stars vs non-stars (raw RR, pooled-segment comparison; RR ratio > 1 = bigger relative lift for stars):**

| factor | star_RR | non_star_RR | RR_ratio | star_pp | non_star_pp | pp_diff |
|---|---|---|---|---|---|---|
| last game below 0.75x average | 1.01 [0.85, 1.21] | 0.81 [0.77, 0.86] | 1.25 [1.04, 1.51] | +0.1 | -3.5 | +3.7 [+1.9, +5.5] |
| last 2 games both below 0.75x | 0.96 [0.71, 1.30] | 0.77 [0.70, 0.84] | 1.25 [0.91, 1.71] | -0.4 | -4.3 | +3.9 [+1.1, +6.7] |
| last game at least 1.25x average | 1.16 [0.95, 1.42] | 1.39 [1.32, 1.46] | 0.84 [0.68, 1.03] | +1.3 | +6.1 | -4.8 [-6.9, -2.6] |
| last-5 average at least 1.15x season average | 1.49 [1.17, 1.89] | 1.50 [1.41, 1.60] | 0.99 [0.77, 1.27] | +3.9 | +7.8 | -3.9 [-6.9, -0.9] |
| opponent worst-10 defence | 1.17 [1.00, 1.37] | 1.15 [1.09, 1.20] | 1.02 [0.87, 1.20] | +1.4 | +2.5 | -1.1 [-2.7, +0.6] |
| opponent best-10 defence | 0.82 [0.71, 0.94] | 0.86 [0.82, 0.91] | 0.95 [0.81, 1.10] | -1.7 | -2.6 | +0.9 [-0.6, +2.3] |
| opponent fastest-10 pace | 1.31 [1.16, 1.49] | 1.14 [1.08, 1.19] | 1.16 [1.01, 1.32] | +2.4 | +2.3 | +0.1 [-1.3, +1.6] |
| opponent slowest-10 pace | 0.73 [0.63, 0.84] | 0.91 [0.87, 0.96] | 0.80 [0.68, 0.93] | -2.6 | -1.6 | -1.0 [-2.4, +0.4] |
| own 2nd night of a back-to-back | 1.02 [0.83, 1.24] | 1.09 [1.03, 1.16] | 0.93 [0.76, 1.15] | +0.1 | +1.6 | -1.5 [-3.5, +0.6] |
| home | 0.88 [0.75, 1.03] | 1.07 [1.02, 1.12] | 0.83 [0.70, 0.97] | -1.1 | +1.1 | -2.2 [-3.8, -0.6] |
| opponent last-5 DRtg 3+ worse than its season | 0.89 [0.73, 1.07] | 1.03 [0.98, 1.09] | 0.86 [0.71, 1.05] | -1.0 | +0.5 | -1.5 [-3.4, +0.3] |
| regulars out: 20+ prior PPG | 1.93 [1.61, 2.31] | 1.88 [1.75, 2.02] | 1.03 [0.84, 1.25] | +6.1 | +11.2 | -5.1 [-7.3, -2.9] |
| team's top scorer out | 1.80 [1.49, 2.17] | 1.70 [1.59, 1.81] | 1.06 [0.87, 1.29] | +6.4 | +10.7 | -4.3 [-7.2, -1.4] |
| last-5 minutes 3+ above season | 1.64 [1.22, 2.20] | 1.56 [1.46, 1.66] | 1.05 [0.78, 1.42] | +5.3 | +9.1 | -3.8 [-8.1, +0.4] |
| early season (Oct-Nov) | 1.14 [0.95, 1.38] | 1.01 [0.94, 1.09] | 1.13 [0.92, 1.38] | +1.2 | +0.2 | +0.9 [-1.2, +3.0] |

**+10: factor lift for stars vs non-stars (raw RR, pooled-segment comparison; RR ratio > 1 = bigger relative lift for stars):**

| factor | star_RR | non_star_RR | RR_ratio | star_pp | non_star_pp | pp_diff |
|---|---|---|---|---|---|---|
| last game below 0.75x average | 1.00 [0.84, 1.19] | 0.69 [0.63, 0.76] | 1.45 [1.20, 1.76] | +0.0 | -2.5 | +2.6 [+0.6, +4.5] |
| last 2 games both below 0.75x | 0.94 [0.70, 1.28] | 0.57 [0.48, 0.67] | 1.67 [1.18, 2.35] | -0.6 | -3.4 | +2.8 [-0.4, +5.9] |
| last game at least 1.25x average | 1.14 [0.97, 1.33] | 1.48 [1.36, 1.62] | 0.77 [0.64, 0.92] | +1.4 | +3.1 | -1.7 [-3.6, +0.3] |
| last-5 average at least 1.15x season average | 1.39 [1.14, 1.68] | 1.47 [1.33, 1.62] | 0.95 [0.76, 1.18] | +3.9 | +3.1 | +0.9 [-1.8, +3.6] |
| opponent worst-10 defence | 1.17 [1.04, 1.32] | 1.20 [1.11, 1.29] | 0.98 [0.85, 1.12] | +1.7 | +1.4 | +0.3 [-1.1, +1.8] |
| opponent best-10 defence | 0.81 [0.71, 0.92] | 0.79 [0.73, 0.87] | 1.02 [0.87, 1.19] | -2.2 | -1.6 | -0.6 [-2.0, +0.9] |
| opponent fastest-10 pace | 1.30 [1.18, 1.44] | 1.22 [1.13, 1.31] | 1.07 [0.94, 1.21] | +2.9 | +1.5 | +1.4 [+0.1, +2.7] |
| opponent slowest-10 pace | 0.75 [0.67, 0.85] | 0.89 [0.82, 0.96] | 0.85 [0.73, 0.98] | -2.9 | -0.9 | -2.0 [-3.3, -0.7] |
| own 2nd night of a back-to-back | 1.07 [0.90, 1.27] | 1.15 [1.05, 1.27] | 0.93 [0.76, 1.13] | +0.7 | +1.1 | -0.4 [-2.4, +1.7] |
| home | 0.87 [0.76, 1.00] | 1.09 [1.00, 1.18] | 0.80 [0.68, 0.94] | -1.4 | +0.6 | -2.1 [-3.7, -0.5] |
| opponent last-5 DRtg 3+ worse than its season | 0.96 [0.80, 1.15] | 1.04 [0.95, 1.14] | 0.92 [0.75, 1.12] | -0.5 | +0.3 | -0.8 [-2.8, +1.3] |
| regulars out: 20+ prior PPG | 1.70 [1.46, 1.99] | 2.30 [2.06, 2.58] | 0.74 [0.61, 0.90] | +6.1 | +6.0 | +0.0 [-1.9, +2.0] |
| team's top scorer out | 1.48 [1.23, 1.78] | 1.94 [1.75, 2.15] | 0.76 [0.62, 0.94] | +4.9 | +5.7 | -0.8 [-3.7, +2.1] |
| last-5 minutes 3+ above season | 1.51 [1.24, 1.84] | 1.54 [1.38, 1.72] | 0.98 [0.78, 1.23] | +5.3 | +3.7 | +1.6 [-1.7, +4.9] |
| early season (Oct-Nov) | 1.11 [0.91, 1.35] | 1.08 [0.96, 1.21] | 1.03 [0.82, 1.29] | +1.1 | +0.5 | +0.6 [-1.8, +2.9] |

**Interaction tests** (logistic with controls + factor + star + factor x star, player-clustered; BH q within cut):

| cut | factors_tested | p_lt_05 | expected_by_chance | q_lt_10 | significant |
|---|---|---|---|---|---|
| 1.5x | 28 | 4 | 1.4 | 2 | bb_last1 (interaction OR 1.36 [1.10, 1.67]), pace_slow10 (interaction OR 0.78 [0.66, 0.93]) |
| +10 | 28 | 7 | 1.4 | 4 | bb_last1 (interaction OR 1.51 [1.22, 1.87]), bb_last2 (interaction OR 1.76 [1.20, 2.58]), hot_last1 (interaction OR 0.77 [0.63, 0.94]), home (interaction OR 0.78 [0.66, 0.94]) |
| z>=1.5 | 28 | 4 | 1.4 | 0 |  |
| 1.25x | 28 | 5 | 1.4 | 1 | bb_last1 (interaction OR 1.25 [1.09, 1.44]) |
| +5 | 28 | 6 | 1.4 | 1 | bb_last1 (interaction OR 1.25 [1.09, 1.44]) |

**Verdict.** *Mostly the same mechanisms, different recent-form behaviour, and a different base rate.* (1) Defence-tier ratios are indistinguishable between stars and non-stars (worst-10 RR 1.17 vs 1.15 for 1.5x), and so is the teammates-out ratio at 1.5x (RR 1.93 vs 1.88). At +10 the teammates-out ratio is smaller for stars (RR 1.70 vs 2.30, ratio 0.74 [0.61, 0.90]) although the absolute effect is the same, about +6 pp (stars +6.1, non-stars +6.0). At 1.5x the vacuum adds about 6 pp for stars and 11 pp for non-stars, mostly because non-stars have the higher base rate. (2) Recent form differs: for non-stars a weak last game goes with fewer big nights (RR 0.69 for +10, 0.81 for 1.5x) and a hot last game with more (RR 1.48 / 1.39); stars show no weak-game penalty (RR 1.00 / 1.01) and a smaller hot-game lift that is not credible on its own (1.14 [0.97, 1.33] / 1.16 [0.95, 1.42]). The bounce-back difference is credible (RR ratio 1.45 [1.20, 1.76] for +10, 1.25 [1.04, 1.51] for 1.5x; +10 interaction q about 0.005). (3) Stars have a small big-night deficit at home (RR 0.87 to 0.88 vs 1.07 to 1.09 for non-stars; +10 interaction OR 0.78 [0.66, 0.94], q about 0.07) and a larger slow-pace penalty (RR 0.73 to 0.75 vs 0.89 to 0.91): leads that survive the 28-test correction only borderline, not findings. (4) Across 28 factor interactions per cut, 4 to 7 reach p < 0.05 vs 1.4 expected by chance, clustering on bounce-back, hot game, home and slow pace; the rest are flat. So: **the same pregame levers move both groups; stars simply do not show the hot-hand / bounce-back dependence that non-stars show.**

## 8. Per-player patterns (shrunk; only where credible)

Two views, each shrunk with DerSimonian-Laird (between-player variance tau) plus empirical Bayes. **(a) Propensity vs expected:** observed big nights minus the number expected from a controls-only model (prior average, volatility, usage, minutes, progress, start rate, position): does this player have big nights more often than players with the same average and volatility? **(b) Condition splits:** the player's big-night rate in a condition minus his rate outside it (teammates out 10+ PPG, after a weak game, vs bottom-10 defences, home, 2nd night of a back-to-back, after a hot game), min 10 games per side. Players need 40+ eligible games (pooled spans) at a prior average of 8+; 'credible' = the shrunk 95% interval (player-specific evidence only) excludes the league mean; 'flagged' = |z| >= 2.5 or BH q < 0.10. **Expected by chance** is computed under the null that every player is the league mean: 1.2% of players beyond |z| >= 2.5 and 5% beyond p < 0.05.

| analysis | cut | players | league_mean_pp | tau_pp | abs_z_ge_2_5 | expected_by_chance | p_lt_05 | expected_p_lt_05 | q_lt_10 | credible_above | credible_below | credible_above_in_top50 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| propensity_vs_expected | x150 | 309 | +0.2 | 2.6 | 20 | 3.8 | 41 | 15.5 | 8 | 6 | 0 | 1 |
| propensity_vs_expected | p10 | 309 | -0.1 | 1.7 | 14 | 3.8 | 30 | 15.5 | 1 | 3 | 0 | 0 |
| propensity_vs_expected | z15 | 309 | +0.2 | 1.8 | 13 | 3.8 | 34 | 15.5 | 3 | 2 | 0 | 0 |
| teammates_out_10plus | x150 | 310 | +5.7 | 5.0 | 17 | 3.8 | 32 | 15.5 | 9 | 5 | 4 | 0 |
| teammates_out_10plus | p10 | 310 | +3.9 | 1.9 | 5 | 3.8 | 19 | 15.5 | 3 | 0 | 0 | 0 |
| teammates_out_10plus | z15 | 310 | +4.2 | 2.3 | 5 | 3.8 | 20 | 15.5 | 1 | 0 | 1 | 0 |
| bounce_back_last1 | x150 | 322 | -3.0 | 2.4 | 10 | 4.0 | 21 | 16.1 | 0 | 0 | 0 | 0 |
| bounce_back_last1 | p10 | 322 | -2.4 | 0.0 | 2 | 4.0 | 11 | 16.1 | 0 | 0 | 0 | 0 |
| bounce_back_last1 | z15 | 322 | -3.0 | 0.0 | 3 | 4.0 | 10 | 16.1 | 0 | 0 | 0 | 0 |
| vs_worst10_defence | x150 | 326 | +1.6 | 1.4 | 4 | 4.0 | 15 | 16.3 | 0 | 0 | 0 | 0 |
| vs_worst10_defence | p10 | 326 | +0.7 | 0.0 | 2 | 4.0 | 6 | 16.3 | 0 | 0 | 0 | 0 |
| vs_worst10_defence | z15 | 326 | +0.9 | 0.0 | 5 | 4.0 | 14 | 16.3 | 0 | 0 | 0 | 0 |
| home | x150 | 342 | +0.4 | 1.8 | 5 | 4.2 | 22 | 17.1 | 0 | 0 | 0 | 0 |
| home | p10 | 342 | +0.3 | 0.6 | 5 | 4.2 | 15 | 17.1 | 0 | 0 | 0 | 0 |
| home | z15 | 342 | +0.5 | 0.4 | 2 | 4.2 | 21 | 17.1 | 0 | 0 | 0 | 0 |
| b2b_2nd | x150 | 279 | -0.9 | 3.0 | 7 | 3.5 | 22 | 14.0 | 0 | 0 | 0 | 0 |
| b2b_2nd | p10 | 279 | -0.6 | 0.0 | 3 | 3.5 | 9 | 14.0 | 0 | 0 | 0 | 0 |
| b2b_2nd | z15 | 279 | -1.1 | 0.0 | 4 | 3.5 | 13 | 14.0 | 0 | 0 | 0 | 0 |
| hot_last1 | x150 | 326 | +2.3 | 3.9 | 10 | 4.0 | 26 | 16.3 | 0 | 0 | 0 | 0 |
| hot_last1 | p10 | 326 | +1.0 | 1.5 | 6 | 4.0 | 23 | 16.3 | 0 | 0 | 0 | 0 |
| hot_last1 | z15 | 326 | +0.6 | 1.5 | 5 | 4.0 | 16 | 16.3 | 0 | 0 | 0 | 0 |

**Players credibly above the league on 1.5x big nights given their average and volatility** (pooled 2023-24 to 2025-26; observed vs expected big nights, shrunk difference in pp per game with 95% interval):

| player | games | observed | expected | shrunk_pp | q | top50 | top100 |
|---|---|---|---|---|---|---|---|
| OG Anunoby | 176 | 38 | 20.8 | +5.4 [+1.9, +8.9] | 0.023 |  | yes |
| Deni Avdija | 195 | 42 | 25.0 | +4.9 [+1.5, +8.3] | 0.035 |  | yes |
| Jamal Murray | 185 | 29 | 16.5 | +4.2 [+1.0, +7.4] | 0.098 | yes | yes |
| Payton Pritchard | 169 | 39 | 24.9 | +4.2 [+0.5, +7.9] | 0.098 |  |  |
| Anfernee Simons | 153 | 30 | 18.4 | +3.9 [+0.3, +7.5] | 0.159 |  | yes |
| Trey Murphy III | 160 | 26 | 15.7 | +3.7 [+0.2, +7.1] | 0.162 |  | yes |

**Teammates-out split, 1.5x: players whose response differs from the league average** (league mean is about +5.7 pp; rate with 10+ PPG of regulars out minus rate otherwise; shrunk):

| player | games_with | games_without | rate_with | rate_without | shrunk_pp | direction |
|---|---|---|---|---|---|---|
| Naji Marshall | 100 | 46 | 37.0% | 6.5% | +15.4 [+7.8, +23.1] | above league |
| Daniss Jenkins | 32 | 29 | 53.1% | 3.4% | +15.1 [+6.3, +23.8] | above league |
| Pelle Larsson | 41 | 22 | 41.5% | 0.0% | +14.8 [+6.3, +23.3] | above league |
| Spencer Dinwiddie | 91 | 39 | 29.7% | 2.6% | +14.8 [+7.3, +22.2] | above league |
| Quentin Grimes | 87 | 41 | 35.6% | 7.3% | +13.7 [+5.9, +21.6] | above league |
| Shai Gilgeous-Alexander | 92 | 111 | 2.2% | 3.6% | +0.1 [-4.4, +4.7] | below league |
| Jakob Poeltl | 51 | 84 | 9.8% | 25.0% | -2.2 [-9.9, +5.6] | below league |
| Tyrese Haliburton | 60 | 72 | 5.0% | 18.1% | -2.7 [-10.0, +4.6] | below league |
| Domantas Sabonis | 54 | 101 | 1.9% | 12.9% | -4.1 [-10.4, +2.2] | below league |

**Read.** (1) There is more spread in who has 1.5x nights than chance alone gives (20 players at |z| >= 2.5 vs 3.8 expected; tau about 2.6 pp), so a few role players are credibly more explosive than their numbers imply (OG Anunoby, Deni Avdija, Payton Pritchard, Jamal Murray, Anfernee Simons, Trey Murphy III at 1.5x). Only one of them is in the top 50 and **none in the top 25**: stars are not credibly more big-night-prone than players with the same average and volatility. A controls-only model can be misspecified for players with role changes, so read these as 'worth watching', not as traits. (2) For the specific conditions (rest, home, defence tier, bounce-back, hot game) the count of flagged players is at or below what chance gives and no player is credibly different from the league average. (3) The teammates-out split has real heterogeneity for 1.5x (tau about 5 pp, 5 players credibly more responsive, 4 credibly less) concentrated among role players who rise a lot when the team's scorers sit (Quentin Grimes, Naji Marshall, Spencer Dinwiddie, Pelle Larsson, Daniss Jenkins). No top-50 star is credibly more responsive than the league; four players are credibly *less* responsive (Shai Gilgeous-Alexander, Domantas Sabonis, Tyrese Haliburton, Jakob Poeltl), high-average players for whom a 1.5x night is rare, so this partly reflects the base-rate effect rather than the vacuum itself. 2026-27 per-player rows are provisional and have almost no credible cases (few games).

## 9. Caveats and data gaps

- Associational, not causal. Teammates out is a context variable, not a randomised condition: teams that lose scorers also change minutes, lineups and opponents' game plans.
- The baseline matters. Season-to-date averages lag role changes, so 'hot last game', 'minutes up' and 'promoted' look like effects against the std baseline and mostly vanish against the l10 baseline. The prior average is also noisy early in a season (the early-season adjusted effect of about +2.6 pp for 1.5x partly reflects that).
- Out is observed from the box score (inactive list or non-coach DNP) of the game itself. It is knowable at about tip-off but not days ahead; late scratches and game-time decisions are not separated, and a coach's-decision DNP is not counted.
- The 5-minute rule uses same-game minutes: players who play under 5 minutes are not in the denominator (they cannot have big nights).
- Segments use train-period PPG ranks, so top-N membership has no look-ahead but includes players who later changed role. Top 25 and top 10 have 25 and 10 players: always thin, descriptive only.
- 2026-27 is provisional (through Nov 9: ~106 1.5x events and few games per player once the 5-prior-game and opponent cold-start rules are applied). Pooled spans that include it carry the provisional flag.
- Lens B is an accounting identity with the points total: its lifts and the same-game model's AUC of 0.99 are not evidence of anything predictive.
- Not available: defender matchups, referee crews, betting lines and totals (the combined score is same-game), the pregame injury report (only the inactive list), shot quality or tracking data, play-by-play (so no 'minute of foul trouble').
- Multiple comparisons: about 50 factor levels x 6 cuts x 30 cells in the mart. Use the adjusted columns and the stability table, not single cells; interaction and per-player flags are reported with expected-by-chance counts.
- Logistic fits use player-clustered covariance; a few rare-event cells hit convergence warnings (the fits fall back to BFGS); cells that could not be fitted are logged in the manifest and left empty, never filled.

## 10. App insights (what App Builder could add or change)

1. **Usage-vacuum chip on tonight's game / player card** (add). When regular teammates averaging 20+ PPG together are out, a player's 1.5x big-night rate is 22.2% vs 11.4% (adjusted +6.6 pp [+5.5, +7.7]); +10 11.3% vs 5.5%. Show it only from the inactive list (about 30 minutes before tip), wording 'associated with'. Hide it for 2026-27-only views until there are more events.
2. **Say 'no bounce-back' plainly** (change). There is no bounce-back: after a weak last game the raw 1.5x rate is lower (RR 0.86 [0.82, 0.91]) and the adjusted odds ratio is 0.94 [0.87, 1.01] (no credible change); after two weak games the adjusted +10 odds are lower (OR 0.77). Stars show no weak-game or hot-game dependence at all. Do not present rebound-game or hot-streak chips as signals.
3. **Relabel hot-game / minutes-up as 'average is stale'** (change). The hot-game effect (RR 1.42 [1.35, 1.50]) collapses against the last-10 baseline (RR 1.08 [1.03, 1.14]). Offer a baseline toggle (season-to-date vs last 10) on any big-night chip and note that recent form is already in the last-10 number.
4. **Defence and pace tiers: small, with CIs, not 'stars feast on bad defences'** (change). Adjusted, bottom-10 defences add about +1.1 pp to 1.5x and top-10 defences take away -1.4 pp; fast opponents add +1.4 pp. The top-50 effect against bottom-10 defences is not credible (adjusted OR 1.00 [0.84, 1.20]) and unstable by season. Elite defences are the more reliable signal (fewer big nights).
5. **'What does not matter' strip** (add). Once the other factors are held fixed, home vs away, back-to-back and rest days, the opponent's recent defensive form, the opponent missing players, NBA Cup games and late season have no credible big-night effect (raw second-night and late-season lifts of +1.4 and +3.4 pp for 1.5x disappear after adjustment). A short 'tested, nothing there' list is a useful honest panel.
6. **'Role change in progress' flag** (add). Recent promotion to the starting five or last-5 minutes 3+ above the season average are associated with +2.5 to +3 pp of 1.5x big nights against the season-to-date baseline (not against the last-10 baseline): show as context for a player whose average is out of date, not as a forecast.
7. **Stars vs everyone toggle** (add). Top-50 players reach 1.5x 8.5% of games vs 17.7% for others but +10 10.7% vs 7.4%: say which definition. Defence-tier lifts and the 1.5x vacuum lift are the same ratio for both groups (the +10 vacuum ratio is smaller for stars, the +6 pp effect is the same); recent-form effects (hot game, weak game) exist for non-stars only.
8. **'How the night happened' bar on recaps (same game, labelled)** (add). For a big night show minutes / shots per minute / efficiency shares of the excess (all players about 28% / 36% / 35%; top 50 about 18% / 44% / 38%), plus extra minutes, FGA and TS% vs the player's norm. Label it 'how it happened, not a prediction'.
9. **Do not ship a pregame big-night probability** (change). Pregame AUC is 0.70 (1.5x) and 0.65 (+10), only 0.04 and 0.12 above a controls-only model; for top-50 stars the pregame factors add nothing credible for 1.5x. Show base rates by context bucket (prior-average tier x teammates-out) instead of a model score.
10. **Per-player big-night cards: credible cases only, with the chance count** (change). Show a player-specific big-night pattern only if the shrunk interval excludes the league mean, and print 'expected by chance' beside the count (20 players at |z| >= 2.5 vs 3.8 expected for 1.5x). No top-25 star qualifies; the credible ones are mostly role players (e.g. OG Anunoby, Deni Avdija, Payton Pritchard at 1.5x). Hide player flags for 2026-27.
11. **Mark 2026-27 provisional and hide thin cells** (change). 2026-27 has about 106 1.5x events so far (std baseline, 8+ PPG); top 25 / top 10 are always thin (25 / 10 players): show counts only, never a ranking.

## 11. Files

`data/marts/big_night_events.parquet` (one row per eligible player-game: baselines, SDs, 12 event flags, all Lens A / Lens B fields), `big_night_counts` (cut x floor x baseline x timespan x segment), `big_night_factor_lift` (RR / OR / pp with CIs, adjusted OR and pp for the model terms, thin and reportable flags), `big_night_models` (logistic terms for lens A and the lens-B identity model, with ORs, AMEs and ranks), `big_night_model_performance` (AUC / Brier / log-loss, paired CIs, boosting kept flag), `big_night_shap`, `big_night_same_game_profile`, `big_night_stars_vs_nonstars`, `big_night_stars_interactions`, `big_night_star_base_rates`, `big_night_player_patterns`, `big_night_player_summary`; manifest `data/marts/big_nights_manifest.json` (definitions, thresholds, cell logs, SHA-256 of each table). DuckDB: the same names as views in `data/marts/nba_phase1.duckdb`. App summary: `data/big_nights_summary.json` (new, not read by the app).
