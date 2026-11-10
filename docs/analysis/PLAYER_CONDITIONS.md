# PLAYER_CONDITIONS: which players respond to which conditions, and does it persist? (hoopstats)

Data through **2026-11-09**. One player x condition table over 28 conditions from every earlier study (home/away, back-to-back, rest days, opponent defence and pace tiers, opponent recent defensive form, teammates out, bounce-back, hot game, minutes and role trend, season phase), 5 outcomes (points minus the prior season-to-date average; big-night rates at 1.25x, 1.5x, 2.0x and +10), 5 segments (all, top 100 / 50 / 25 / 10 by PPG) and the 6 app timespans (2026-27 and pooled spans including it are **provisional**) plus one training span (2023-24 + 2024-25). Scripts: `scripts/python/player_conditions_{core,run,assemble,summary,report}.py`; marts `data/marts/player_conditions*.parquet` (DuckDB views of the same names in `data/marts/nba_phase1.duckdb`); App Builder summary `data/player_conditions_summary.json` (not wired into the app).

Language: effects are *associated with* a condition for that player, never caused by it. Eligibility, the 8 PPG floor on the prior season-to-date average, the 5-prior-game rule and the teammates-out definition are those of BIG_NIGHTS.md.

## 1. Headline: is any of it bettable?

**Short answer: almost none of it. Of 140 condition x outcome cells (all players), only 7 show player differences that persist out of sample (plus 2 that persist but are small or scale-driven: home +10, vac_large 2.0x), and all 7 belong to two related conditions, 'the team's top scorer is out' and 'a 20+ PPG teammate is out'. For every other condition (home/away, back-to-backs, rest, defence tier, pace, opponent form, bounce-back, hot game, minutes trend, role change, early vs late season) the player-specific effects either do not persist or only agree within a season; treat them as noise.** Stars (top 100 / 50) show no persistent player-specific condition effect at all, and for most conditions there are too few star-seasons to test it.

1. **What persists.** out_top1 (points vs prior avg, 1.25x, 1.5x, 2.0x, +10); vac_star (points vs prior avg, 1.5x). For the team's top scorer out (points vs prior average) the 2023-25 -> 2025-26 correlation of player effects is +0.39 [+0.17, +0.57] over 70 players (BH q 0.029); the odd-even within-season split gives +0.25 (Spearman-Brown +0.40). The calibration slope of next-period effects on this period's shrunk effects is 0.65 [0.20, 1.11] (1 = perfectly calibrated, 0 = noise). Real but moderate: the spread of true effects across players is about 1.4 points (EB tau) around a league mean of +2.0, and a player's raw estimate is only about 44% signal.
   Borderline across seasons (BH q between 0.05 and 0.10): vac_star points vs prior avg (q 0.097), out_top1 2.0x (q 0.097).
