"""Writes DEEP_ANALYSES.md from the deep marts (numbers generated, narrative fixed)."""
import json, sys
from pathlib import Path
import duckdb, numpy as np, pandas as pd
ROOT = Path(__file__).resolve().parents[1]; M = ROOT / "data" / "marts"
con = duckdb.connect(str(M / "nba_phase1.duckdb"), read_only=True)
q = lambda s: con.sql(s).df()
man = json.load(open(ROOT / "data" / "manifests" / "deep_analyses.json"))
SEG = ["all", "top100", "top50", "top25", "top10"]


def f(x, d=2, pct=False, sign=True):
    if x is None or pd.isna(x): return "n/a"
    v = x * 100 if pct else x
    return f"{v:+.{d}f}" if sign else f"{v:.{d}f}"


def ci(r, d=2, pct=False, lo="ci_low", hi="ci_high"):
    return f"{f(r['diff'] if 'diff' in r else r['estimate'], d, pct)} [{f(r[lo], d, pct)}, {f(r[hi], d, pct)}]"


def md(df):
    cols = list(df.columns); out = ["| " + " | ".join(cols) + " |", "|" + "|".join(["---"] * len(cols)) + "|"]
    for r in df.itertuples(index=False): out.append("| " + " | ".join("" if (isinstance(v, float) and np.isnan(v)) else str(v) for v in r) + " |")
    return "\n".join(out)


def thin(r): return " (thin)" if r["thin_level"] else ""


L = []; A = L.append
TS = "pooled_2023_26"
A(f"""# DEEP_ANALYSES: tiers, tails, interactions and per-player depth (hoopstats)

Data through **{man['through']}**; {man['rows']:,} eligible pregame player-games (2023-24 to 2026-27 to date). Scripts: `scripts/deep_data.py` (dataset), `scripts/deep_analyses.py` (cells, interactions, random slopes, per-player), `scripts/deep_assemble.py` (marts, views, manifest, `data/deep_analyses_summary.json`), `scripts/deep_report.py` (this file). Everything is **pregame** (strictly prior games). Language: *associated with / predicts*, never causes.

Cavin's challenge: *stars tend to have big nights against poor teams; linear mean-only models could miss that.* Tested below with tier cuts, splines, big-night tails, quantile regression, dispersion, interactions, partial pooling, per-player shrinkage. Nothing here was set up to confirm the claim: the same machinery also reports the opposite tail (good defences), the stability across seasons, and out-of-sample skill versus base rates.

## 1. Headline

""")
# headline numbers
t = q(f"""select segment, level, outcome, est_level, est_ref, diff, ci_low, ci_high, ratio, ratio_ci_low, ratio_ci_high, n_level, n_players_level, thin_level from tier_effects where timespan='{TS}' and dimension='opp_defence_nested' and level in ('worst5','worst10','best10')""")
g = lambda sg, lv, o: t[(t.segment == sg) & (t.level == lv) & (t.outcome == o)].iloc[0]
a5, a10, s5, s10 = g("all", "worst5", "dev"), g("all", "worst10", "dev"), g("top50", "worst5", "dev"), g("top50", "worst10", "dev")
b5, b10 = g("top50", "worst5", "big10"), g("top50", "worst10", "big10")
x5, x10 = g("top50", "worst5", "x125"), g("top50", "worst10", "x125")
bb = g("top50", "best10", "dev"); bbb = g("top50", "best10", "big10"); bbx = g("top50", "best10", "x125")
lg = q(f"""select segment, outcome, model, term, estimate, ci_low, ci_high, abs_prob_diff, abs_prob_diff_lo, abs_prob_diff_hi, base_rate from tail_models where timespan='{TS}' and model='logit_ctx_nested' and term in ('def_worst10','def_best10')""")
lr = lambda sg, o, tm: lg[(lg.segment == sg) & (lg.outcome == o) & (lg.term == tm)].iloc[0]
w10 = lr("top50", "big10", "def_worst10"); wx = lr("top50", "x125", "def_worst10"); bw = lr("top50", "big10", "def_best10"); bx = lr("top50", "x125", "def_best10")
per = q("""select timespan, level, outcome, diff, ci_low, ci_high from tier_effects where segment='top50' and dimension='opp_defence_nested' and level='worst5' and outcome in ('dev','big10') and timespan in ('2023_24','2024_25','2025_26')""")
pr = lambda ts, o: per[(per.timespan == ts) & (per.outcome == o)].iloc[0]
A(f"""**Do stars pop against poor defences? Partly on the mean, weakly on the tails, and the pattern is asymmetric and not stable across seasons.**

1. **Mean (unadjusted, vs the other defences).** Games against the 5 worst defences (as-of DRtg rank, pooled 2023-24 to 2025-26) are {f(a5['diff'])} PTS above the player's prior average relative to games against the other 25 defences for everyone [{f(a5['ci_low'])}, {f(a5['ci_high'])}], and **{f(s5['diff'])} [{f(s5['ci_low'])}, {f(s5['ci_high'])}] for the top 50 scorers** (bottom 10: {f(a10['diff'])} all, {f(s10['diff'])} [{f(s10['ci_low'])}, {f(s10['ci_high'])}] top 50). In points the star effect is about double the all-player effect, in relative terms (ratio of big-night rates) it is about the same.
2. **Tails (unadjusted).** Top-50 P(PTS >= prior avg + 10) is {f(b5['est_level'], 1, pct=True, sign=False)}% against bottom-5 defences vs {f(b5['est_ref'], 1, pct=True, sign=False)}% against the rest (difference {f(b5['diff'], 1, pct=True)} pp [{f(b5['ci_low'], 1, pct=True)}, {f(b5['ci_high'], 1, pct=True)}], ratio {b5['ratio']:.2f}); P(PTS >= 1.25 x prior avg) {f(x5['est_level'], 1, pct=True, sign=False)}% vs {f(x5['est_ref'], 1, pct=True, sign=False)}% ({f(x5['diff'], 1, pct=True)} pp [{f(x5['ci_low'], 1, pct=True)}, {f(x5['ci_high'], 1, pct=True)}]).
3. **Adjusted tails (logit, controls for prior average, usage, minutes, role, position, season progress, pace, rest, home; vs the middle 10 defences).** Top-50 bottom-10 defences: big10 odds ratio {w10['estimate']:.2f} [{w10['ci_low']:.2f}, {w10['ci_high']:.2f}] (absolute {f(w10['abs_prob_diff'], 1, pct=True)} pp [{f(w10['abs_prob_diff_lo'], 1, pct=True)}, {f(w10['abs_prob_diff_hi'], 1, pct=True)}]); x1.25: {wx['estimate']:.2f} [{wx['ci_low']:.2f}, {wx['ci_high']:.2f}] ({f(wx['abs_prob_diff'], 1, pct=True)} pp [{f(wx['abs_prob_diff_lo'], 1, pct=True)}, {f(wx['abs_prob_diff_hi'], 1, pct=True)}]). **The CI includes 1: no credible extra big-night probability for top-50 stars against bottom-10 defences once the other conditions are held fixed.** All players pooled do show a small credible uplift (big10 OR {lr('all', 'big10', 'def_worst10')['estimate']:.2f} [{lr('all', 'big10', 'def_worst10')['ci_low']:.2f}, {lr('all', 'big10', 'def_worst10')['ci_high']:.2f}]).
4. **The sharper asymmetry is on the other side.** Top-50 stars against top-10 defences: {f(bb['diff'])} PTS [{f(bb['ci_low'])}, {f(bb['ci_high'])}] vs the other defences; adjusted big10 OR {bw['estimate']:.2f} [{bw['ci_low']:.2f}, {bw['ci_high']:.2f}], x1.25 OR {bx['estimate']:.2f} [{bx['ci_low']:.2f}, {bx['ci_high']:.2f}] (CI excludes 1). Elite defences are associated with fewer big nights for stars; weak defences are associated with at most a small increase.
5. **Not stable across seasons.** Top-50 vs bottom-5 defences, PTS vs prior average: 2023-24 {ci(pr('2023_24', 'dev'))}, 2024-25 {ci(pr('2024_25', 'dev'))}, 2025-26 {ci(pr('2025_26', 'dev'))}; big10 difference 2023-24 {f(pr('2023_24', 'big10')['diff'], 1, pct=True)} pp, 2024-25 {f(pr('2024_25', 'big10')['diff'], 1, pct=True)} pp, 2025-26 {f(pr('2025_26', 'big10')['diff'], 1, pct=True)} pp. The adjusted top-50 big10 odds ratio for bottom-10 defences is 1.56 [1.17, 2.09] in 2023-24, 0.77 [0.58, 1.03] in 2024-25 and 1.05 [0.78, 1.40] in 2025-26. The pooled star effect leans heavily on 2023-24.
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
""")

# 3 tier table
A("## 3. Defence tiers (means and tails)\n")
A(f"Unadjusted contrast of each nested group with the complement, **{TS}**; est [95% CI] player-clustered. dev in PTS, big-night columns in percentage points of probability. Thin segments (top25, top10 < 30 players) are flagged.\n")
rows = []
tt = q(f"""select segment, level, outcome, diff, ci_low, ci_high, thin_level, n_level from tier_effects where timespan='{TS}' and dimension='opp_defence_nested'""")
for sg in SEG:
    for lv in ["worst5", "worst10", "best10", "best5"]:
        r = {"segment": sg + (" (thin)" if tt[(tt.segment == sg)].thin_level.all() and sg in ("top25", "top10") else ""), "vs": lv}
        for o, d, pct in (("dev", 2, False), ("big5", 1, True), ("big10", 1, True), ("x125", 1, True)):
            x = tt[(tt.segment == sg) & (tt.level == lv) & (tt.outcome == o)].iloc[0]; r[o] = ci(x, d, pct)
        r["games"] = int(tt[(tt.segment == sg) & (tt.level == lv) & (tt.outcome == "dev")].n_level.iloc[0]); rows.append(r)
A(md(pd.DataFrame(rows)))
A("\nExclusive five-way tiers (vs middle 11-20), top 50 and all players, dev (PTS):\n")
ex = q(f"""select segment, level, diff, ci_low, ci_high, n_level from tier_effects where timespan='{TS}' and dimension='opp_defence_tier' and outcome='dev' and segment in ('all','top100','top50')""")
rows = [{"segment": sg, **{lv: ci(ex[(ex.segment == sg) & (ex.level == lv)].iloc[0]) for lv in ["worst5", "worst6_10", "best6_10", "best5"]}} for sg in ("all", "top100", "top50")]
A(md(pd.DataFrame(rows)))
A("\nReading: the lift is concentrated in the worst 5 (ranks 26-30); ranks 21-25 look like the middle; the best 10 defences carry the larger, cleaner effect (negative).\n")
A("### Stability by season (bottom-5 defences vs the other 25, PTS vs prior average and big10 pp)\n")
ps = q("""select timespan, segment, outcome, diff, ci_low, ci_high from tier_effects where dimension='opp_defence_nested' and level='worst5' and outcome in ('dev','big10') and timespan in ('2023_24','2024_25','2025_26','pooled_2023_26') and segment in ('all','top100','top50')""")
rows = []
for sg in ("all", "top100", "top50"):
    r = {"segment": sg}
    for ts in ("2023_24", "2024_25", "2025_26"):
        for o, d, pct in (("dev", 2, False), ("big10", 1, True)):
            r[f"{ts} {o}"] = ci(ps[(ps.timespan == ts) & (ps.segment == sg) & (ps.outcome == o)].iloc[0], d, pct)
    rows.append(r)