2. **Within-season only (do not carry across seasons):** b2b_1st, bb_last1, def_worst5, early_vs_late, home, hot_last1, min_up3, vac_any, vac_large, vac_star. Odd/even halves of the same seasons agree (they share the same teams, injury spells and schedule), but 2023-25 effects do not predict 2025-26 effects. This is consistent with team-situation effects, not stable player traits. Do not read it as bettable.
3. **Noise, or too thin to test, in every outcome:** def_best10, def_best5, min_dn3, opp_leaky_l1, opp_leaky_l5, opp_tight_l1, opp_tight_l5, pace_fast10, pace_slow10, rest_r2, rest_r3plus, role_demoted, role_promoted. Verdict counts over all 140 all-player cells: noise 76, within-season only 39, n too small 15, PERSISTENT 7, persistent (small/scale) 2, cross-season only 1.
4. **Flags vs chance.** Per condition the number of players whose shrunk effect differs credibly from the league mean is zero or near zero for most conditions (permutation expectation about 0.01); the largest counts are for the team's-top-scorer-out dev cell (10 strong + 16 watch vs 0.01 expected), a 20+ PPG teammate out, minutes-up and early-vs-late (section 4). Excess over chance is necessary but not sufficient: early_vs_late (points) has 12 vs-league flags against 0.00 expected, yet its cross-season correlation is -0.06: the flagged players are flagged within a season, not across seasons. Flags that say 'effect differs from zero' mostly restate a league-wide effect (every player is flagged when the league mean is clearly non-zero and tau is about 0); the player-specific statement is the **vs-league flag**.
5. **Do flags hold out of sample?** In the 2023-25 -> 2025-26 test, vs-league flags (strong or watch) in the persistent conditions: 20 flagged, sign repeated for 16 (80%; chance 50%), significance repeated for 1 (chance expectation 1% from the test season's own flag rate). In all other conditions: 17 flagged, sign repeated 9 (53%), significance repeated 0. A single held-out season has little power for per-player significance, so the sign is the fairer yardstick.
6. **Stars.** In top 100 / top 50 no condition x outcome cell is classified persistent (top100: noise 105, n too small 35; top50: noise 50, n too small 90); most star cells fail the n >= 30 paired-player requirement for the cross-season test (a star needs 10+ games on each side in 2025-26 alone). Top 25 / top 10 are always thin and are descriptive only.
7. **2026-27 (provisional).** At most 22 players have 3+ games on each side of any condition in 2026-27 and none for most; the extra out-of-sample check is empty for almost every cell (see section 6). It adds nothing yet.
8. **Not a betting model.** Effects are in points against the player's own prior average (or big-night rates), not against a sportsbook line; there are no lines in the data. A market that already prices 'top scorer out' league-wide would not be beaten by the league-wide part of the effect.

## 2. Method

**Rows.** The big-nights dataset (regular season, >= 5 minutes, >= 5 prior games this season and overall, opponent with >= 5 prior games) restricted to a prior season-to-date average of **8+ PPG** (all five outcomes then exist for every row). **Outcomes:** `dev` = points minus the prior season-to-date average; `x125`, `x150`, `x200` = points >= 1.25 / 1.5 / 2.0 x that average; `p10` = points >= average + 10. Rates are reported in percentage points (pp), dev in points.

**Conditions (28)** use the factor definitions of BIG_NIGHTS.md. The reference ('not in condition') is the complement for tiers and rest categories, 'rested' for back-to-back nights, 'no regular teammate out' for the vacuum conditions, the neutral band for opponent-form, minutes-trend and role conditions, and late season for the early-vs-late condition. Rest 0 days coincides with the second night of a back-to-back by construction; the conditions overlap and are not independent tests.

| condition | group | definition | games in condition | games in reference |
|---|---|---|---|---|
| home | venue | home game | 20,620 | 20,564 |
| b2b_2nd | rest | 2nd night of a back-to-back (vs rested) | 7,042 | 26,840 |
| b2b_1st | rest | 1st night of a back-to-back (vs rested) | 7,302 | 26,840 |
| rest_r0 | rest | 0 rest days (vs other rest) | 7,042 | 34,142 |
| rest_r1 | rest | 1 rest day (vs other rest) | 25,922 | 15,262 |
| rest_r2 | rest | 2 rest days (vs other rest) | 5,977 | 35,207 |
| rest_r3plus | rest | 3+ rest days (vs other rest) | 2,243 | 38,941 |
| def_worst5 | opp_defence | opponent worst-5 defence | 6,815 | 34,369 |
| def_worst10 | opp_defence | opponent worst-10 defence | 13,609 | 27,575 |
| def_best10 | opp_defence | opponent best-10 defence | 13,833 | 27,351 |
| def_best5 | opp_defence | opponent best-5 defence | 6,927 | 34,257 |
| pace_fast10 | opp_pace | opponent fastest-10 pace | 13,692 | 27,492 |
| pace_slow10 | opp_pace | opponent slowest-10 pace | 13,703 | 27,481 |
| opp_leaky_l5 | opp_form | opponent last-5 DRtg 3+ worse than its season (vs neutral band) | 12,319 | 19,712 |
| opp_tight_l5 | opp_form | opponent last-5 DRtg 3+ better than its season (vs neutral band) | 9,153 | 19,712 |
| opp_leaky_l1 | opp_form | opponent last-game DRtg 10+ worse (vs neutral band) | 8,204 | 26,066 |
| opp_tight_l1 | opp_form | opponent last-game DRtg 10+ better (vs neutral band) | 6,914 | 26,066 |
| vac_any | teammates_out | any regular teammate out (vs none) | 27,134 | 14,050 |
| vac_large | teammates_out | regulars out total 20+ prior PPG (vs none) | 14,654 | 14,050 |
| vac_star | teammates_out | a 20+ PPG teammate out (vs other) | 9,550 | 31,634 |
| out_top1 | teammates_out | team's top scorer out (vs other) | 8,077 | 33,107 |
| bb_last1 | bounce_back | after a weak last game (<0.75x avg) | 11,991 | 29,193 |
| hot_last1 | hot_game | after a hot last game (>=1.25x avg) | 11,979 | 29,205 |
| min_up3 | minutes_role | recent minutes trend up (last-5 3+ above season) | 7,122 | 29,020 |
| min_dn3 | minutes_role | recent minutes trend down (last-5 3+ below season) | 5,042 | 29,020 |
| role_promoted | minutes_role | recently promoted to the starting five | 2,976 | 36,827 |
| role_demoted | minutes_role | recently demoted from the starting five | 1,381 | 36,827 |
| early_vs_late | season_phase | early season (Oct-Nov) vs late season (Mar-Apr) | 7,164 | 11,924 |

(pooled 2023-24 to 2025-26, 8+ PPG floor: 41,184 player-games.)

**Per player effect.** In-condition mean minus reference mean, per player and timespan, with the **minimum n of 10 games on each side** (3 and 3 for 2026-27 and 5 and 5 for the within-season halves). The standard error uses the player's **pooled variance** over the games of both sides (for dev, the sample variance of dev; for events, the smoothed pooled rate (S+1)/(N+2)): sqrt(v (1/n_cond + 1/n_ref)). A pooled (null-based) variance does not depend on the sign of the difference; a per-side variance biases inverse-variance weighted league means for rare or skewed outcomes (we first used per-side variances and caught this with the permutation null, where the league mean came out 'significant' in most permutations).

**Empirical Bayes.** Per timespan x segment x condition x outcome: DerSimonian-Laird tau^2, random-effects league mean mu, shrunk effect theta = mu + B (d - mu) with B = tau^2 / (tau^2 + se^2), posterior SD sqrt(B se^2 + (1 - B)^2 var(mu)); 95% shrunk interval theta +/- 1.96 SD. **EB reliability** = tau^2 / (tau^2 + mean se^2). Segments with their own parameters: all, top 100, top 50 (>= 30 players). Top 25 and top 10 (thin) reuse the top 50 parameters and are marked thin.

**Flags (documented thresholds).** Both flags need the minimum n; a **strong** flag also needs **n >= 15 on both sides**.
- `flag` (effect differs from zero): **strong** = the shrunk 95% interval excludes 0 and n >= 15 on both sides; **watch** = the shrunk 90% interval excludes 0 (strong not met); else none. `flag_direction` = sign of the shrunk effect.
- `flag_vs_league` (player differs from the league mean; the player-specific statement): the same rule applied to theta - mu with posterior SD sqrt(B) * se.
- When tau is about 0 the shrunk estimates all equal mu and `flag` is simply a statement about the league mean, so read `flag_vs_league` for 'who responds differently'.

**Flagged vs chance.** Permutation null: 200 within-player shuffles of the condition labels (keeping each player's n on both sides), the whole pipeline (SE, tau, shrinkage, flags) recomputed each time. Expected counts are the permutation means; permutation p = (1 + #{null >= observed}) / 201. Because the shuffle removes the league-wide effect too, the null for `flag` is about 5% of players when the league effect would otherwise show; the null for `flag_vs_league` is about zero (shrinkage removes flags unless tau > 0).

**Persistence (the key test).** Player effects from period A are compared with the same effects in a later or held-out period B, for players eligible in both (min n each period), and each segment:
- `temporal`: A = 2023-24 + 2024-25 pooled, B = 2025-26 (held-out season).
- `odd_even`: odd vs even games (by within-season game number) of the pooled 2023-26 span, min n 5 per side per half; Spearman-Brown corrected r = 2r / (1 + r). Halves share teams, injuries and schedule, so this measures within-season consistency and **overstates cross-season persistence**.
- `random_halves`: mean of 20 random half splits of the games (same caveat; CI approximate because the splits overlap).
- `provisional_2026_27`: 2023-26 -> 2026-27 to date (tiny n).
Reported per condition x outcome x segment: Pearson r (Fisher 95% CI) and Spearman rho, EB reliabilities of each period on the paired players, the maximum r expected if effects were perfectly stable sqrt(rel_A rel_B), the disattenuated r, the calibration slope of B's raw effect on A's shrunk effect (WLS, HC1 interval), a partial r controlling for the player's overall rate of the outcome (guards against 'high-rate players have bigger pp effects'), and the flag hit rates (flags in A -> same-direction flag in B, vs a chance rate from B's own flag share; sign-only repeat vs 50%).
**Classification (all players).** `persistent` = temporal r > 0 with BH q < 0.10 (across the 28 x 5 cells) and odd-even r > 0 with q < 0.10; `cross_season_only`, `within_season_only` = only one of the two; `noise` = neither; `insufficient` = fewer than 30 paired players in either scheme; top 25 / top 10 = thin. **Verdict** `persistent signal` additionally needs the base-rate check (temporal partial r >= half the raw r) and a practical size (pooled EB reliability >= 0.10); otherwise 'persistent but small or scale-driven'.

**`held_out_of_sample` in the player table.** For a flagged player-condition-outcome row, the later period is: pooled 2023-25 -> 2025-26; 2023-24 -> 2024-25; 2024-25 -> 2025-26; 2025-26 and pooled 2023-26 -> 2026-27 (provisional); none for 2026-27 and pooled 2023-27. `held_out_of_sample` (for `flag`) and `held_vs_league` (for `flag_vs_league`) are true if the player has a strong or watch flag in the same direction in the later period, false if he is eligible there and does not, NA if the row is not flagged or he is not eligible in the later period; `held_sign_*` is the sign-only version. Segment-specific versions carry the segment suffix. Rows for the later period use that period's own EB.

## 3. League-level effect per condition (context)

Pooled 2023-24 to 2025-26, all players with the minimum n: the league mean effect (EB random-effects), the between-player SD of true effects tau, and the EB reliability. These are the part of the effect a market already knows; the player-specific part is tau.

| condition | points vs prior avg (pts): mean / tau / rel | 1.5x (pp): mean / tau / rel | +10 (pp): mean / tau / rel |
|---|---|---|---|
| home | +0.22 / 0.33 / 0.05 | +0.35 / 1.31 / 0.02 | +0.29 / 0.95 / 0.02 |
| b2b_2nd | +0.07 / 0.63 / 0.12 | +0.92 / 1.22 / 0.02 | +0.74 / 0.00 / 0.00 |
| b2b_1st | +0.05 / 0.00 / 0.00 | +0.31 / 1.33 / 0.02 | +0.25 / 0.00 / 0.00 |
| rest_r0 | +0.06 / 0.57 / 0.11 | +0.88 / 1.31 / 0.02 | +0.66 / 0.00 / 0.00 |
| rest_r1 | +0.03 / 0.00 / 0.00 | -0.44 / 0.00 / 0.00 | -0.31 / 0.00 / 0.00 |
| rest_r2 | -0.04 / 0.16 / 0.01 | +0.13 / 0.00 / 0.00 | +0.13 / 0.00 / 0.00 |
| rest_r3plus | +0.49 / 0.00 / 0.00 | +0.54 / 0.00 / 0.00 | +1.14 / 0.00 / 0.00 |
| def_worst5 | +0.67 / 0.81 / 0.19 | +2.66 / 4.62 / 0.20 | +1.17 / 0.86 / 0.02 |
| def_worst10 | +0.61 / 0.21 / 0.02 | +2.16 / 0.81 / 0.01 | +1.19 / 0.00 / 0.00 |
| def_best10 | -0.66 / 0.39 / 0.07 | -2.12 / 0.00 / 0.00 | -1.45 / 0.00 / 0.00 |
| def_best5 | -0.72 / 0.57 / 0.11 | -2.06 / 0.00 / 0.00 | -1.49 / 0.00 / 0.00 |
| pace_fast10 | +0.64 / 0.10 / 0.00 | +2.26 / 0.00 / 0.00 | +1.42 / 0.00 / 0.00 |
| pace_slow10 | -0.44 / 0.12 / 0.01 | -1.81 / 0.00 / 0.00 | -0.92 / 0.00 / 0.00 |
| opp_leaky_l5 | +0.09 / 0.00 / 0.00 | -0.07 / 0.00 / 0.00 | -0.03 / 0.00 / 0.00 |
| opp_tight_l5 | -0.16 / 0.00 / 0.00 | -0.17 / 0.00 / 0.00 | -0.37 / 0.00 / 0.00 |
| opp_leaky_l1 | +0.11 / 0.17 / 0.01 | -0.16 / 0.00 / 0.00 | +0.29 / 0.00 / 0.00 |
| opp_tight_l1 | -0.19 / 0.00 / 0.00 | -1.08 / 0.00 / 0.00 | -0.67 / 0.00 / 0.00 |
| vac_any | +1.44 / 0.90 / 0.29 | +5.13 / 3.03 / 0.12 | +3.21 / 0.00 / 0.00 |
| vac_large | +2.17 / 1.03 / 0.29 | +8.37 / 4.33 / 0.17 | +4.91 / 1.61 / 0.05 |
| vac_star | +1.85 / 1.35 / 0.43 | +7.16 / 5.93 / 0.30 | +4.60 / 3.99 / 0.27 |
| out_top1 | +2.04 / 1.44 / 0.44 | +8.29 / 6.95 / 0.35 | +4.77 / 4.38 / 0.29 |
| bb_last1 | -0.70 / 0.58 / 0.13 | -2.04 / 1.33 / 0.02 | -1.58 / 0.00 / 0.00 |
| hot_last1 | +0.90 / 0.72 / 0.19 | +3.28 / 3.82 / 0.15 | +2.01 / 2.42 / 0.12 |
| min_up3 | +1.29 / 1.17 / 0.32 | +5.68 / 6.78 / 0.30 | +2.74 / 3.52 / 0.19 |
| min_dn3 | -0.97 / 0.65 / 0.12 | -2.92 / 0.00 / 0.00 | -1.46 / 0.00 / 0.00 |
| role_promoted | +1.52 / 0.63 / 0.12 | +8.23 / 6.50 / 0.26 | +2.55 / 2.26 / 0.08 |
| role_demoted | -1.16 / 0.64 / 0.11 | -3.36 / 0.00 / 0.00 | -1.95 / 0.00 / 0.00 |
| early_vs_late | -0.09 / 1.47 / 0.37 | -0.55 / 4.01 / 0.12 | -0.25 / 1.63 / 0.04 |

## 4. Flagged players vs expected by chance

Pooled 2023-24 to 2025-26, all players. `vs league`: strong + watch counts and the permutation expectation (mean of 200 shuffles) with the permutation p of the strong count; `!= 0`: strong + watch counts and expectation (dominated by the league-wide effect when tau is about 0). Segment and timespan versions are in `player_conditions_summary`. The permutation expectation for `!= 0` is a mean of all-or-nothing outcomes (when tau is about 0 all players share the league mean and are flagged together in about 5-10% of shuffles), so it is not a typical count; read it only as the scale of the null.

**points vs prior avg**

| condition | players | vs league: strong+watch | expected | perm p (strong) | != 0: strong+watch | expected | persistence verdict |
|---|---|---|---|---|---|---|---|
| home | 342 | 0+0 | 0.01 | 1.000 | 0+0 | 25.7 | within-season only (not shown across seasons) |
| b2b_2nd | 279 | 0+0 | 0.02 | 1.000 | 0+0 | 16.8 | noise |
| b2b_1st | 285 | 0+0 | 0.00 | 1.000 | 0+0 | 15.7 | noise |
| rest_r0 | 279 | 0+0 | 0.01 | 1.000 | 0+0 | 18.1 | noise |
| rest_r1 | 331 | 0+0 | 0.01 | 1.000 | 0+0 | 16.6 | noise |
| rest_r2 | 262 | 0+0 | 0.00 | 1.000 | 0+0 | 26.2 | noise |
| rest_r3plus | 83 | 0+0 | 0.02 | 1.000 | 0+83 | 5.8 | not enough players |
| def_worst5 | 271 | 0+2 | 0.03 | 1.000 | 7+20 | 9.5 | within-season only (not shown across seasons) |
| def_worst10 | 326 | 0+0 | 0.01 | 1.000 | 299+27 | 8.2 | noise |
| def_best10 | 325 | 0+0 | 0.01 | 1.000 | 68+134 | 23.2 | noise |
| def_best5 | 272 | 0+0 | 0.02 | 1.000 | 11+38 | 10.9 | noise |
| pace_fast10 | 327 | 0+0 | 0.00 | 1.000 | 303+24 | 14.7 | noise |
| pace_slow10 | 324 | 0+0 | 0.01 | 1.000 | 305+19 | 17.8 | noise |
| opp_leaky_l5 | 312 | 0+0 | 0.00 | 1.000 | 0+0 | 17.2 | noise |
| opp_tight_l5 | 302 | 0+0 | 0.00 | 1.000 | 0+302 | 15.1 | noise |
| opp_leaky_l1 | 289 | 0+0 | 0.00 | 1.000 | 0+0 | 10.1 | noise |
| opp_tight_l1 | 272 | 0+0 | 0.00 | 1.000 | 222+50 | 19.1 | noise |
| vac_any | 295 | 1+1 | 0.01 | 0.005 | 137+63 | 14.7 | within-season only (not shown across seasons) |
| vac_large | 288 | 2+3 | 0.00 | 0.005 | 216+47 | 8.6 | within-season only (not shown across seasons) |
| vac_star | 281 | 11+17 | 0.01 | 0.005 | 116+47 | 9.9 | persistent signal |
| out_top1 | 265 | 10+16 | 0.01 | 0.005 | 112+48 | 14.6 | persistent signal |
| bb_last1 | 322 | 0+0 | 0.01 | 1.000 | 20+45 | 22.6 | within-season only (not shown across seasons) |
| hot_last1 | 326 | 0+1 | 0.01 | 1.000 | 44+56 | 21.2 | within-season only (not shown across seasons) |
| min_up3 | 229 | 2+4 | 0.01 | 0.005 | 53+30 | 11.5 | within-season only (not shown across seasons) |
| min_dn3 | 212 | 0+0 | 0.02 | 1.000 | 31+54 | 11.7 | noise |
| role_promoted | 110 | 0+0 | 0.03 | 1.000 | 73+37 | 4.5 | not enough players |
| role_demoted | 59 | 0+0 | 0.01 | 1.000 | 13+32 | 2.4 | not enough players |
| early_vs_late | 264 | 6+6 | 0.00 | 0.005 | 6+5 | 23.8 | within-season only (not shown across seasons) |

**1.5x**

| condition | players | vs league: strong+watch | expected | perm p (strong) | != 0: strong+watch | expected | persistence verdict |
|---|---|---|---|---|---|---|---|
| home | 342 | 0+0 | 0.00 | 1.000 | 0+0 | 25.7 | within-season only (not shown across seasons) |
| b2b_2nd | 279 | 0+0 | 0.00 | 1.000 | 0+0 | 14.0 | noise |
| b2b_1st | 285 | 0+0 | 0.01 | 1.000 | 0+0 | 15.7 | within-season only (not shown across seasons) |
| rest_r0 | 279 | 0+0 | 0.02 | 1.000 | 0+0 | 16.8 | noise |
| rest_r1 | 331 | 0+0 | 0.00 | 1.000 | 0+0 | 18.9 | noise |
| rest_r2 | 262 | 0+0 | 0.00 | 1.000 | 0+0 | 21.0 | noise |
| rest_r3plus | 83 | 0+0 | 0.09 | 1.000 | 0+0 | 3.9 | not enough players |
| def_worst5 | 271 | 1+0 | 0.03 | 0.010 | 9+7 | 10.9 | within-season only (not shown across seasons) |
| def_worst10 | 326 | 0+0 | 0.00 | 1.000 | 299+27 | 17.6 | cross-season only (not within season) |
| def_best10 | 325 | 0+0 | 0.00 | 1.000 | 303+22 | 19.5 | noise |
| def_best5 | 272 | 0+0 | 0.02 | 1.000 | 216+56 | 10.9 | noise |
| pace_fast10 | 327 | 0+0 | 0.01 | 1.000 | 303+24 | 13.1 | noise |
| pace_slow10 | 324 | 0+0 | 0.00 | 1.000 | 305+19 | 22.7 | noise |
| opp_leaky_l5 | 312 | 0+0 | 0.00 | 1.000 | 0+0 | 20.3 | noise |
| opp_tight_l5 | 302 | 0+0 | 0.01 | 1.000 | 0+0 | 22.7 | noise |
| opp_leaky_l1 | 289 | 0+0 | 0.00 | 1.000 | 0+0 | 14.5 | noise |
| opp_tight_l1 | 272 | 0+0 | 0.00 | 1.000 | 222+50 | 20.4 | noise |
| vac_any | 295 | 0+1 | 0.00 | 1.000 | 115+88 | 23.6 | within-season only (not shown across seasons) |
| vac_large | 288 | 0+0 | 0.00 | 1.000 | 171+76 | 15.8 | within-season only (not shown across seasons) |
| vac_star | 281 | 4+4 | 0.00 | 0.005 | 66+42 | 14.1 | persistent signal |
| out_top1 | 265 | 4+9 | 0.00 | 0.005 | 60+39 | 11.9 | persistent signal |
| bb_last1 | 322 | 0+0 | 0.01 | 1.000 | 0+61 | 19.3 | noise |
| hot_last1 | 326 | 0+0 | 0.01 | 1.000 | 8+27 | 24.5 | within-season only (not shown across seasons) |
| min_up3 | 229 | 2+6 | 0.01 | 0.005 | 22+25 | 13.8 | within-season only (not shown across seasons) |
| min_dn3 | 212 | 0+0 | 0.04 | 1.000 | 148+64 | 18.1 | noise |
| role_promoted | 110 | 2+0 | 0.03 | 0.005 | 18+22 | 7.2 | not enough players |
| role_demoted | 59 | 0+0 | 0.02 | 1.000 | 35+24 | 3.1 | not enough players |
| early_vs_late | 264 | 0+0 | 0.00 | 1.000 | 0+0 | 21.1 | within-season only (not shown across seasons) |

**+10**

| condition | players | vs league: strong+watch | expected | perm p (strong) | != 0: strong+watch | expected | persistence verdict |
|---|---|---|---|---|---|---|---|
| home | 342 | 0+0 | 0.00 | 1.000 | 0+0 | 20.5 | persistent but small or scale-driven |
| b2b_2nd | 279 | 0+0 | 0.00 | 1.000 | 226+53 | 18.1 | noise |
| b2b_1st | 285 | 0+0 | 0.00 | 1.000 | 0+0 | 8.6 | noise |
| rest_r0 | 279 | 0+0 | 0.00 | 1.000 | 0+279 | 22.3 | noise |
| rest_r1 | 331 | 0+0 | 0.00 | 1.000 | 0+0 | 31.4 | noise |
| rest_r2 | 262 | 0+0 | 0.00 | 1.000 | 0+0 | 14.4 | noise |
| rest_r3plus | 83 | 0+0 | 0.05 | 1.000 | 0+0 | 1.4 | not enough players |
| def_worst5 | 271 | 0+0 | 0.01 | 1.000 | 0+1 | 9.5 | noise |
| def_worst10 | 326 | 0+0 | 0.00 | 1.000 | 299+27 | 29.3 | noise |
| def_best10 | 325 | 0+0 | 0.00 | 1.000 | 303+22 | 21.0 | noise |
| def_best5 | 272 | 0+0 | 0.00 | 1.000 | 216+56 | 13.6 | noise |
| pace_fast10 | 327 | 0+0 | 0.00 | 1.000 | 303+24 | 22.9 | noise |
| pace_slow10 | 324 | 0+0 | 0.00 | 1.000 | 305+19 | 21.1 | noise |
| opp_leaky_l5 | 312 | 0+0 | 0.00 | 1.000 | 0+0 | 21.8 | noise |
| opp_tight_l5 | 302 | 0+0 | 0.00 | 1.000 | 0+0 | 19.6 | noise |
| opp_leaky_l1 | 289 | 0+0 | 0.00 | 1.000 | 0+0 | 18.8 | noise |
| opp_tight_l1 | 272 | 0+0 | 0.00 | 1.000 | 0+272 | 13.6 | noise |
| vac_any | 295 | 0+0 | 0.00 | 1.000 | 271+24 | 25.1 | within-season only (not shown across seasons) |
| vac_large | 288 | 0+0 | 0.00 | 1.000 | 258+30 | 23.0 | within-season only (not shown across seasons) |
| vac_star | 281 | 5+5 | 0.00 | 0.005 | 53+34 | 23.9 | within-season only (not shown across seasons) |
| out_top1 | 265 | 6+5 | 0.00 | 0.005 | 38+32 | 15.9 | persistent signal |
| bb_last1 | 322 | 0+0 | 0.00 | 1.000 | 299+23 | 40.2 | noise |
| hot_last1 | 326 | 0+1 | 0.00 | 1.000 | 6+13 | 32.6 | within-season only (not shown across seasons) |
| min_up3 | 229 | 0+0 | 0.00 | 1.000 | 6+12 | 10.3 | within-season only (not shown across seasons) |
| min_dn3 | 212 | 0+0 | 0.00 | 1.000 | 148+64 | 13.8 | noise |
| role_promoted | 110 | 0+0 | 0.00 | 1.000 | 2+3 | 3.3 | not enough players |
| role_demoted | 59 | 0+0 | 0.00 | 1.000 | 35+24 | 1.5 | not enough players |
| early_vs_late | 264 | 0+0 | 0.00 | 1.000 | 0+0 | 5.3 | within-season only (not shown across seasons) |

## 5. Persistence and reliability per condition x outcome

All players. `temporal` r is the correlation of player effects 2023-25 vs 2025-26 (n players, BH q for r > 0); `odd-even` r (Spearman-Brown in brackets); `random` r = mean of 20 random half splits; `EB rel` = tau^2 / (tau^2 + mean se^2) pooled 2023-26; `slope` = calibration slope of 2025-26 effects on 2023-25 shrunk effects (n/a when the shrunk effects have no spread).

**points vs prior avg**

| condition | temporal r [95% CI] (n) | odd-even r (SB) | random r | EB rel | slope [95% CI] | verdict |
|---|---|---|---|---|---|---|
| home | +0.11 [-0.03, +0.24] (195), q 0.34 | +0.11 (+0.19), n 337, q 0.08 | +0.01 | 0.05 | n/a | within-season only |
| b2b_2nd | +0.04 [-0.18, +0.25] (85), q 0.66 | +0.08 (+0.15), n 255, q 0.21 | +0.07 | 0.12 | -0.12 [-2.37, 2.12] | noise |
| b2b_1st | -0.17 [-0.35, +0.03] (104), q 0.98 | +0.01 (+0.01), n 255, q 0.68 | +0.02 | 0.00 | n/a | noise |
| rest_r0 | +0.05 [-0.16, +0.26] (85), q 0.63 | +0.06 (+0.12), n 255, q 0.31 | +0.07 | 0.11 | -0.05 [-2.13, 2.04] | noise |
| rest_r1 | -0.03 [-0.18, +0.11] (182), q 0.85 | -0.05 (-0.10), n 323, q 0.95 | -0.07 | 0.00 | n/a | noise |
| rest_r2 | +0.02 [-0.25, +0.28] (55), q 0.66 | -0.09 (-0.21), n 239, q 1.00 | +0.01 | 0.01 | -0.18 [-2.17, 1.81] | noise |
| rest_r3plus | n/a (0), q nan | -0.09 (-0.20), n 43, q 0.95 | -0.08 | 0.00 | n/a | n too small |
| def_worst5 | +0.02 [-0.20, +0.25] (78), q 0.66 | +0.16 (+0.27), n 246, q 0.03 | +0.08 | 0.19 | 1.19 [-0.89, 3.26] | within-season only |
| def_worst10 | +0.06 [-0.09, +0.20] (177), q 0.56 | +0.03 (+0.06), n 316, q 0.50 | +0.01 | 0.02 | n/a | noise |
| def_best10 | +0.06 [-0.09, +0.21] (176), q 0.54 | -0.01 (-0.02), n 316, q 0.79 | -0.01 | 0.07 | 1.41 [-0.03, 2.84] | noise |
| def_best5 | +0.15 [-0.07, +0.36] (83), q 0.35 | +0.06 (+0.12), n 248, q 0.31 | +0.06 | 0.11 | 0.76 [-0.45, 1.97] | noise |
| pace_fast10 | +0.02 [-0.13, +0.16] (175), q 0.66 | -0.03 (-0.06), n 320, q 0.93 | +0.01 | 0.00 | n/a | noise |
| pace_slow10 | -0.04 [-0.18, +0.11] (177), q 0.85 | -0.04 (-0.08), n 313, q 0.95 | +0.00 | 0.01 | n/a | noise |
| opp_leaky_l5 | +0.04 [-0.12, +0.20] (153), q 0.62 | -0.04 (-0.09), n 301, q 0.95 | -0.03 | 0.00 | n/a | noise |
| opp_tight_l5 | -0.08 [-0.25, +0.09] (138), q 0.92 | -0.02 (-0.04), n 290, q 0.88 | -0.01 | 0.00 | n/a | noise |
| opp_leaky_l1 | +0.07 [-0.13, +0.26] (102), q 0.57 | -0.06 (-0.13), n 274, q 0.97 | +0.02 | 0.01 | n/a | noise |
| opp_tight_l1 | -0.09 [-0.30, +0.14] (79), q 0.88 | +0.01 (+0.02), n 252, q 0.67 | -0.01 | 0.00 | n/a | noise |
| vac_any | +0.13 [-0.03, +0.29] (145), q 0.33 | +0.36 (+0.53), n 288, q 0.00 | +0.30 | 0.29 | 1.02 [0.00, 2.03] | within-season only |
| vac_large | +0.13 [-0.05, +0.31] (115), q 0.35 | +0.29 (+0.45), n 279, q 0.00 | +0.26 | 0.29 | 0.84 [0.04, 1.64] | within-season only |
| vac_star | +0.26 [+0.05, +0.45] (84), q 0.10 | +0.34 (+0.51), n 273, q 0.00 | +0.32 | 0.43 | 0.75 [0.18, 1.31] | **PERSISTENT** |
| out_top1 | +0.39 [+0.17, +0.57] (70), q 0.03 | +0.25 (+0.40), n 258, q 0.00 | +0.33 | 0.44 | 0.65 [0.20, 1.11] | **PERSISTENT** |
| bb_last1 | -0.02 [-0.17, +0.14] (160), q 0.77 | +0.18 (+0.31), n 315, q 0.00 | +0.13 | 0.13 | -0.07 [-1.00, 0.85] | within-season only |
| hot_last1 | -0.14 [-0.29, +0.03] (140), q 0.98 | +0.19 (+0.32), n 316, q 0.00 | +0.14 | 0.19 | -0.47 [-1.33, 0.38] | within-season only |
| min_up3 | +0.09 [-0.26, +0.41] (34), q 0.62 | +0.37 (+0.54), n 220, q 0.00 | +0.26 | 0.32 | 0.02 [-0.88, 0.92] | within-season only |
| min_dn3 | -0.10 [-0.44, +0.27] (30), q 0.85 | +0.07 (+0.13), n 200, q 0.31 | +0.13 | 0.12 | -0.22 [-0.64, 0.20] | noise |
| role_promoted | -0.06 [-0.57, +0.49] (14), q 0.76 | +0.21 (+0.34), n 105, q 0.06 | +0.11 | 0.12 | -0.89 [-5.23, 3.45] | n too small |
| role_demoted | n/a (3), q nan | +0.31 (+0.48), n 59, q 0.03 | +0.11 | 0.11 | n/a | n too small |
| early_vs_late | -0.06 [-0.28, +0.16] (80), q 0.85 | +0.33 (+0.50), n 262, q 0.00 | +0.30 | 0.37 | -0.11 [-0.56, 0.34] | within-season only |

**1.5x**

| condition | temporal r [95% CI] (n) | odd-even r (SB) | random r | EB rel | slope [95% CI] | verdict |
|---|---|---|---|---|---|---|
| home | +0.08 [-0.06, +0.22] (195), q 0.48 | +0.17 (+0.29), n 337, q 0.01 | -0.01 | 0.02 | n/a | within-season only |
| b2b_2nd | +0.04 [-0.17, +0.25] (85), q 0.65 | +0.05 (+0.10), n 255, q 0.36 | +0.05 | 0.02 | n/a | noise |
| b2b_1st | +0.04 [-0.15, +0.24] (104), q 0.63 | +0.14 (+0.25), n 255, q 0.04 | +0.06 | 0.02 | n/a | within-season only |
| rest_r0 | +0.06 [-0.15, +0.27] (85), q 0.60 | +0.05 (+0.10), n 255, q 0.36 | +0.05 | 0.02 | n/a | noise |
| rest_r1 | +0.02 [-0.13, +0.16] (182), q 0.66 | -0.05 (-0.10), n 323, q 0.95 | -0.02 | 0.00 | n/a | noise |
| rest_r2 | -0.15 [-0.40, +0.12] (55), q 0.94 | -0.05 (-0.10), n 239, q 0.95 | +0.02 | 0.00 | n/a | noise |
| rest_r3plus | n/a (0), q nan | +0.13 (+0.24), n 43, q 0.36 | +0.00 | 0.00 | n/a | n too small |
| def_worst5 | +0.25 [+0.03, +0.44] (78), q 0.12 | +0.20 (+0.34), n 246, q 0.00 | +0.14 | 0.20 | 0.65 [-0.46, 1.76] | within-season only |
| def_worst10 | +0.18 [+0.03, +0.32] (177), q 0.10 | +0.03 (+0.06), n 316, q 0.48 | -0.01 | 0.01 | n/a | cross-season only |
| def_best10 | +0.07 [-0.08, +0.21] (176), q 0.50 | +0.00 (+0.00), n 316, q 0.71 | +0.01 | 0.00 | n/a | noise |
| def_best5 | +0.04 [-0.18, +0.26] (83), q 0.65 | +0.02 (+0.05), n 248, q 0.56 | +0.02 | 0.00 | n/a | noise |
| pace_fast10 | -0.00 [-0.15, +0.15] (175), q 0.71 | -0.11 (-0.24), n 320, q 1.00 | -0.03 | 0.00 | n/a | noise |
| pace_slow10 | -0.04 [-0.19, +0.11] (177), q 0.85 | -0.06 (-0.12), n 313, q 0.97 | -0.03 | 0.00 | n/a | noise |
| opp_leaky_l5 | +0.02 [-0.14, +0.18] (153), q 0.66 | +0.01 (+0.02), n 301, q 0.64 | -0.05 | 0.00 | n/a | noise |
| opp_tight_l5 | -0.10 [-0.26, +0.07] (138), q 0.95 | -0.00 (-0.00), n 290, q 0.74 | -0.01 | 0.00 | n/a | noise |
| opp_leaky_l1 | +0.22 [+0.02, +0.39] (102), q 0.12 | -0.13 (-0.29), n 274, q 1.00 | -0.05 | 0.00 | n/a | noise |
| opp_tight_l1 | +0.02 [-0.21, +0.24] (79), q 0.66 | -0.03 (-0.06), n 252, q 0.93 | -0.04 | 0.00 | n/a | noise |
| vac_any | +0.12 [-0.04, +0.28] (145), q 0.34 | +0.18 (+0.31), n 288, q 0.01 | +0.23 | 0.12 | 0.25 [-0.93, 1.43] | within-season only |
| vac_large | +0.08 [-0.10, +0.26] (115), q 0.52 | +0.13 (+0.22), n 279, q 0.06 | +0.19 | 0.17 | 0.05 [-0.85, 0.94] | within-season only |
| vac_star | +0.32 [+0.11, +0.50] (84), q 0.04 | +0.16 (+0.27), n 273, q 0.02 | +0.22 | 0.30 | 0.89 [0.18, 1.59] | **PERSISTENT** |
| out_top1 | +0.43 [+0.22, +0.60] (70), q 0.01 | +0.16 (+0.28), n 258, q 0.02 | +0.24 | 0.35 | 1.20 [0.42, 1.97] | **PERSISTENT** |
| bb_last1 | +0.12 [-0.04, +0.27] (160), q 0.34 | +0.07 (+0.14), n 315, q 0.21 | +0.09 | 0.02 | n/a | noise |
| hot_last1 | +0.03 [-0.14, +0.19] (140), q 0.66 | +0.18 (+0.31), n 316, q 0.00 | +0.13 | 0.15 | -0.09 [-1.62, 1.45] | within-season only |
| min_up3 | +0.02 [-0.32, +0.36] (34), q 0.66 | +0.18 (+0.30), n 220, q 0.02 | +0.19 | 0.30 | -0.08 [-1.13, 0.97] | within-season only |
| min_dn3 | +0.04 [-0.32, +0.39] (30), q 0.66 | +0.04 (+0.07), n 200, q 0.50 | +0.03 | 0.00 | n/a | noise |
| role_promoted | +0.02 [-0.51, +0.55] (14), q 0.66 | +0.13 (+0.23), n 105, q 0.21 | +0.16 | 0.26 | 0.34 [-2.59, 3.26] | n too small |
| role_demoted | n/a (3), q nan | +0.19 (+0.32), n 59, q 0.18 | -0.06 | 0.00 | n/a | n too small |
| early_vs_late | -0.16 [-0.37, +0.06] (80), q 0.97 | +0.15 (+0.26), n 262, q 0.03 | +0.18 | 0.12 | -2.16 [-5.43, 1.11] | within-season only |

**+10**

| condition | temporal r [95% CI] (n) | odd-even r (SB) | random r | EB rel | slope [95% CI] | verdict |
|---|---|---|---|---|---|---|
| home | +0.19 [+0.05, +0.32] (195), q 0.08 | +0.11 (+0.20), n 337, q 0.07 | +0.06 | 0.02 | n/a | persistent (small/scale) |
| b2b_2nd | +0.07 [-0.15, +0.28] (85), q 0.57 | +0.03 (+0.06), n 255, q 0.53 | +0.00 | 0.00 | n/a | noise |
| b2b_1st | -0.08 [-0.27, +0.12] (104), q 0.89 | +0.05 (+0.09), n 255, q 0.40 | +0.05 | 0.00 | n/a | noise |
| rest_r0 | +0.11 [-0.10, +0.32] (85), q 0.48 | +0.02 (+0.04), n 255, q 0.59 | -0.00 | 0.00 | n/a | noise |
| rest_r1 | +0.05 [-0.09, +0.20] (182), q 0.57 | +0.02 (+0.03), n 323, q 0.59 | -0.02 | 0.00 | n/a | noise |
| rest_r2 | -0.11 [-0.37, +0.16] (55), q 0.89 | -0.05 (-0.11), n 239, q 0.95 | -0.05 | 0.00 | n/a | noise |
| rest_r3plus | n/a (0), q nan | +0.06 (+0.12), n 43, q 0.56 | -0.05 | 0.00 | n/a | n too small |
| def_worst5 | -0.24 [-0.44, -0.02] (78), q 0.99 | +0.09 (+0.17), n 246, q 0.18 | +0.02 | 0.02 | n/a | noise |
| def_worst10 | -0.01 [-0.16, +0.14] (177), q 0.74 | -0.11 (-0.26), n 316, q 1.00 | -0.06 | 0.00 | n/a | noise |
| def_best10 | +0.01 [-0.14, +0.16] (176), q 0.66 | -0.03 (-0.05), n 316, q 0.93 | -0.01 | 0.00 | n/a | noise |
| def_best5 | -0.05 [-0.27, +0.16] (83), q 0.85 | -0.05 (-0.11), n 248, q 0.95 | -0.05 | 0.00 | n/a | noise |
| pace_fast10 | -0.05 [-0.19, +0.10] (175), q 0.88 | -0.05 (-0.10), n 320, q 0.95 | -0.06 | 0.00 | n/a | noise |
| pace_slow10 | -0.03 [-0.18, +0.11] (177), q 0.85 | -0.12 (-0.28), n 313, q 1.00 | -0.02 | 0.00 | n/a | noise |
| opp_leaky_l5 | +0.09 [-0.07, +0.25] (153), q 0.47 | +0.10 (+0.18), n 301, q 0.11 | +0.02 | 0.00 | n/a | noise |
| opp_tight_l5 | -0.00 [-0.17, +0.16] (138), q 0.71 | +0.05 (+0.10), n 290, q 0.36 | +0.01 | 0.00 | n/a | noise |
| opp_leaky_l1 | +0.22 [+0.02, +0.40] (102), q 0.12 | -0.05 (-0.11), n 274, q 0.95 | +0.00 | 0.00 | n/a | noise |
| opp_tight_l1 | -0.10 [-0.32, +0.12] (79), q 0.90 | -0.11 (-0.26), n 252, q 1.00 | -0.08 | 0.00 | n/a | noise |
| vac_any | +0.03 [-0.14, +0.19] (145), q 0.66 | +0.14 (+0.24), n 288, q 0.04 | +0.09 | 0.00 | n/a | within-season only |
| vac_large | +0.16 [-0.02, +0.34] (115), q 0.24 | +0.15 (+0.26), n 279, q 0.03 | +0.10 | 0.05 | n/a | within-season only |
| vac_star | +0.12 [-0.10, +0.32] (84), q 0.48 | +0.18 (+0.31), n 273, q 0.01 | +0.16 | 0.27 | 0.61 [-0.09, 1.31] | within-season only |
| out_top1 | +0.35 [+0.13, +0.54] (70), q 0.04 | +0.13 (+0.24), n 258, q 0.06 | +0.19 | 0.29 | 0.59 [-0.11, 1.30] | **PERSISTENT** |
| bb_last1 | +0.01 [-0.14, +0.17] (160), q 0.66 | -0.05 (-0.11), n 315, q 0.96 | +0.04 | 0.00 | n/a | noise |
| hot_last1 | +0.01 [-0.15, +0.18] (140), q 0.66 | +0.10 (+0.19), n 316, q 0.10 | +0.05 | 0.12 | 0.13 [-0.66, 0.92] | within-season only |
| min_up3 | +0.17 [-0.18, +0.48] (34), q 0.49 | +0.13 (+0.23), n 220, q 0.08 | +0.18 | 0.19 | 0.54 [-2.58, 3.67] | within-season only |
| min_dn3 | +0.02 [-0.35, +0.37] (30), q 0.66 | +0.09 (+0.17), n 200, q 0.23 | +0.03 | 0.00 | n/a | noise |
| role_promoted | +0.66 [+0.20, +0.88] (14), q 0.08 | +0.19 (+0.31), n 105, q 0.08 | +0.12 | 0.08 | n/a | n too small |
| role_demoted | n/a (3), q nan | -0.20 (-0.51), n 59, q 1.00 | -0.05 | 0.00 | n/a | n too small |
| early_vs_late | -0.07 [-0.28, +0.16] (80), q 0.87 | +0.14 (+0.24), n 262, q 0.05 | +0.17 | 0.04 | n/a | within-season only |

The other outcomes (1.25x, 2.0x) are in `player_conditions_persistence` / `player_conditions_reliability`. For the persistent signals the cross-check on the other outcomes:

| condition | outcome | temporal r [95% CI] | partial r (base rate) | odd-even SB r | EB rel | tau | league mean |
|---|---|---|---|---|---|---|---|
| vac_star | points vs prior avg | +0.26 [+0.05, +0.45] | +0.25 | +0.51 | 0.43 | 1.35 pts | +1.85 pts |
| vac_star | 1.5x | +0.32 [+0.11, +0.50] | +0.24 | +0.27 | 0.30 | 5.93 pp | +7.16 pp |
| out_top1 | points vs prior avg | +0.39 [+0.17, +0.57] | +0.34 | +0.40 | 0.44 | 1.44 pts | +2.04 pts |
| out_top1 | 1.25x | +0.34 [+0.12, +0.54] | +0.32 | +0.29 | 0.37 | 8.67 pp | +11.55 pp |
| out_top1 | 1.5x | +0.43 [+0.22, +0.60] | +0.33 | +0.28 | 0.35 | 6.95 pp | +8.29 pp |
| out_top1 | 2.0x | +0.28 [+0.05, +0.49] | +0.16 | +0.46 | 0.23 | 3.27 pp | +2.95 pp |
| out_top1 | +10 | +0.35 [+0.13, +0.54] | +0.24 | +0.24 | 0.29 | 4.38 pp | +4.77 pp |

**Flag hit rates, temporal split (2023-25 flags -> 2025-26), all players.** Flagged = strong or watch.

| cells | flag type | flagged in 2023-25 | same sign in 2025-26 | same-direction flag in 2025-26 | chance rate |
|---|---|---|---|---|---|
| persistent signal conditions | vs league | 20 | 16 (80%) | 1 (5%) | 1% |
| persistent signal conditions | != 0 | 235 | 182 (77%) | 105 (45%) | 37% |
| all other cells | vs league | 17 | 9 (53%) | 0 (0%) | 0% |
| all other cells | != 0 | 6248 | 3589 (57%) | 3637 (58%) | 58% |

Reading: significance rarely repeats because one held-out season is short; for the `!= 0` flag the hit rate mostly reflects the league-wide effect (the chance column controls for it using the test season's own flag share). Compare the sign-repeat rate with 50%.

**Segments.** Verdict counts by segment (all 140 cells each):

| segment | cross-season only | noise | n too small | persistent (small/scale) | PERSISTENT | thin | within-season only |
|---|---|---|---|---|---|---|---|
| all | 1 | 76 | 15 | 2 | 7 | 0 | 39 |
| top100 | 0 | 105 | 35 | 0 | 0 | 0 | 0 |
| top50 | 0 | 50 | 90 | 0 | 0 | 0 | 0 |
| top25 | 0 | 0 | 0 | 0 | 0 | 140 | 0 |
| top10 | 0 | 0 | 0 | 0 | 0 | 140 | 0 |

Top 100 / top 50 have no persistent condition; the cross-season test often has < 30 paired players (a star needs 10+ games on each side in 2025-26 and in 2023-25). The star-segment figures for each condition are in the mart; example (points vs prior average, top 100 / top 50):

| condition | top 100 | top 50 |
|---|---|---|
| out_top1 | temporal -0.11 [-0.54, +0.36] (19); odd-even +0.07 (70) | temporal n/a (5); odd-even +0.04 (26) |
| vac_star | temporal +0.07 [-0.30, +0.43] (29); odd-even +0.11 (83) | temporal -0.03 [-0.59, +0.56] (12); odd-even -0.09 (37) |
| vac_any | temporal -0.08 [-0.31, +0.15] (73); odd-even +0.17 (99) | temporal -0.09 [-0.39, +0.23] (39); odd-even +0.08 (50) |
| home | temporal +0.13 [-0.09, +0.33] (85); odd-even +0.11 (100) | temporal +0.09 [-0.21, +0.38] (43); odd-even +0.08 (50) |
| hot_last1 | temporal -0.01 [-0.28, +0.26] (53); odd-even -0.02 (99) | temporal -0.02 [-0.45, +0.42] (21); odd-even -0.02 (50) |
| bb_last1 | temporal +0.17 [-0.08, +0.40] (65); odd-even +0.12 (98) | temporal +0.04 [-0.32, +0.40] (30); odd-even +0.26 (49) |
| early_vs_late | temporal -0.12 [-0.42, +0.19] (40); odd-even +0.24 (97) | temporal -0.16 [-0.55, +0.29] (21); odd-even +0.22 (49) |

## 6. 2026-27 provisional check

With the 3-and-3 minimum, 10 of 28 conditions have any paired player and only 4 have 10 or more (home, def_worst10, def_best10, pace_slow10); none of those correlations is distinguishable from zero (CIs span zero). The team's top scorer out / a 20+ PPG teammate out have no paired players yet. 2026-27 per-player rows are in the mart (provisional) and are almost always shrunk to the league mean.

## 7. Top responders

Pooled 2023-24 to 2025-26, all players, **ranked by shrunk effect** (the ranking is identical to ranking by deviation from the league mean), only players with **n >= 15 games on each side**; non-thin segments only (top 100 and top 50 lists are in `player_conditions_responders`). Persistence marks: the verdict of the condition x outcome cell; 'shrunk 2023-25' and 'raw 2025-26' are the same player's estimates in the training and held-out period (the 2025-26 season is also inside the pooled estimate, so they are not independent of the shrunk value shown).

### out_top1, points vs prior avg: team's top scorer out (vs other)

League mean +2.04 pts, tau 1.44, EB reliability 0.44; flagged vs league 10 strong + 16 watch against 0.01 expected by chance. Persistence: **PERSISTENT** (temporal r +0.39, odd-even SB r +0.40).

*Most responsive (largest shrunk effect)* (pts):

| # | player | n in / out | raw diff | shrunk [95%] | vs league | shrunk 2023-25 | raw 2025-26 |
|---|---|---|---|---|---|---|---|
| 1 | Quentin Grimes | 47 / 81 | +8.85 | +4.94 [+2.80, +7.08] | strong | +3.28 | +8.38 |
| 2 | Payton Pritchard | 24 / 145 | +10.30 | +4.87 [+2.58, +7.16] | strong | +4.61 | +9.03 |
| 3 | Spencer Dinwiddie | 51 / 79 | +6.92 | +4.66 [+2.75, +6.58] | strong | +4.96 | n/a |
| 4 | Daniss Jenkins | 18 / 43 | +10.08 | +4.62 [+2.29, +6.94] | strong | n/a | +10.08 |
| 5 | Peyton Watson | 21 / 68 | +8.07 | +4.56 [+2.41, +6.72] | strong | n/a | +7.26 |
| 6 | Dalano Banton | 21 / 52 | +9.29 | +4.28 [+1.93, +6.63] | watch | +4.68 | n/a |
| 7 | Damian Lillard | 15 / 106 | +8.26 | +3.96 [+1.62, +6.31] | none | +4.31 | n/a |
| 8 | Isaiah Joe | 23 / 182 | +5.81 | +3.96 [+1.99, +5.94] | watch | +3.82 | +5.90 |
| 9 | Brice Sensabaugh | 73 / 60 | +5.47 | +3.88 [+1.97, +5.80] | watch | +3.98 | +5.89 |
| 10 | Rui Hachimura | 28 / 152 | +5.49 | +3.88 [+1.96, +5.81] | watch | +3.77 | +6.33 |

*Least responsive (smallest shrunk effect)* (pts):

| # | player | n in / out | raw diff | shrunk [95%] | vs league | shrunk 2023-25 | raw 2025-26 |
|---|---|---|---|---|---|---|---|
| 1 | Myles Turner | 48 / 156 | -0.99 | +0.03 [-1.60, +1.66] | strong | +0.07 | -0.30 |
| 2 | Daniel Gafford | 40 / 118 | -1.07 | +0.08 [-1.63, +1.80] | strong | +0.26 | n/a |
| 3 | Onyeka Okongwu | 18 / 169 | -2.03 | +0.11 [-1.94, +2.16] | watch | +0.30 | n/a |
| 4 | Tre Johnson | 19 / 36 | -1.81 | +0.14 [-1.87, +2.15] | watch | n/a | -1.81 |
| 5 | Draymond Green | 37 / 128 | -0.66 | +0.14 [-1.40, +1.69] | strong | n/a | +0.46 |
| 6 | Noah Clowney | 32 / 51 | -1.97 | +0.17 [-1.89, +2.23] | watch | +1.19 | -2.62 |
| 7 | Mark Williams | 42 / 66 | -1.32 | +0.18 [-1.71, +2.06] | watch | +0.53 | -1.69 |
| 8 | Klay Thompson | 61 / 139 | -0.79 | +0.21 [-1.47, +1.88] | strong | -0.12 | +1.14 |
| 9 | Toumani Camara | 24 / 124 | -1.38 | +0.23 [-1.71, +2.16] | watch | n/a | -2.07 |
| 10 | Ronald Holland II | 18 / 49 | -1.12 | +0.23 [-1.61, +2.08] | watch | n/a | -1.12 |

### out_top1, 1.5x: team's top scorer out (vs other)

League mean +8.29 pp, tau 6.95, EB reliability 0.35; flagged vs league 4 strong + 9 watch against 0.00 expected by chance. Persistence: **PERSISTENT** (temporal r +0.43, odd-even SB r +0.28).

*Most responsive (largest shrunk effect)* (pp):

| # | player | n in / out | raw diff | shrunk [95%] | vs league | shrunk 2023-25 | raw 2025-26 |
|---|---|---|---|---|---|---|---|
| 1 | Isaiah Joe | 23 / 182 | +49.28 | +23.34 [+12.47, +34.22] | strong | +17.95 | +49.09 |
| 2 | Quentin Grimes | 47 / 81 | +42.08 | +22.56 [+12.17, +32.95] | strong | +13.25 | +38.67 |
| 3 | Spencer Dinwiddie | 51 / 79 | +38.77 | +22.51 [+12.52, +32.49] | strong | +22.13 | n/a |
| 4 | Daniss Jenkins | 18 / 43 | +60.59 | +20.09 [+8.05, +32.12] | watch | n/a | +60.59 |
| 5 | Jonas Valanciunas | 19 / 190 | +32.63 | +18.71 [+8.37, +29.04] | strong | +13.01 | n/a |
| 6 | Jaden Hardy | 46 / 43 | +38.52 | +18.57 [+7.46, +29.67] | watch | +16.06 | n/a |
| 7 | Payton Pritchard | 24 / 145 | +36.24 | +18.27 [+7.31, +29.23] | watch | +15.36 | +32.26 |
| 8 | Peyton Watson | 21 / 68 | +42.44 | +18.23 [+6.72, +29.74] | watch | n/a | +36.00 |
| 9 | Rui Hachimura | 28 / 152 | +29.70 | +17.60 [+7.33, +27.88] | watch | +14.60 | +31.25 |
| 10 | Dalano Banton | 21 / 52 | +41.76 | +17.13 [+5.39, +28.86] | none | +16.78 | n/a |

*Least responsive (smallest shrunk effect)* (pp):

| # | player | n in / out | raw diff | shrunk [95%] | vs league | shrunk 2023-25 | raw 2025-26 |
|---|---|---|---|---|---|---|---|
| 1 | Andrew Wiggins | 26 / 158 | -12.61 | -1.28 [-11.34, +8.79] | watch | +0.81 | -2.31 |
| 2 | Toumani Camara | 24 / 124 | -18.28 | -0.95 [-11.99, +10.09] | none | n/a | -20.00 |
| 3 | Daniel Gafford | 40 / 118 | -11.23 | -0.75 [-10.76, +9.26] | watch | +1.39 | n/a |
| 4 | Dejounte Murray | 41 / 67 | -8.15 | +0.32 [-9.49, +10.12] | none | +1.43 | n/a |
| 5 | Onyeka Okongwu | 18 / 169 | -13.97 | +0.66 [-10.42, +11.75] | none | +1.42 | n/a |
| 6 | Max Christie | 44 / 74 | -7.99 | +0.76 [-9.26, +10.78] | none | +3.36 | -10.38 |
| 7 | Jimmy Butler III | 19 / 118 | -9.99 | +1.14 [-9.53, +11.81] | none | +3.33 | n/a |
| 8 | Paolo Banchero | 31 / 151 | -4.14 | +1.16 [-7.76, +10.08] | none | n/a | -1.76 |
| 9 | Tre Johnson | 19 / 36 | -14.18 | +1.29 [-10.05, +12.64] | none | n/a | -14.18 |
| 10 | De'Aaron Fox | 29 / 164 | -1.43 | +1.39 [-5.96, +8.74] | watch | +1.57 | +1.88 |

### vac_star, points vs prior avg: a 20+ PPG teammate out (vs other)

League mean +1.85 pts, tau 1.35, EB reliability 0.43; flagged vs league 11 strong + 17 watch against 0.01 expected by chance. Persistence: **PERSISTENT** (temporal r +0.26, odd-even SB r +0.51).

*Most responsive (largest shrunk effect)* (pts):

| # | player | n in / out | raw diff | shrunk [95%] | vs league | shrunk 2023-25 | raw 2025-26 |
|---|---|---|---|---|---|---|---|
| 1 | Spencer Dinwiddie | 54 / 76 | +6.73 | +4.34 [+2.49, +6.19] | strong | +4.40 | n/a |
| 2 | Quentin Grimes | 58 / 70 | +7.73 | +4.26 [+2.23, +6.30] | strong | +2.92 | +6.13 |
| 3 | Daniss Jenkins | 18 / 43 | +10.08 | +4.26 [+2.04, +6.49] | strong | n/a | +10.08 |
| 4 | Isaiah Joe | 32 / 173 | +5.63 | +3.92 [+2.14, +5.70] | strong | +3.62 | +5.90 |
| 5 | Payton Pritchard | 47 / 122 | +6.61 | +3.90 [+1.90, +5.89] | strong | +3.49 | +9.03 |
| 6 | Dalano Banton | 17 / 56 | +9.44 | +3.78 [+1.50, +6.07] | watch | +3.88 | n/a |
| 7 | Damian Lillard | 15 / 106 | +8.26 | +3.66 [+1.42, +5.90] | none | +3.75 | n/a |
| 8 | Aaron Wiggins | 28 / 101 | +6.05 | +3.63 [+1.62, +5.64] | watch | +3.39 | +5.10 |
| 9 | Peyton Watson | 26 / 63 | +6.01 | +3.60 [+1.59, +5.61] | watch | +2.28 | +7.26 |
| 10 | Luke Kennard | 58 / 63 | +4.64 | +3.49 [+1.79, +5.19] | watch | +3.26 | +4.41 |

*Least responsive (smallest shrunk effect)* (pts):

| # | player | n in / out | raw diff | shrunk [95%] | vs league | shrunk 2023-25 | raw 2025-26 |
|---|---|---|---|---|---|---|---|
| 1 | AJ Green | 49 / 73 | -2.59 | -0.82 [-2.49, +0.85] | strong | +0.17 | -3.13 |
| 2 | Klay Thompson | 58 / 142 | -1.74 | -0.34 [-1.99, +1.31] | strong | +0.21 | -2.19 |
| 3 | Precious Achiuwa | 26 / 33 | -3.92 | -0.21 [-2.33, +1.92] | watch | n/a | n/a |
| 4 | Jalen Wilson | 19 / 54 | -1.71 | -0.00 [-1.84, +1.83] | strong | +0.06 | n/a |
| 5 | Grant Williams | 24 / 58 | -2.60 | +0.04 [-2.00, +2.07] | watch | +0.12 | n/a |
| 6 | Nick Richards | 37 / 73 | -1.17 | +0.05 [-1.63, +1.72] | strong | +0.10 | n/a |
| 7 | Draymond Green | 43 / 122 | -0.70 | +0.08 [-1.38, +1.54] | strong | n/a | +0.22 |
| 8 | Bojan Bogdanovic | 36 / 16 | -4.76 | +0.10 [-2.17, +2.37] | none | +0.20 | n/a |
| 9 | GG Jackson | 45 / 48 | -2.10 | +0.13 [-1.86, +2.11] | watch | +1.62 | n/a |
| 10 | Deni Avdija | 31 / 164 | -1.79 | +0.15 [-1.78, +2.09] | watch | n/a | -3.96 |

**Other conditions, points vs prior average: top 3 each way (all players, n >= 15).** Cells whose true-effect spread is negligible (EB reliability < 0.05) are not ranked. Marked with the persistence verdict; only ranks from conditions marked persistent or cross-season are worth reading, the rest are what noise looks like.

| condition | highest shrunk | lowest shrunk | persistence (dev) |
|---|---|---|---|
| home | Bobby Portis Jr. (+0.5), Duncan Robinson (+0.5), Keldon Johnson (+0.5) | Dennis Schröder (-0.0), Immanuel Quickley (-0.0), Patrick Williams (-0.0) | within-season only |
| b2b_2nd | Payton Pritchard (+0.7), Bub Carrington (+0.6), Julian Champagnie (+0.6) | Josh Hart (-0.7), Grayson Allen (-0.6), Jarrett Allen (-0.5) | noise |
| b2b_1st | not ranked (no measurable spread between players) |  | noise |
| rest_r0 | Bub Carrington (+0.6), Payton Pritchard (+0.5), Keldon Johnson (+0.5) | Grayson Allen (-0.6), Josh Hart (-0.6), Jarrett Allen (-0.4) | noise |
| rest_r1 | not ranked (no measurable spread between players) |  | noise |
| rest_r2 | not ranked (no measurable spread between players) |  | noise |
| def_worst5 | Duncan Robinson (+1.9), Mark Williams (+1.6), Jalen Green (+1.5) | Draymond Green (-0.5), Andrew Nembhard (-0.2), Taurean Prince (-0.1) | within-season only |
| def_worst10 | not ranked (no measurable spread between players) |  | noise |
| def_best10 | Jalen Smith (-0.3), Shai Gilgeous-Alexander (-0.3), Collin Sexton (-0.3) | Tobias Harris (-1.0), Gary Trent Jr. (-1.0), Brandin Podziemski (-1.0) | noise |
| def_best5 | Naz Reid (+0.1), Dorian Finney-Smith (-0.2), Ayo Dosunmu (-0.3) | Malik Beasley (-1.3), Clint Capela (-1.3), Daniel Gafford (-1.2) | noise |
| pace_fast10 | not ranked (no measurable spread between players) |  | noise |
| pace_slow10 | not ranked (no measurable spread between players) |  | noise |
| opp_leaky_l5 | not ranked (no measurable spread between players) |  | noise |
| opp_tight_l5 | not ranked (no measurable spread between players) |  | noise |
| opp_leaky_l1 | not ranked (no measurable spread between players) |  | noise |
| opp_tight_l1 | not ranked (no measurable spread between players) |  | noise |
| vac_any | Pelle Larsson (+2.7), Zach Collins (+2.7), Jaden McDaniels (+2.6) | Domantas Sabonis (-0.0), Tre Mann (+0.3), Isaac Okoro (+0.3) | within-season only |
| vac_large | Payton Pritchard (+3.7), Daniss Jenkins (+3.4), Spencer Dinwiddie (+3.4) | Draymond Green (+0.6), Nic Claxton (+0.8), Daniel Gafford (+0.9) | within-season only |
| vac_star | Spencer Dinwiddie (+4.3), Quentin Grimes (+4.3), Daniss Jenkins (+4.3) | AJ Green (-0.8), Klay Thompson (-0.3), Precious Achiuwa (-0.2) | PERSISTENT |
| out_top1 | Quentin Grimes (+4.9), Payton Pritchard (+4.9), Spencer Dinwiddie (+4.7) | Myles Turner (+0.0), Daniel Gafford (+0.1), Onyeka Okongwu (+0.1) | PERSISTENT |
| bb_last1 | Isaiah Stewart (-0.1), Klay Thompson (-0.1), Stephen Curry (-0.1) | Grayson Allen (-1.3), Collin Gillespie (-1.3), Peyton Watson (-1.2) | within-season only |
| hot_last1 | Coby White (+2.0), Austin Reaves (+1.7), GG Jackson (+1.7) | Draymond Green (+0.1), Isaiah Stewart (+0.2), Scottie Barnes (+0.2) | within-season only |
| min_up3 | Donte DiVincenzo (+3.1), Quentin Grimes (+2.9), Kawhi Leonard (+2.8) | Jordan Clarkson (-0.9), Buddy Hield (-0.2), Jalen Wilson (-0.2) | within-season only |
| min_dn3 | Myles Turner (-0.2), Cameron Johnson (-0.4), Moritz Wagner (-0.4) | Julian Champagnie (-1.6), Dario Saric (-1.6), Wendell Carter Jr. (-1.6) | noise |
| role_promoted | Quentin Grimes (+2.3), Brice Sensabaugh (+2.1), Ayo Dosunmu (+2.1) | Kel'el Ware (+1.1), Buddy Hield (+1.2), Tre Jones (+1.2) | n too small |
| role_demoted | Bennedict Mathurin (-0.6), Grant Williams (-0.7), De'Andre Hunter (-0.8) | Julian Champagnie (-1.9), Bojan Bogdanovic (-1.7), Keldon Johnson (-1.4) | n too small |
| early_vs_late | Franz Wagner (+2.7), Malik Beasley (+2.1), Moritz Wagner (+2.1) | Bilal Coulibaly (-2.3), Gary Trent Jr. (-2.3), Josh Giddey (-2.3) | within-season only |

## 8. Example player profiles

Points vs prior average, pooled 2023-24 to 2025-26, all-player EB. For each player: the three conditions where his shrunk effect is furthest above the league mean and the three furthest below (n >= 15 games on each side; deviation = shrunk - league mean). 'condition persistence' is the verdict of the condition; conditions with no measurable spread between players (EB reliability < 0.05) are left out; anything marked noise is shown only to be honest about it. The persistence marks come from the all-player test and are not shown to hold in the star segments, so a star's row marked persistent says the condition has persistent player differences in the population, not that his own effect is reliable. Full profiles (dev, 1.5x, +10) for every player are in `player_conditions_profiles`.

**Quentin Grimes**, 16 conditions with n >= 15:

| side | condition | n in / out | raw | shrunk [95%] | vs league mean | flag vs league | condition persistence |
|---|---|---|---|---|---|---|---|
| above league | out_top1 | 47 / 81 | +8.85 | +4.94 [+2.80, +7.08] | +2.90 | strong | PERSISTENT |
| above league | vac_star | 58 / 70 | +7.73 | +4.26 [+2.23, +6.30] | +2.42 | strong | PERSISTENT |
| above league | min_up3 | 51 / 53 | +6.94 | +2.93 [+0.99, +4.87] | +1.64 | watch | within-season only |
| below league | early_vs_late | 16 / 42 | -7.78 | -1.49 [-4.11, +1.12] | -1.40 | none | within-season only |
| below league | bb_last1 | 37 / 91 | -3.03 | -0.93 [-2.02, +0.16] | -0.22 | none | within-season only |
| below league | def_best5 | 27 / 101 | -2.81 | -0.88 [-1.97, +0.21] | -0.16 | none | noise |

**Spencer Dinwiddie**, 16 conditions with n >= 15:

| side | condition | n in / out | raw | shrunk [95%] | vs league mean | flag vs league | condition persistence |
|---|---|---|---|---|---|---|---|
| above league | out_top1 | 51 / 79 | +6.92 | +4.66 [+2.75, +6.58] | +2.63 | strong | PERSISTENT |
| above league | vac_star | 54 / 76 | +6.73 | +4.34 [+2.49, +6.19] | +2.49 | strong | PERSISTENT |
| above league | vac_large | 69 / 24 | +7.21 | +3.39 [+1.63, +5.15] | +1.22 | none | within-season only |
| below league | bb_last1 | 50 / 80 | -2.57 | -1.00 [-2.05, +0.05] | -0.29 | none | within-season only |
| below league | def_worst5 | 22 / 108 | -0.81 | +0.41 [-1.04, +1.85] | -0.26 | none | within-season only |
| below league | role_demoted | 15 / 84 | -3.43 | -1.34 [-2.63, -0.06] | -0.18 | none | n too small |

**Payton Pritchard**, 15 conditions with n >= 15:

| side | condition | n in / out | raw | shrunk [95%] | vs league mean | flag vs league | condition persistence |
|---|---|---|---|---|---|---|---|
| above league | out_top1 | 24 / 145 | +10.30 | +4.87 [+2.58, +7.16] | +2.83 | strong | PERSISTENT |
| above league | vac_star | 47 / 122 | +6.61 | +3.90 [+1.90, +5.89] | +2.05 | strong | PERSISTENT |
| above league | vac_large | 57 / 82 | +7.46 | +3.72 [+2.02, +5.42] | +1.55 | watch | within-season only |
| below league | def_best5 | 22 / 147 | -3.72 | -0.93 [-2.03, +0.16] | -0.21 | none | noise |
| below league | hot_last1 | 62 / 107 | +0.15 | +0.75 [-0.53, +2.02] | -0.15 | none | within-season only |
| below league | def_best10 | 48 / 121 | -2.13 | -0.75 [-1.51, +0.01] | -0.09 | none | noise |

**Jalen Brunson** (top 50), 12 conditions with n >= 15:

| side | condition | n in / out | raw | shrunk [95%] | vs league mean | flag vs league | condition persistence |
|---|---|---|---|---|---|---|---|
| above league | vac_star | 48 / 150 | +4.36 | +2.97 [+1.00, +4.94] | +1.12 | none | PERSISTENT |
| above league | vac_large | 70 / 60 | +3.21 | +2.47 [+0.77, +4.18] | +0.30 | none | within-season only |
| above league | bb_last1 | 40 / 158 | +0.65 | -0.55 [-1.62, +0.53] | +0.16 | none | within-season only |
| below league | hot_last1 | 42 / 156 | -3.22 | +0.17 [-1.13, +1.47] | -0.72 | none | within-season only |
| below league | def_worst5 | 36 / 162 | -0.88 | +0.37 [-1.06, +1.81] | -0.30 | none | within-season only |
| below league | early_vs_late | 38 / 46 | -0.46 | -0.22 [-2.54, +2.10] | -0.13 | none | within-season only |

**Nikola Jokić** (top 50), 13 conditions with n >= 15:

| side | condition | n in / out | raw | shrunk [95%] | vs league mean | flag vs league | condition persistence |
|---|---|---|---|---|---|---|---|
| above league | early_vs_late | 35 / 58 | +2.11 | +0.70 [-1.62, +3.01] | +0.79 | none | within-season only |
| above league | vac_star | 16 / 182 | +4.23 | +2.42 [+0.12, +4.73] | +0.58 | none | PERSISTENT |
| above league | b2b_2nd | 35 / 128 | +2.48 | +0.37 [-0.80, +1.54] | +0.30 | none | noise |
| below league | bb_last1 | 37 / 161 | -1.24 | -0.76 [-1.84, +0.32] | -0.06 | none | within-season only |
| below league | def_worst5 | 31 / 167 | +0.79 | +0.69 [-0.76, +2.14] | +0.02 | none | within-season only |
| below league | min_up3 | 17 / 169 | +1.53 | +1.34 [-0.73, +3.40] | +0.05 | none | within-season only |

**Shai Gilgeous-Alexander** (top 50), 11 conditions with n >= 15:

| side | condition | n in / out | raw | shrunk [95%] | vs league mean | flag vs league | condition persistence |
|---|---|---|---|---|---|---|---|
| above league | early_vs_late | 41 / 53 | +4.04 | +1.83 [-0.29, +3.94] | +1.92 | watch | within-season only |
| above league | def_best5 | 31 / 172 | +2.01 | -0.33 [-1.38, +0.72] | +0.39 | none | noise |
| above league | def_best10 | 78 / 125 | +2.01 | -0.32 [-1.05, +0.41] | +0.34 | none | noise |
| below league | vac_any | 101 / 102 | +0.07 | +0.83 [-0.49, +2.14] | -0.61 | none | within-season only |
| below league | vac_large | 29 / 102 | +0.57 | +1.66 [-0.01, +3.32] | -0.52 | none | within-season only |
| below league | hot_last1 | 26 / 177 | -1.34 | +0.47 [-0.81, +1.76] | -0.42 | none | within-season only |

**LeBron James** (top 50), 13 conditions with n >= 15:

| side | condition | n in / out | raw | shrunk [95%] | vs league mean | flag vs league | condition persistence |
|---|---|---|---|---|---|---|---|
| above league | out_top1 | 16 / 170 | +3.55 | +2.62 [+0.41, +4.83] | +0.59 | none | PERSISTENT |
| above league | vac_star | 40 / 146 | +2.86 | +2.40 [+0.61, +4.18] | +0.55 | none | PERSISTENT |
| above league | bb_last1 | 32 / 154 | +1.19 | -0.41 [-1.46, +0.64] | +0.30 | none | within-season only |
| below league | def_best5 | 27 / 159 | -2.70 | -0.99 [-2.04, +0.06] | -0.27 | none | noise |
| below league | vac_any | 106 / 80 | +1.02 | +1.25 [-0.07, +2.58] | -0.18 | none | within-season only |
| below league | hot_last1 | 42 / 144 | +0.42 | +0.77 [-0.46, +2.00] | -0.13 | none | within-season only |

## 9. Caveats and data gaps

- Associational, not causal. A player's response to 'top scorer out' mixes role (second option vs role player), minutes, lineups and opponent adjustments; it is a pattern in his games, not a trait he carries to another team.
- Teammates out is observed from the box score of the game itself (inactive or non-coach DNP); it is knowable at about tip-off, not days ahead. Team changes between periods are not modelled: a player who moved teams has a different set of teammates in the two periods.
- One held-out season is short. Persistence of per-player significance is low-powered; the correlation, calibration slope and sign repeat are the fairer reads. Cross-season correlations use players with 10+ games on both sides in both periods, so rare conditions (3+ rest days, role changes, best/worst-5 defence) can be tested for few players only.
- Odd-even and random halves share the same seasons: they overstate persistence (team-specific and spell-specific effects). We only call something 'persistent' if it also shows across seasons.
- The conditions overlap (rest 0 = second night of a back-to-back; best-5 within best-10; vacuum measures): 28 conditions x 5 outcomes = 140 cells per segment are tested. Persistence uses BH q < 0.10 over those cells; flags use a permutation expectation per cell, not a multiplicity correction across cells.
- Event outcomes (1.25x, 1.5x, 2.0x, +10) are sparse per player (a 1.5x night is about 16% of games, 2.0x about 4%): their per-player intervals are wide and most shrink to the league mean. Pp effects scale with a player's base rate, so we report a partial correlation controlling for it.
- The effect against the prior season-to-date average inherits the baseline lag found in BIG_NIGHTS.md (after a hot game or a minutes increase the season average is stale). Those two conditions are at least partly 'average is out of date', not response.
- The persistent responders are largely the same names under 'top scorer out' and '20+ PPG teammate out' (role players who become primary options when a team's leading scorer sits); their effect is a role effect on their team, not a portable trait, and players who changed teams between periods are compared across different casts.
- Stars: top 25 and top 10 are always thin (25 and 10 players) and reuse the top 50 EB parameters; only top 100 and top 50 can be ranked.
- 2026-27 and the pooled spans that include it are provisional. The 2023-24 + 2024-25 span is an internal training span, not an app timespan (rows carry `aux_training_span`).
- Not available: sportsbook lines (so no edge calculation), defender matchups, referee crews, pregame injury report beyond the inactive list, play-by-play.

## 10. App insights (what App Builder could add or change)

1. **Show 'responds to the top scorer being out' for players who clear the bar** (add). The one player-specific pattern that persists across seasons: players differ in how much they gain when their team's top scorer is out (dev: temporal r +0.39 [+0.17, +0.57], tau 1.4 pts around a league mean of +2.0). Show the shrunk effect with its interval and n for players flagged vs league (strong or watch), never the raw difference; wording 'associated with'; trigger from the inactive list.
2. **Do not ship player-specific cards for the noise conditions** (change). Back-to-back and rest days, defence tier, pace, opponent recent form, minutes down, 3+ rest and role change have no player-specific effect that survives out of sample (and nothing measurable at all for most of them). Show the league-level effect and a 'tested, no player pattern persists' note instead of a player ranking.
3. **Label within-season-only patterns as 'this season only' or hide them** (change). Home/away, hot game, bounce-back (dev), minutes up, early vs late, worst-5 defence and the any-teammate-out measures are consistent within a season but do not predict the next season. If shown at all, mark 'this season, may reflect the current team situation', and never as a trait.
4. **Stars: league-level effects only** (change). No condition has a persistent player-specific effect among the top 100 / 50, and the cross-season test is mostly under-powered for them. For stars show the pooled league effects from BIG_NIGHTS, not individual responder lists.
5. **Use shrunk estimates and the vs-league flag** (change). `flag` (differs from zero) is a statement about the league mean whenever tau is about 0. Use `flag_vs_league` (+ shrunk interval + n both sides) for who responds differently, and show the reliability (EB reliability about 0.3 to 0.45 for the persistent cells: a player's raw estimate is mostly noise).
6. **Show flagged-vs-chance beside any list** (add). Print the expected-by-chance count beside the flagged count (about 0 for vs-league flags under the permutation null) and the persistence verdict of the condition; do not rank a condition whose verdict is noise.
7. **Hide 2026-27 per-player condition rows** (change). 2026-27 has at most a few players with 3+ games on both sides of a condition; the held-out check is empty. Mark provisional or hide.
8. **Do not present these as betting edges** (change). The effects are in points against the player's own prior average, not against a line; league-wide parts are already visible to the market. Use as context ('responds more than most when X'), not as a bet.

## 11. Files

`player_conditions` (one row per timespan x condition x outcome x player: n both sides, means, raw difference with SE and 95% interval, shrunk estimate and interval, `flag` / `flag_vs_league` with direction and the held-out marks for all / top100 / top50, persistence class), `player_conditions_summary` (timespan x segment x condition x outcome: n players, league mean, tau, EB reliability, flagged counts with permutation expectation, sd, 95th percentile and p; thin and provisional flags), `player_conditions_persistence` (scheme x segment x condition x outcome: correlations with CIs, Spearman-Brown, reliabilities, calibration slope, partial r, flag hit rates), `player_conditions_reliability` (one row per condition x outcome x segment: classification, verdict, key figures), `player_conditions_responders` (top 10 each way per condition x outcome, segments all / top100 / top50, with persistence marks), `player_conditions_profiles` (per player: three most and three least affected conditions for dev / 1.5x / +10), `player_conditions_definitions`; manifest `data/marts/player_conditions_manifest.json`. DuckDB: same names as views in `data/marts/nba_phase1.duckdb`. App summary: `data/player_conditions_summary.json` (new, not read by the app).