A(md(pd.DataFrame(rows)))
cnt = q("""select level, outcome, count(*) n, sum((ci_low>0)::int) pos, sum((ci_high<0)::int) neg from tier_effects where dimension='opp_defence_nested' and not thin_level and not suppressed_n_lt_30 and level in ('worst5','worst10','best10','best5') group by all order by 1,2""")
A("\n**Counts (expected by chance if there were no effect: about 2.5% of cells per side, i.e. 0.4 of ~15):** across the non-thin cells (overlapping windows, so not independent), CI above 0 for worst5/worst10 in 10-13 of 15-16 cells and CI below 0 for best5/best10 in 9-14 of 15-16 cells, for dev, big5, big10 and x1.25 alike (full counts in `tier_effects`). The direction is consistent; the star-specific part is what the interaction tests in section 7 address.\n")

# 4 splines
A("## 4. Splines and non-linearity (mean of PTS - prior average)\n")
nw = q("""select variable, segment, count(*) n, sum((wald_p<0.05)::int) p05, round(0.05*count(*),1) expected from spline_effects where kind='nonlinearity_wald' and n_cell_players>=30 group by all order by 1,2""")
A("Cluster-robust Wald test that a natural cubic spline (df 5) adds anything to the linear term, given the other linear controls; non-thin cells; BH is not applied across these (counts vs chance shown instead).\n")
A(md(nw.rename(columns={"p05": "cells p<0.05", "expected": "expected by chance"})))
cv = q(f"""select segment, variable, x, fit_pts_vs_prior_avg f from spline_effects where kind='curve' and timespan='{TS}' and variable in ('opp_def_u','opp_pace_u') and x in (1,5,10,15,20,25,30) and segment in ('all','top50')""")
pv = cv.pivot_table(index=["variable", "segment"], columns="x", values="f").round(2).reset_index()
pv.columns = [str(c) for c in pv.columns]
A("\nFitted PTS vs prior average (spline, other covariates at mean) by opponent rank from the worst defence (1) to the best (30), and for pace from the fastest (1) to the slowest (30); CIs are in `spline_effects`:\n")
A(md(pv))
A("\nShape: for all players the opponent curves are close to linear (Wald p about 0.4-0.97). For the top 100 and top 50 scorers the defence curve is elevated over the worst ~8 defences (+0.4 to +0.8), about 0 across ranks 10-22 and then falls steeply (top 50: -1.45 at rank 30); the top-25 curve is flat to rank 22 and then falls. The pace curve is steeper at the fast end for top 25/50.\n")
mm = q("""select model, count(*) cells, sum((mae_gain_vs_controls_lo>0)::int) beats_controls, sum((mae_gain_vs_linear_lo>0)::int) beats_linear, sum((mae_gain_vs_linear_hi<0)::int) worse_than_linear, sum((mae_gain_vs_prior_average_lo>0)::int) beats_prior_avg from spline_effects where kind='mean_model' and n_cell_players>=30 group by 1 order by 1""")
A("Out-of-sample (non-thin cells, test = last ~20% of dates, MAE of PTS; paired player-cluster bootstrap CI on the gain). `controls` = prior avg, usage, minutes, season progress, role; `linear` adds linear opponent DRtg/pace, home, B2B; `tiers` bins; `spline` df 4; `spline_plus_player` also splines the player terms.\n")
A(md(mm))
A("\n**Result:** adding opponent context beats controls-only in about half the cells, but tier bins and splines are **not** better than the linear specification in a majority of cells (gain vs linear has CI above 0 in 1-2 of 16, below 0 in 1-3 of 16). The prior season-to-date average alone is a hard baseline to beat; a regression of dev on controls does not beat it in the test period for the star segments (late-season dev is lower than in training; see calibration note). Non-linearity is real in-sample for stars, but it does not translate into out-of-sample accuracy gains at this sample size.\n")

# 5 pace usage minutes rest
A("## 5. Pace, usage, minutes, rest tiers\n")
A(f"{TS}, dev (PTS vs prior average) and big10 (pp), contrasts with the reference level (pace and defence: middle; usage u2; minutes m2; rest r1 = one day). Segments all and top50. Cells with < 30 games are null.\n")
dd = q(f"""select segment, dimension, level, outcome, diff, ci_low, ci_high, n_level from tier_effects where timespan='{TS}' and segment in ('all','top50') and dimension in ('opp_pace_tier','usage_tier','minutes_tier','rest_days') and outcome in ('dev','big10')""")
rows = []
for (sg, dim, lv), gx in dd.groupby(["segment", "dimension", "level"], sort=False):
    r = {"segment": sg, "dimension": dim, "level": lv, "games": int(gx.n_level.iloc[0])}
    for o, d, pct in (("dev", 2, False), ("big10", 1, True)):
        x = gx[gx.outcome == o]; r[o] = ci(x.iloc[0], d, pct) if len(x) and not pd.isna(x.iloc[0]["diff"]) else "n/a (n<30)"
    rows.append(r)
A(md(pd.DataFrame(rows)))
A("""
Reading: **opponent pace is as strong as opponent defence** and also nonlinear for stars (fastest 5: top-50 +1.1 PTS, big10 +3.7 pp; slowest 5: -0.9 PTS, -2.3 pp). Rest: more rest days go with a smaller excess over the prior average for everyone (r0 +0.26, r2 -0.09, r3+ -0.33 PTS vs r1), not for the top 50 (null). Usage and minutes tiers: the high-usage/high-minutes tiers sit lower on dev (baseline regression, see section 2); in the star segments the usage and minutes cells are nearly empty at the low tiers (2-5 games, suppressed). Within-tier interaction with defence is in section 7.
""")

# 6 tails
A("## 6. Tails: odds ratios, absolute differences, quantile shifts, skill\n")
A("Logistic (player-clustered SEs, AME CI from 400 draws of the clustered covariance), controls: prior avg, usage, minutes, season progress (log prior games), role, position; terms vs the middle 10 defences/pace. `logit_ctx_nested` is used for the bottom-10/top-10 questions. Full-spec results (worst5 / worst6_10 separately, pace tiers, home, B2B) are in `tail_models`.\n")
rows = []
for sg in SEG:
    for tm in ("def_worst10", "def_best10"):
        r = {"segment": sg + (" (thin)" if sg in ("top25", "top10") else ""), "term": tm}
        for o in ("big5", "big10", "x125"):
            x = lg[(lg.segment == sg) & (lg.outcome == o) & (lg.term == tm)]
            r[o + " OR"] = f"{x.iloc[0]['estimate']:.2f} [{x.iloc[0]['ci_low']:.2f}, {x.iloc[0]['ci_high']:.2f}]" if len(x) else "n/a (not fitted)"
            r[o + " abs pp"] = f"{f(x.iloc[0]['abs_prob_diff'], 1, True)} [{f(x.iloc[0]['abs_prob_diff_lo'], 1, True)}, {f(x.iloc[0]['abs_prob_diff_hi'], 1, True)}]" if len(x) else "n/a"
        rows.append(r)
A(md(pd.DataFrame(rows)))
qr = q(f"""select segment, outcome, term, estimate, ci_low, ci_high from tail_models where timespan='{TS}' and model like 'quantreg%' and term in ('def_worst5','def_best5') and segment in ('all','top100','top50')""")
rows = []
for sg in ("all", "top100", "top50"):
    r = {"segment": sg}
    for o in ("dev_q75", "dev_q90"):
        for tm in ("def_worst5", "def_best5"):
            x = qr[(qr.segment == sg) & (qr.outcome == o) & (qr.term == tm)].iloc[0]; r[f"{o} {tm}"] = ci(x)
    rows.append(r)
A("\nQuantile regression of dev (PTS vs prior avg), shift in PTS at the 75th and 90th percentile vs middle-10 defences (adjusted; 100 player-cluster bootstrap refits):\n")
A(md(pd.DataFrame(rows)))
A("\nThe worst-5 shift at p75/p90 is positive for all players (p75 +0.36 [+0.18, +0.54]) and not distinguishable from 0 for stars (top 50 p75 +0.61 [-0.14, +1.29]; p90 -0.40 [-1.20, +0.64]); the best-5 shift at p75 is negative with CI below 0 for all/top100/top50. The p90 tail for stars is too noisy to say anything.\n")
pf = q("""select outcome, model, count(*) cells, sum((logloss_gain_vs_base_rate_lo>0)::int) beats_base, sum((logloss_gain_vs_logit_player_lo>0)::int) ctx_beats_player, sum((logloss_gain_vs_logit_player_hi<0)::int) worse_than_player from tail_performance where model in ('logit_player','logit_ctx','gbm_player','gbm_ctx') and outcome in ('big5','big10','x125') and n_cell_players>=30 group by all order by 1,2""")
A("\n**Out-of-sample skill (non-thin cells; test = last ~20% of dates; log-loss gain with player-cluster bootstrap CI > 0).** Models: base rate (train rate), `logit_player` (player-level controls only), `logit_ctx` (+ defence/pace tiers, home, B2B, opp B2B), `gbm_player`/`gbm_ctx` (HistGradientBoosting, continuous opponent rank/pace, rest, home).\n")
A(md(pf))
tp = q(f"""select segment, outcome, model, base_rate_train, test_rate, test_brier, test_logloss, test_auc, logloss_gain_vs_base_rate, logloss_gain_vs_base_rate_lo, logloss_gain_vs_base_rate_hi, logloss_gain_vs_logit_player, logloss_gain_vs_logit_player_lo, logloss_gain_vs_logit_player_hi, cal_slope from tail_performance where timespan='{TS}' and outcome in ('big10','x125') and segment in ('all','top100','top50') and model in ('base_rate','logit_player','logit_ctx','gbm_ctx')""")
rows = []
for r in tp.itertuples():
    rows.append({"segment": r.segment, "outcome": r.outcome, "model": r.model, "train rate": f(r.base_rate_train, 1, True, False), "test rate": f(r.test_rate, 1, True, False), "Brier": f"{r.test_brier:.4f}", "log-loss": f"{r.test_logloss:.4f}", "AUC": f"{r.test_auc:.3f}",
                 "LL gain vs base": f"{f(r.logloss_gain_vs_base_rate, 4)} [{f(r.logloss_gain_vs_base_rate_lo, 4)}, {f(r.logloss_gain_vs_base_rate_hi, 4)}]" if not pd.isna(r.logloss_gain_vs_base_rate) else "",
                 "LL gain vs player-only": f"{f(r.logloss_gain_vs_logit_player, 4)} [{f(r.logloss_gain_vs_logit_player_lo, 4)}, {f(r.logloss_gain_vs_logit_player_hi, 4)}]" if not pd.isna(r.logloss_gain_vs_logit_player) else "", "cal slope": f(r.cal_slope, 2, sign=False)})
A(f"\nDefault window {TS}, big10 and x1.25 (positive gain = better than reference):\n")
A(md(pd.DataFrame(rows)))
A("""
**Reading.** (a) Big-night skill is **small**: AUC 0.55-0.61; against the train base rate, `logit_ctx` has a log-loss gain with CI above 0 in 1 of 16 big10, 3 of 17 big5 and 6 of 17 x1.25 cells (largest: x1.25 all players, about +0.017), and most of that comes from the player-level controls. (b) Adding defence/pace/rest/home context to the player-level logistic helps a little (x1.25 all players +0.0024 [+0.0017, +0.0032] log-loss; significantly better in 5 of 17 x1.25 cells, 3 of 16 big10, 3 of 17 big5) and does not help the star segments (CIs include 0). (c) **Gradient boosting never beats the additive logistic** (0 of 15 cells for each outcome, and significantly worse in 2-4), so there is no evidence that a flexible model finds a star x poor-defence interaction the logistic misses. (d) Calibration: in the star segments the **test-period big-night rate is lower than in training** (top 50 big10: 11.3% train, 8.1% test), so every model, including the base rate, is over-predicted in the test window (calibration slope 0-0.5, intercept about -1 to -2.4). That is a date-shift of the baseline definition (late-season prior averages are more stable; early-season ones noisier), not a failure specific to the context terms; the log-loss gains versus the player-only model are the cleaner comparison. Calibration deciles are in `tail_calibration`.
""")

# 7 dispersion
A("## 7. Dispersion (SD of PTS - prior average)\n")
A("Ratio of SDs with a 500-resample player-cluster bootstrap CI (naive Levene/Brown-Forsythe p, which ignores clustering, is in `dispersion_effects.levene_p_naive`).\n")
dp = q(f"""select segment, condition, reference, sd_condition, sd_reference, sd_ratio, ci_low, ci_high, thin_level from dispersion_effects where timespan='{TS}' and condition in ('worst5','worst10','best10','home','b2b_2nd')""")
rows = []
for sg in SEG:
    r = {"segment": sg + (" (thin)" if sg in ("top25", "top10") else "")}
    for c in ("worst5", "worst10", "best10", "home", "b2b_2nd"):
        x = dp[(dp.segment == sg) & (dp.condition == c)]
        r[c] = f"{x.iloc[0]['sd_ratio']:.3f} [{x.iloc[0]['ci_low']:.3f}, {x.iloc[0]['ci_high']:.3f}]" if len(x) else "n/a"
    rows.append(r)
A(md(pd.DataFrame(rows)))
dc = q("""select condition, count(*) n, sum((ci_low>1)::int) above1, sum((ci_high<1)::int) below1 from dispersion_effects where not thin_level group by 1 order by 1""")
A(f"""
Ratios are vs the middle 10 defences (worst5/worst10/best10), vs away (home), vs rested (b2b_2nd). Stars have more spread against poor defences (top 25: 1.10 [1.04, 1.16]; top 10: 1.18 [1.10, 1.24]; top 50: 1.05 [1.007, 1.09]); for all players the ratio is 1.016 [0.999, 1.033]. Stars are less dispersed at home (top 50: 0.95 [0.92, 0.99]). Counts over non-thin cells (CI above 1 / below 1; chance about 2.5% per side): {'; '.join(f"{r.condition} {int(r.above1)}/{int(r.below1)} of {r.n}" for r in dc.itertuples())}. More upside variance vs weak defences is consistent with the larger unadjusted star mean shift; it is not the same as a higher probability of a +10 night after controls (section 6).
""")

# 8 interactions
A("## 8. Interactions and partial pooling\n")
A("""Segment x condition and moderator x condition on the 'all players' population per timespan (train-only PPG-rank groups: 1-10, 11-25, 26-50, 51-100, rest). Model per condition (bottom-10 defence, bottom-5, top-10, home, B2B 2nd night): `outcome ~ condition x group + other conditions + prior-avg z + season progress` (OLS for dev, linear-probability and logit for big-night outcomes), player-clustered SEs; effect shown per level = condition + interaction; `interaction_p` = Wald test of the whole interaction block. Groups with < 30 players are flagged thin.
""")
ie = q("""select moderator, level, estimate, ci_low, ci_high, interaction_p, n_players_level, thin_level from interaction_effects where timespan='pooled_2023_26' and condition='worst10' and outcome='dev' and model='ols' and moderator!='player_random_slope'""")
rows = [{"moderator": r.moderator, "level": r.level, "bottom-10 defence effect on dev (PTS)": f"{f(r.estimate)} [{f(r.ci_low)}, {f(r.ci_high)}]", "interaction p": f"{r.interaction_p:.4f}", "players": r.n_players_level, "thin": r.thin_level} for r in ie.itertuples()]
A(md(pd.DataFrame(rows)))
ix = q("""select moderator, level, estimate, ci_low, ci_high, interaction_p, n_players_level, thin_level from interaction_effects where timespan='pooled_2023_26' and condition='worst10' and outcome='x125' and model='logit' and moderator in ('ppg_rank_group','position','role')""")
A("\nSame for P(PTS >= 1.25 x prior avg), odds ratio of bottom-10 defences (logit):\n")
A(md(pd.DataFrame([{"moderator": r.moderator, "level": r.level, "OR": f"{r.estimate:.2f} [{r.ci_low:.2f}, {r.ci_high:.2f}]", "interaction p": f"{r.interaction_p:.4f}", "players": r.n_players_level, "thin": r.thin_level} for r in ix.itertuples()])))
ic = q("""select moderator, outcome, model, count(*) n_tests, sum((p<0.05)::int) p05, round(0.05*count(*),1) expected from (select distinct timespan,moderator,condition,outcome,model,interaction_p p from interaction_effects where moderator!='player_random_slope' and interaction_p is not null) group by all order by 1,2,3""")
A(f"""
**Reading.** (1) The bottom-10-defence effect on dev **varies with segment** (interaction p = 0.015) but not monotonically: +0.26 for the rest, +0.42 (51-100), **+1.11 (26-50)**, +0.23 (11-25, thin), +0.24 (1-10, thin): the very top scorers do not show the largest effect, so there is no clean "bigger star, bigger pop". (2) **Position and role matter more:** centers +0.88 PTS vs guards +0.22 (p = 0.0003), starters +0.48 vs bench +0.22 (p = 0.010); minutes: +0.12 (<20) rising to +0.59 (34+) (p = 0.002); usage tier: no detectable difference (p = 0.19). In odds ratios for x1.25, centers 1.35 [1.23, 1.49] vs guards 1.02 [0.97, 1.07]. (3) Counts of interaction tests with p < 0.05 vs expected by chance are in `interaction_effects` (e.g. for dev: minutes 14 of 30, position 11 of 30, role 12 of 30, segment 16 of 30, usage 4 of 30, vs 1.5 expected; these tests are on overlapping windows and are not independent). Usage is the one moderator with no signal. (4) These are associations adjusted for the listed controls, not causes.

**Random slopes (partial pooling).** MixedLM with a random intercept and a random slope on bottom-10 defence per player (bfgs/powell; `lbfgs` is unreliable here): all fits report convergence but 11 of 18 (all 6 big10 fits and 5 of 6 dev fits) have a slope-intercept correlation of about +/-1 or a fixed effect that departs from the OLS estimate, i.e. are unstable; the 6 x1.25 fits are stable ("stable" flag in `interaction_effects`, model `mixedlm_random_slope`). Fixed effects agree with the OLS player-clustered estimate (dev, all players: MixedLM +0.32 [+0.21, +0.44] vs OLS +0.33 [+0.22, +0.44]; top 50 +0.54 [+0.10, +0.97] vs +0.55 [+0.18, +0.92]). Because the random-slope variance is not reliably identified, **the empirical-Bayes shrinkage in section 9 is the primary partial-pooling result** (DerSimonian-Laird tau, normal-normal shrinkage, with the pooled-mean uncertainty included in the intervals).
""")

# 9 per player
A("## 9. Per-player depth (shrunk effects, FDR and watch flags)\n")
A("""One row per player x condition x outcome in `player_deep_splits` (conditions: bottom-5 defences vs the rest, bottom-10 vs the rest, home vs away, B2B 2nd night vs rested; outcomes: dev, big5, big10, x1.25). Raw difference with a t-free normal CI (dev: SE from the player's SD of dev over all his eligible games; probabilities: Agresti-Caffo SE), DerSimonian-Laird tau^2 across qualifying players, normal-normal shrunk estimate and interval (including the pooled-mean uncertainty), z, p, **Benjamini-Hochberg q** (strong: q < 0.10), **watch** (|z| >= 2.5, not strong). **Expected-by-chance counts sit beside every flag count**: watch ~ k x 2 x P(|Z| >= 2.5) = 1.24% of players; p < 0.05 ~ 5%. Floors: bottom-5 >= 5 vs >= 10 games, bottom-10 >= 8 vs >= 10, home/away >= 8 each, B2B >= 5 vs >= 10 (provisional 2026-27: 2-3 vs 3-5). `credible_above_league` = the player's shrunk interval (player evidence only) lies above the pooled mean = this player differs from the typical player.
""")
ps_ = q(f"""select timespan, condition, outcome, n_players, league_mean_diff mu, league_mean_ci_low lo, league_mean_ci_high hi, tau, n_flag_strong_q10 strong, n_flag_watch_z25 watch, expected_watch_by_chance exp_watch, n_p_lt_05 p05, expected_p_lt_05_by_chance exp_p05, n_above_league above_league, n_below_league below_league, n_above_league_top50 above_top50 from player_deep_summary where timespan='{TS}' order by condition, outcome""")
rows = [{"condition": r.condition, "outcome": r.outcome, "players": r.n_players, "league mean [CI]": f"{r.mu:+.3f} [{r.lo:+.3f}, {r.hi:+.3f}]", "tau": f"{r.tau:.3f}", "strong q<.10": r.strong, "watch |z|>=2.5": r.watch, "expected watch by chance": f"{r.exp_watch:.1f}", "p<0.05": r.p05, "expected p<0.05": f"{r.exp_p05:.1f}", "above league": r.above_league, "below league": r.below_league} for r in ps_.itertuples()]
A(f"{TS} (other timespans in the table):\n")
A(md(pd.DataFrame(rows)))
st = q(f"""select player_name, condition, outcome, n_cond, n_ref, mean_cond, mean_ref, raw_diff, shrunk_diff, z, q, flag from player_deep_splits where timespan='{TS}' and in_top50 and flag is not null and condition in ('worst5','worst10','b2b_2nd_vs_rested','home_vs_away') order by flag desc, condition, outcome, z desc""")
A("\n**Top-50 scorers carrying a flag in the default window** (strong first). Compare with ~0.6 watch flags expected by chance per condition-outcome among 50 players:\n")
A(md(pd.DataFrame([{"player": r.player_name, "condition": r.condition, "outcome": r.outcome, "n": f"{r.n_cond}/{r.n_ref}", "raw": f"{r.raw_diff:+.3f}", "shrunk": f"{r.shrunk_diff:+.3f}", "z": f"{r.z:+.2f}", "q": f"{r.q:.3f}", "flag": r.flag} for r in st.itertuples()])))
tops = q(f"""select player_name, n_cond, n_ref, mean_cond, mean_ref, raw_diff, shrunk_diff, shrunk_ci_low, shrunk_ci_high, z, q from player_deep_splits where timespan='{TS}' and condition='worst10' and outcome='dev' and in_top25 order by raw_diff desc limit 5""")
A("\nLargest raw bottom-10-defence dev differences among the top 25 (shrunk values collapse to the pooled mean, as the shrunk-interval overlap shows):\n")
A(md(pd.DataFrame([{"player": r.player_name, "games vs bottom-10 / other": f"{r.n_cond}/{r.n_ref}", "raw diff (PTS)": f"{r.raw_diff:+.2f}", "shrunk": f"{r.shrunk_diff:+.2f} [{r.shrunk_ci_low:+.2f}, {r.shrunk_ci_high:+.2f}]", "z": f"{r.z:+.2f}", "q": f"{r.q:.2f}"} for r in tops.itertuples()])))
A("""
**Star answer.** For big-night probability (big10) the between-player SD is estimated as 0 for bottom-5, bottom-10, home/away and B2B in every pooled window, so every player's shrunk effect is the pooled mean (+1.2 pp for bottom-10, +1.5 pp for bottom-5, with a league CI above 0): **no top-25 or top-50 player has a player-specific credible big-night uplift versus bottom-5/10 defences; the shared effect applies to everyone**. For the PTS mean (dev) tau is 0.28 (bottom-10) and 0.65 (bottom-5), but no top-50 player's shrunk interval clears the league mean either (0 above-league). Watch counts for the star-relevant big10 outcome (1 of 530 for bottom-10, 6 of 520 for bottom-5 vs 6.6 and 6.5 expected) are at or below chance; the strong flags are Karl-Anthony Towns (big5, higher vs bottom-5/10; q = 0.065-0.074), and B2B-lower flags for Victor Wembanyama (big5, x1.25) and Joel Embiid (x1.25, 8 games), consistent with a handful of flags among ~500 players x 16 tests. Across the 16 condition-outcome tests x 50 stars (800 player-tests) there are 20 flags in the table above (5 strong, 15 watch) against about 10 watch-level flags expected by chance (1.24% of 800); outcomes of the same player are correlated, so these are not 800 independent tests. The flags that point to higher scoring against poor defences are Karl-Anthony Towns (big5 strong; x1.25 and dev watch), Jalen Green (watch on four outcomes vs bottom-5) and Joel Embiid (watch, 14 games); all have shrunk effects close to the pooled mean.
""")

# 10 home/away + b2b
A("## 10. Home/away and back-to-back under the tail/tier lens\n")
hb = q(f"""select segment, dimension, level, outcome, diff, ci_low, ci_high, thin_level from tier_effects where timespan='{TS}' and ((dimension='venue' and level='home') or (dimension='b2b_state' and level in ('2nd','1st'))) and outcome in ('dev','big10','x125')""")
rows = []
for sg in SEG:
    r = {"segment": sg}
    for dim, lv, lab in (("venue", "home", "home vs away"), ("b2b_state", "2nd", "B2B 2nd vs rested"), ("b2b_state", "1st", "B2B 1st vs rested")):
        for o, d, pct in (("dev", 2, False), ("x125", 1, True)):
            x = hb[(hb.segment == sg) & (hb.dimension == dim) & (hb.level == lv) & (hb.outcome == o)].iloc[0]; r[f"{lab} {o}"] = ci(x, d, pct)
    rows.append(r)
A(f"{TS}; dev in PTS, x1.25 in pp:\n")
A(md(pd.DataFrame(rows)))
A("""
**Do the earlier conclusions still hold? Yes.** (Row sets differ slightly from the earlier analysis: eligible pregame rows with >= 5 minutes vs all games with minutes, and dev vs prior average rather than raw PPG.)

- **Back-to-back second night:** earlier: +0.28 PTS for all players, driven by minutes (+0.70 min), nothing for stars. Now: +0.31 PTS vs prior average for all players [+0.17, +0.46], big10 +0.9 pp, x1.25 +2.8 pp; top 100/50/25: dev -0.12, -0.03, +0.12 (all CIs include 0), x1.25 -0.8, -1.4, -0.2 pp (CIs include 0). **No hidden star effect in the tails.** Dispersion: B2B second-night SD ratio 1.025 [1.007, 1.043] for all players; top 10 1.14 (thin).
- **First night of a back-to-back:** null on every outcome, as before.
- **Home/away:** earlier: +0.09 PTS, tiny and not significant for stars. Now: +0.16 PTS [+0.05, +0.26] for all players (similar magnitude), stars -0.14 (top 50) with CI including 0; the big-night rates are lower at home for top 25 (-2.2 pp [-4.1, -0.2], nominal; one of many cells, so not a finding) and the SD of dev is lower at home for top 25/50 (0.93/0.95; CI excludes 1). New small observation: stars' results are a bit *less* dispersed at home.
- **Rest days:** 3+ days of rest is associated with a lower excess over the prior average for all players (-0.33 PTS vs one day rest); nothing for stars.
- Per player: no star clears the shared effect for home/away; B2B flags are the Wembanyama / Embiid entries above.
""")

# 11 app changes
A("""## 11. App insights that change, and how

No app-read JSON was regenerated (schemas untouched); a new, not-yet-read `data/deep_analyses_summary.json` carries the headline numbers per timespan x segment for App Builder.

| existing insight | status | change |
|---|---|---|
| Home/away league + per-player splits (`insights_home_away_b2b.json`, `insights_player_splits.json`) | **conclusions hold** | optional copy addition: "same picture for big nights: stars' big-night rates are not higher at home; their results are slightly less spread out at home (SD ratio 0.93-0.95 for top 25/50)". No number in the current visuals needs to change |
| Back-to-back (second night) | **holds** | optional addition: big-night rates (+2.8 pp x1.25 for all players, null for top 50) confirm it is a role-player/minutes effect, not a star effect. Add "3+ days rest: slightly lower than usual (-0.3 PTS)" if desired |
| Per-player B2B / home-away flags | **holds, new depth available** | `player_deep_splits` adds big-night probability and shrunk intervals; per-player flags should show the expected-by-chance counts (`player_deep_summary`) next to the flag count |
| Points drivers (linear standardised effects, `src/generated/points_drivers.json`) | **needs a caveat** | the drivers are per +1 SD linear mean effects; add: "effects of opponent defence and pace are not linear for the top scorers: a small bump over the few worst defences, about nothing through the middle, a clear drop against the best 10 (and similarly for pace)". The app model has no opponent features (matchups were parked); the lift from them is small (MATCHUPS.md) |
| Matchup/opponent insight (parked, `app/matchups-paused`) | **update before shipping** | replace "league-average +0.6 PTS vs weak defences, individual deviations mostly noise" by the tiered version: worst-5 defences +0.63 PTS (all) / +1.21 PTS (top 50) vs the other 25 defences; best-10 defences -0.57 (all) / -0.90 (top 50) vs the other 20; relative big-night rate about 1.2x vs bottom-5 for both groups; **not stable season to season for stars (2023-24 strong, 2024-25 and 2025-26 near 0)**; no player-specific big-night effect |
| New candidate insights | | (1) "Opponent tier" card (best 5 / 6-10 / middle / worst 6-10 / worst 5 from `tier_effects`); (2) "Big-night odds" panel (P(+10) and P(x1.25) by defence and pace tier); (3) role/position note (centers and starters gain more against poor defences). Do not present any star-specific "big night vs poor teams" claim |
""")

# 12 caveats
A("""## 12. Thin cells, gaps, caveats

- Thin (< 30 players or < 300 games): top25 and top10 in every timespan, top50 in the single seasons for the rarer outcomes; flagged in every table (`thin_flag`, `thin_level`); contrasts with < 30 games on a side are null (`suppressed_n_lt_30`). 2026-27 (about 1.4k rows) is provisional.
- Overlapping windows (pooled and single seasons, nested segments) are not independent: counts of significant cells are descriptive, shown with expected-by-chance but not corrected.
- The test split is by date (last ~20% of dates per timespan); for star segments the late-season big-night base rate is lower than in training, which spoils calibration of every model including the base rate; compare models with each other, not with absolute calibration.
- Logistic specs: `ctx_full` needs >= 120 events and >= 800 games, `ctx_nested` >= 60 events; otherwise not fitted (null) and the reason is in the manifest cell logs. Quantile models need >= 800 games and >= 15 players. GBM needs >= 1,500 train rows and >= 80 events.
- Baseline artefact: dev is relative to the prior season-to-date mean, early-season baselines are noisy and rows need >= 5 minutes today; level effects of usage/minutes tiers on dev are baseline artefacts, contrasts across conditions are not.
- Role is the prior-start share (>= 50%), not tonight's lineup (not known pregame).
- The Wald nonlinearity p-values and interaction p-values are not BH-adjusted (counts vs expected are given instead).
- Associations, not causes. Matchup endpoints (defender assignments) remain unused (see MATCHUPS.md section 3).

Files: marts `data/marts/{tier_effects,spline_effects,tail_models,tail_performance,tail_calibration,dispersion_effects,interaction_effects,player_deep_splits,player_deep_summary}.parquet` (+ DuckDB views of the same names in `nba_phase1.duckdb`), `data/manifests/deep_analyses.json` (copied as `data/marts/deep_analyses_manifest.json`), `data/deep_analyses_summary.json`.
""")
open(ROOT / "data" / "marts" / "DEEP_ANALYSES.md", "w").write("\n".join(L))
print("written", sum(len(x) for x in L))
