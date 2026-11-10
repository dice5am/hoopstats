"""Writes docs/analysis/BIG_NIGHTS.md (numbers generated from the big_night_* marts; narrative fixed) and data/big_nights_summary.json."""
import json, sys
from pathlib import Path
import numpy as np, pandas as pd
sys.path.insert(0, str(Path(__file__).resolve().parent))
import big_nights_summary as S
ROOT = Path(__file__).resolve().parents[1]
man = json.load(open(ROOT / "data" / "manifests" / "big_nights.json"))
C, MO, L, PF, PR, SB, SI, SC, PS, PP, SH = S.C, S.MO, S.L, S.PF, S.PR, S.SB, S.SI, S.SC, S.PS, S.PP, S.SH
TS = "pooled_2023_26"; EV = S.EV
EVL = {"x125": "1.25x", "x150": "1.5x", "x200": "2.0x", "p5": "+5", "p10": "+10", "z15": "z>=1.5"}
SEG = ["all", "top100", "top50", "top25", "top10"]
f1 = lambda v, d=1: "n/a" if v is None or pd.isna(v) else f"{v:.{d}f}"
sg = lambda v, d=1: "n/a" if v is None or pd.isna(v) else f"{v:+.{d}f}"
pc = lambda v, d=1: "n/a" if v is None or pd.isna(v) else f"{100 * v:.{d}f}%"
def lf(ts, seg, ev, fac, bl="std", fl=8):
    g = L[(L.timespan == ts) & (L.segment == seg) & (L.event == ev) & (L.factor == fac) & (L.baseline == bl) & (L.floor == fl)]
    return g.iloc[0] if len(g) else None
def md(df):
    cols = list(df.columns); o = ["| " + " | ".join(cols) + " |", "|" + "|".join(["---"] * len(cols)) + "|"]
    for r in df.itertuples(index=False): o.append("| " + " | ".join("" if (isinstance(v, float) and np.isnan(v)) else str(v) for v in r) + " |")
    return "\n".join(o)
def rrci(x): return "n/a" if x is None or pd.isna(x.rr) else f"{x.rr:.2f} [{x.rr_lo:.2f}, {x.rr_hi:.2f}]"
def ppci(x): return f"{sg(x.raw_pp)} [{sg(x.raw_pp_lo)}, {sg(x.raw_pp_hi)}]"
def adjor(x): return "" if pd.isna(x.adj_odds_ratio) else f"{x.adj_odds_ratio:.2f} [{x.adj_or_lo:.2f}, {x.adj_or_hi:.2f}]"
def adjpp(x): return "" if pd.isna(x.adj_pp_effect) else f"{sg(x.adj_pp_effect)} [{sg(x.adj_pp_lo)}, {sg(x.adj_pp_hi)}]"
def mt(ts, seg, ev, term, bl="std"):
    g = MO[(MO.floor == 8) & (MO.timespan == ts) & (MO.segment == seg) & (MO.event == ev) & (MO.baseline == bl) & (MO.lens == "A") & (MO.term == term)]
    return g.iloc[0] if len(g) else None
def mci(x): return "n/a" if x is None else f"OR {x.odds_ratio:.2f} [{x.or_lo:.2f}, {x.or_hi:.2f}], {sg(100 * x.ame)} pp [{sg(100 * x.ame_lo)}, {sg(100 * x.ame_hi)}]"
def pfv(ts, seg, ev, model, bl="std"):
    g = PF[(PF.floor == 8) & (PF.timespan == ts) & (PF.segment == seg) & (PF.event == ev) & (PF.baseline == bl) & (PF.model == model)]
    return g.iloc[0] if len(g) else None

LABEL = {sp[2]: sp[3] for sp in __import__("big_nights_analysis").SPECS}
c8 = C[(C.floor == 8) & (C.baseline == "std") & (C.timespan == TS)].set_index(["segment", "event"])
ca = c8.loc[("all", "x150")]
# ---------------------------------------------------------------- key numbers
vl15, vl10 = lf(TS, "all", "x150", "vac_large"), lf(TS, "all", "p10", "vac_large")
av15, av10 = mt(TS, "all", "x150", "vac_large"), mt(TS, "all", "p10", "vac_large")
tops = {ev: MO[(MO.floor == 8) & (MO.timespan == TS) & (MO.segment == "all") & (MO.event == ev) & (MO.baseline == "std") & (MO.lens == "A") & MO.rank_in_cell.notna()].sort_values("rank_in_cell").head(6) for ev in EV}
a_all = {ev: pfv(TS, "all", ev, "logit_pregame") for ev in EV}; c_all = {ev: pfv(TS, "all", ev, "logit_controls") for ev in EV}; g_all = {ev: pfv(TS, "all", ev, "boosting_pregame") for ev in EV}; s_all = {ev: pfv(TS, "all", ev, "logit_same_game") for ev in EV}
kept = PF[(PF.model == "boosting_pregame") & (PF.beats_logistic_pregame == True)]
n_boost = int((PF.model == "boosting_pregame").sum())
star = SB[(SB.timespan == TS) & (SB.star_def == "top50") & (SB.baseline == "std")]
def sbr(ev, grp):
    g = star[(star.event == ev) & (star.group == grp)].iloc[0]; return g
# ---------------------------------------------------------------- doc
D = []; A = D.append
A(f"""# BIG_NIGHTS: why do players score well above their average? (hoopstats)

Data through **{man['through']}**; {man['rows']:,} eligible player-games ({man['rows_floor8']:,} with a prior average of 8+ PPG) from 2023-24 to 2026-27 to date (**2026-27 and any pooled span that includes it are provisional**). Scripts: `scripts/python/big_nights_data.py` (dataset), `big_nights_analysis.py` (cells: counts, lifts, logistic, boosting), `big_nights_players.py` (stars vs non-stars, per-player), `big_nights_assemble.py` (marts, views, manifest), `big_nights_summary.py` + `big_nights_report.py` (JSON and this file). Marts in `data/marts/big_night_*`, DuckDB views of the same names in `data/marts/nba_phase1.duckdb`, App Builder summary `data/big_nights_summary.json` (not wired into the app).

Language: *associated with / predicts*, never causes. **Lens A (pregame)** factors are knowable at about tip-off. **Lens B (same game)** factors describe how the night happened; they are close to an accounting identity with the points total and are **not predictive**; they are labelled that way everywhere.

## 1. Headline

**The pregame factors are weak. One thing stands out, the usage vacuum; almost everything else is small, partly an artefact of the baseline, or not distinguishable from nothing.**

1. **How common.** Against the player's prior season-to-date average (8+ PPG floor), {pc(ca.base_rate)} of player-games reach 1.5x ({int(ca.n_events):,} of {int(ca.n_games):,}), {pc(c8.loc[('all','x125')].base_rate)} reach 1.25x, {pc(c8.loc[('all','x200')].base_rate)} reach 2.0x ({int(c8.loc[('all','x200')].n_events):,}), {pc(c8.loc[('all','p5')].base_rate)} reach +5, {pc(c8.loc[('all','p10')].base_rate)} reach +10 ({int(c8.loc[('all','p10')].n_events):,}) and {pc(c8.loc[('all','z15')].base_rate)} reach z>=1.5 (pooled 2023-24 to 2025-26, all players). Top-50 scorers: 1.5x {pc(c8.loc[('top50','x150')].base_rate)}, +10 {pc(c8.loc[('top50','p10')].base_rate)}.
2. **Strongest pregame factor: regular teammates out (the usage vacuum).** When regular teammates who average 20+ PPG together are missing, {pc(vl15.rate_level)} of games reach 1.5x vs {pc(vl15.rate_ref)} when no regular is out (RR {rrci(vl15)}, {ppci(vl15)} pp) and {pc(vl10.rate_level)} reach +10 vs {pc(vl10.rate_ref)} (RR {rrci(vl10)}). Holding prior average, volatility, usage, minutes, role, position and all other pregame factors fixed, the 1.5x effect is {mci(av15)} and the +10 effect is {mci(av10)}. It is the top-ranked adjusted factor in every main cut and has the same sign in each of the three complete seasons.
3. **Second tier (small, +1 to +3 pp):** recent minutes up or a recent promotion to the starting five, the team's top scorer being out, a very recent hot game, early season (Oct-Nov), fast-pace opponents, bottom-10 defences. **Against the last-10 baseline the hot-game, minutes-up and promotion effects vanish** (RR near 1.0): they mostly show that the season-to-date average lags a player whose role is changing, not that heat carries over. Elite defences (best 10) cost about 1.4 pp; slow-pace opponents about 0.5 to 0.8 pp (the interval touches zero).
4. **No credible effect once the other factors are held fixed:** home vs away, rest days and back-to-back nights (raw second-night lift of {sg(lf(TS,'all','x150','b2b_2nd').raw_pp)} pp for 1.5x disappears: adjusted {sg(100*mt(TS,'all','x150','b2b_2nd').ame)} pp [{sg(100*mt(TS,'all','x150','b2b_2nd').ame_lo)}, {sg(100*mt(TS,'all','x150','b2b_2nd').ame_hi)}]), the opponent's own last-game or last-5 defensive form, the opponent missing regulars, NBA Cup games, late season (raw {sg(lf(TS,'all','x150','phase_late').raw_pp)} pp, adjusted about 0). **No bounce-back:** after a weak last game (below 0.75x) big nights are *less* likely in the raw data, not more (1.5x: RR {rrci(lf(TS,'all','x150','bb_last1'))}), and the adjusted odds ratio is {mt(TS,'all','x150','bb_last1').odds_ratio:.2f} [{mt(TS,'all','x150','bb_last1').or_lo:.2f}, {mt(TS,'all','x150','bb_last1').or_hi:.2f}] (no credible change); after two weak games in a row the adjusted +10 odds are lower (OR {mt(TS,'all','p10','bb_last2').odds_ratio:.2f} [{mt(TS,'all','p10','bb_last2').or_lo:.2f}, {mt(TS,'all','p10','bb_last2').or_hi:.2f}], {sg(100*mt(TS,'all','p10','bb_last2').ame)} pp).
5. **Models.** On the date-split test the pregame logistic model adds {f1(a_all['x150'].dauc_vs_ref,3)} AUC over a controls-only model for 1.5x ({f1(a_all['x150'].auc,3)} vs {f1(c_all['x150'].auc,3)}) and {f1(a_all['p10'].dauc_vs_ref,3)} for +10 ({f1(a_all['p10'].auc,3)} vs {f1(c_all['p10'].auc,3)}): **a pregame big-night is hard to predict; AUC 0.62 to 0.70, far from a usable forecast**. Boosting clearly beats the logistic in only {len(kept)} of {n_boost} fitted cells ({', '.join(sorted(set(kept.event + ' ' + kept.segment + ' ' + kept.timespan)))}), with a gain of about 0.01 AUC; elsewhere linear is enough. The same-game model reaches AUC 0.99 and means nothing as a prediction: it is the points identity.
6. **Same game (how it happens, not predictive).** A typical 1.5x night has about {f1(PR[(PR.floor==8)&(PR.timespan==TS)&(PR.segment=='all')&(PR.event=='x150')&(PR.baseline=='std')&(PR.group=='big_night')].d_min.iloc[0])} extra minutes, {f1(PR[(PR.floor==8)&(PR.timespan==TS)&(PR.segment=='all')&(PR.event=='x150')&(PR.baseline=='std')&(PR.group=='big_night')].d_fga.iloc[0])} extra FGA and {f1(PR[(PR.floor==8)&(PR.timespan==TS)&(PR.segment=='all')&(PR.event=='x150')&(PR.baseline=='std')&(PR.group=='big_night')].d_ts_pp.iloc[0])} percentage points of extra TS% against the player's prior norms. Of the log excess, minutes carry about 28%, shots per minute about 36% and efficiency about 35% for all players; for the top 50 the split is about 18% / 44% / 38%: stars' big nights are shot volume per minute and shooting, not extra minutes. Overtime, close games and high-scoring games go with more big nights; blowout losses go with far fewer. An opposing starter with 5+ fouls goes with a modest increase.
7. **Stars vs non-stars.** Different baselines, similar mechanisms: top-50 players hit 1.5x {pc(sbr('x150','star').base_rate)} of the time vs {pc(sbr('x150','non_star').base_rate)} for everyone else (a high average is hard to double) but +10 {pc(sbr('p10','star').base_rate)} vs {pc(sbr('p10','non_star').base_rate)}. The ratio effects of defence tier and the vacuum (at 1.5x) are about the same for both groups; at +10 the vacuum ratio is smaller for stars (RR 1.70 vs 2.30) although the percentage-point effect is the same (+6 pp). They differ in recent-form factors: non-stars show a hot-game lift and a weak-game drop that stars do not, and stars show a small home *deficit* and a larger slow-pace penalty in big nights (see section 7).
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
""")
rows = []
for seg in SEG:
    r0 = {"segment": seg}
    g0 = c8.loc[(seg, "x150")]; r0["games"] = f"{int(g0.n_games):,}"; r0["players"] = int(g0.n_players); r0["thin"] = "yes" if g0.thin_flag else ""
    for ev in EV:
        g = c8.loc[(seg, ev)]; r0[EVL[ev]] = f"{int(g.n_events):,} ({pc(g.base_rate)})"
    rows.append(r0)
A(md(pd.DataFrame(rows)) + "\n")
A("Same cuts against the **last-10 baseline** (floor 8, `baseline = l10`):\n")
c8l = C[(C.floor == 8) & (C.baseline == "l10") & (C.timespan == TS)].set_index(["segment", "event"]); rows = []
for seg in SEG:
    g0 = c8l.loc[(seg, "x150")]; r0 = {"segment": seg, "games": f"{int(g0.n_games):,}", "players": int(g0.n_players)}
    for ev in EV: g = c8l.loc[(seg, ev)]; r0[EVL[ev]] = f"{int(g.n_events):,} ({pc(g.base_rate)})"
    rows.append(r0)
A(md(pd.DataFrame(rows)) + "\n")
A("**By timespan** (std baseline, floor 8; events and base rate; `*` = provisional; top 25 / top 10 are thin everywhere and in the mart):\n")
rows = []
for ts in ["pooled_2023_27", "pooled_2023_26", "2023_24", "2024_25", "2025_26", "2026_27"]:
    for seg in ("all", "top100", "top50"):
        g = C[(C.floor == 8) & (C.baseline == "std") & (C.timespan == ts) & (C.segment == seg)].set_index("event")
        r0 = {"timespan": ts + ("*" if ts in ("2026_27", "pooled_2023_27") else ""), "segment": seg, "games / players": f"{int(g.loc['x150'].n_games):,} / {int(g.loc['x150'].n_players)}", "thin": "yes" if g.loc["x150"].thin_flag else ""}
        for ev in EV: r0[EVL[ev]] = f"{int(g.loc[ev].n_events):,} ({pc(g.loc[ev].base_rate)})"
        rows.append(r0)
A(md(pd.DataFrame(rows)) + "\n")
A("**Floor sensitivity** (all players, pooled 2023-24 to 2025-26, std baseline; events and base rate):\n")
rows = []
for fl in (0, 5, 8, 12):
    g = C[(C.floor == fl) & (C.baseline == "std") & (C.timespan == TS) & (C.segment == "all")].set_index("event"); r0 = {"floor": "none (avg > 0)" if fl == 0 else f"{fl}+ PPG" + (" (default)" if fl == 8 else ""), "games": f"{int(g.loc['x150'].n_games):,}"}
    for ev in EV: r0[EVL[ev]] = f"{int(g.loc[ev].n_events):,} ({pc(g.loc[ev].base_rate)})"
    rows.append(r0)
A(md(pd.DataFrame(rows)) + "\n")
A(f"The floor matters most for the 2.0x cut: with no floor {pc(C[(C.floor==0)&(C.baseline=='std')&(C.timespan==TS)&(C.segment=='all')&(C.event=='x200')].base_rate.iloc[0])} of games reach 2x (bench players scoring 6 instead of 3), at 8+ PPG {pc(c8.loc[('all','x200')].base_rate)}, at 12+ PPG {pc(C[(C.floor==12)&(C.baseline=='std')&(C.timespan==TS)&(C.segment=='all')&(C.event=='x200')].base_rate.iloc[0])}. The factor ranking is the same at every floor (section 4.4); the vacuum effect is slightly larger the lower the floor.\n")

# ---------------------------------------------------------------- lens A tables
A("## 4. Lens A: pregame factors (knowable before tip-off)\n")
A("### 4.1 Factor tables, all players, pooled 2023-24 to 2025-26, std baseline, floor 8\n")
A("`rate with` / `rate without` = share of games that are big nights with and without the factor; RR = risk ratio; pp = absolute percentage-point difference; **adjusted** = same factor in the multivariable logistic with all the others and the controls (OR and average marginal effect in pp). Adjusted values exist for the non-redundant terms only. Full set for every cell in `big_night_factor_lift`.\n")
SKIP_TABLE = ("deft_", "pacet_", "rest_r")
for ev, title in (("x150", "1.5x the prior average"), ("p10", "prior average + 10")):
    A(f"**{title}** (base rate {pc(c8.loc[('all', ev)].base_rate)}):\n")
    g = L[(L.floor == 8) & (L.timespan == TS) & (L.segment == "all") & (L.event == ev) & (L.baseline == "std") & (L.lens == "A")]
    rows = [dict(dimension=x.dimension, factor=x.label, share_of_games=pc(x.n_level / x.n_cell_games, 0), rate_with=pc(x.rate_level), rate_without=pc(x.rate_ref), RR=rrci(x), pp=ppci(x), adj_OR=adjor(x), adj_pp=adjpp(x)) for x in g.itertuples() if not x.factor.startswith(SKIP_TABLE)]
    A(md(pd.DataFrame(rows)) + "\n")
A("**Tier ladders (vs the middle 10 teams), 1.5x and +10, RR [95% CI]:**\n")
rows = []
for fac in ("deft_worst5", "deft_worst6_10", "deft_best6_10", "deft_best5", "pacet_fastest5", "pacet_fast6_10", "pacet_slow6_10", "pacet_slowest5", "rest_r0", "rest_r2", "rest_r3plus"):
    a, b = lf(TS, "all", "x150", fac), lf(TS, "all", "p10", fac)
    rows.append(dict(level=a.label, **{"1.5x RR": rrci(a), "1.5x pp": ppci(a), "+10 RR": rrci(b), "+10 pp": ppci(b)}))
A(md(pd.DataFrame(rows)) + "\n")
A("The defence ladder is monotone but shallow: the worst-5 defences add about 2 pp to the 1.5x rate vs the middle 10 and the best-5 take away about 2 pp; nothing in the worst 6-10 band. The pace ladder is flatter.\n")
A("### 4.2 What is strongest, by cut (adjusted, all players)\n")
A("Top 6 non-control terms by absolute adjusted effect (average marginal effect, pp, with 95% CI); the base rate for context. `vac_large` = regular teammates averaging 20+ PPG together are out.\n")
rows = []
for ev in EV:
    t = tops[ev]; x = {"cut": EVL[ev], "base rate": pc(c8.loc[("all", ev)].base_rate)}
    for k, r_ in enumerate(t.itertuples(), 1): x[f"#{k}"] = f"{r_.term} {sg(100 * r_.ame)} pp [{sg(100 * r_.ame_lo)}, {sg(100 * r_.ame_hi)}]"
    rows.append(x)
A(md(pd.DataFrame(rows)) + "\n")
A("### 4.3 Stability across seasons (adjusted effect in pp, all players, std baseline)\n")
keys = ["vac_large", "out_top1", "hot_last1", "bb_last1", "bb_last2", "def_worst10", "def_best10", "pace_fast10", "b2b_2nd", "home", "min_up3", "role_promoted", "phase_early"]
for ev in ("x150", "p10"):
    rows = []
    for t in keys:
        x = {"factor": t}
        for ts in ("2023_24", "2024_25", "2025_26", TS, "2026_27"):
            m = mt(ts, "all", ev, t); x[ts + ("*" if ts == "2026_27" else "")] = "" if m is None else f"{sg(100 * m.ame)} [{sg(100 * m.ame_lo)}, {sg(100 * m.ame_hi)}]"
        rows.append(x)
    A(f"**{EVL[ev]}** (`*` = provisional, ~{int(C[(C.floor==8)&(C.baseline=='std')&(C.timespan=='2026_27')&(C.segment=='all')&(C.event==ev)].n_events.iloc[0])} events so far):\n\n" + md(pd.DataFrame(rows)) + "\n")
A("The vacuum, minutes-up and the two-weak-games drop keep their sign in every complete season (the promotion term does not at +10 in 2025-26). The defence and pace terms are inconsistent: for +10 bottom-10 defences are +0.9 pp (2023-24), -0.5 (2024-25), +1.1 (2025-26), and for 1.5x fast-pace opponents are +2.6 / +0.5 / +1.4 pp. The 2026-27 column is provisional and too noisy to read.\n")
A("### 4.4 Sensitivity: baseline and floor (raw RR, all players, pooled 2023-24 to 2025-26)\n")
rows = []
for t in ["vac_large", "out_top1", "hot_last1", "bb_last1", "min_up3", "role_promoted", "def_worst10", "def_best10", "pace_fast10", "b2b_2nd", "home", "opp_leaky_l5"]:
    x = {"factor": LABEL[t]}
    for ev in ("x150", "p10"):
        a, b = lf(TS, "all", ev, t, "std"), lf(TS, "all", ev, t, "l10")
        x[f"{EVL[ev]} std baseline"] = f"{a.rr:.2f}"; x[f"{EVL[ev]} l10 baseline"] = f"{b.rr:.2f}"
    for fl in (0, 5, 12): x[f"1.5x floor {fl or 'none'}"] = f"{lf(TS, 'all', 'x150', t, 'std', fl).rr:.2f}"
    rows.append(x)
A(md(pd.DataFrame(rows)) + "\n")
A("Reading: against the **last-10 baseline** the hot-game, minutes-up and promotion effects shrink to about 1.0 (the last-10 average already contains the recent form), and the weak-last-game penalty also fades; the vacuum drops from RR about 2.0 to about 1.7 but stays large; defence and pace tiers are unchanged. So *the carry-over of heat* is mostly the season-to-date baseline being stale for a player whose role is changing, while the *teammates-out* effect is a real shift in the conditions that the last-10 form only partly absorbs.\n")
A("### 4.5 Segments (adjusted effect, pp; std baseline; pooled 2023-24 to 2025-26)\n")
for ev in ("x150", "p10"):
    rows = []
    for t in ["vac_large", "out_top1", "hot_last1", "bb_last1", "bb_last2", "def_worst10", "def_best10", "pace_fast10", "b2b_2nd", "home", "min_up3"]:
        x = {"factor": t}
        for seg in ("all", "top100", "top50", "top25"):
            m = mt(TS, seg, ev, t); x[seg + (" (thin)" if seg == "top25" else "")] = "" if m is None else f"{sg(100 * m.ame)} [{sg(100 * m.ame_lo)}, {sg(100 * m.ame_hi)}]"
        rows.append(x)
    A(f"**{EVL[ev]}** (top 10 is not modelled: 10 players):\n\n" + md(pd.DataFrame(rows)) + "\n")
A("Top-100 and top-50 players show the same ordering: vacuum first by a wide margin, then fast opponents and elite defences. The top-25 column is thin and descriptive.\n")

# ---------------------------------------------------------------- lens B
A("## 5. Lens B: same-game factors (explains how it happened; NOT predictive)\n")
A("**Everything in this section is measured during the game.** Minutes, shot attempts, usage and TS% make up points, so their lifts are near-identities, not drivers. They are included to describe *how* the night came about, as requested, and must not be shown as a forecast.\n")
for ev, title in (("x150", "1.5x the prior average"), ("p10", "prior average + 10")):
    g = L[(L.floor == 8) & (L.timespan == TS) & (L.segment == "all") & (L.event == ev) & (L.baseline == "std") & (L.lens == "B")]
    rows = [dict(factor=x.label, share_of_games=pc(x.n_level / x.n_cell_games, 0), rate_with=pc(x.rate_level), rate_without=pc(x.rate_ref), RR=rrci(x), pp=ppci(x)) for x in g.itertuples()]
    A(f"**{title}** (all players, pooled 2023-24 to 2025-26):\n\n" + md(pd.DataFrame(rows)) + "\n")
A("**Profile of the event games vs the other games, and decomposition of the excess** (pooled 2023-24 to 2025-26, std baseline, floor 8). Deltas are vs the player's own prior season-to-date averages. Shares = share of ln(PTS / prior avg) from minutes, shots per minute and points per shot.\n")
rows = []
for seg in ("all", "top100", "top50"):
    for ev in ("x125", "x150", "x200", "p10"):
        g = PR[(PR.floor == 8) & (PR.timespan == TS) & (PR.segment == seg) & (PR.event == ev) & (PR.baseline == "std")]
        b = g[g.group == "big_night"]; o = g[g.group == "other"]
        if len(b) == 0: continue
        b, o = b.iloc[0], o.iloc[0]
        rows.append(dict(segment=seg, cut=EVL[ev], events=int(b.n_games), pts_big=f1(b.mean_pts), prior_avg_big=f1(b.mean_prior_avg), d_minutes=f"{sg(b.d_min)} (other {sg(o.d_min)})", d_FGA=f"{sg(b.d_fga)} (other {sg(o.d_fga)})", d_FTA=sg(b.d_fta), d_3PA=sg(b.d_3pa), d_usage_pp=sg(b.d_usg_pp), d_TS_pp=sg(b.d_ts_pp),
                         share_minutes=pc(b.share_minutes, 0), share_shot_rate=pc(b.share_shot_rate, 0), share_efficiency=pc(b.share_efficiency, 0), mean_margin=sg(b.mean_margin), OT=pc(b.pct_ot), close=pc(b.pct_close), opp_foul_trouble=pc(b.pct_opp_foul_trouble, 0)))
A(md(pd.DataFrame(rows)) + "\n")
A("Reading: for all players the 1.5x excess splits about evenly between minutes, shooting volume per minute and efficiency; for the top 50 the minutes share is smaller (they already play 34+ minutes) and the shot-rate share is the largest. Overtime is {0} of 1.5x nights vs {1} of other games. Blowout losses are the one game script that goes with far fewer big nights (the star sits); close games and a high combined score go with more. Opposing starters in foul trouble (5+ fouls) show a modest lift ({2} vs {3} of games reach +10, RR {4}). Referee, injury-during-game and garbage-time detail is not in the data.\n".format(
    pc(PR[(PR.floor==8)&(PR.timespan==TS)&(PR.segment=='all')&(PR.event=='x150')&(PR.baseline=='std')&(PR.group=='big_night')].pct_ot.iloc[0]), pc(PR[(PR.floor==8)&(PR.timespan==TS)&(PR.segment=='all')&(PR.event=='x150')&(PR.baseline=='std')&(PR.group=='other')].pct_ot.iloc[0]),
    pc(lf(TS,'all','p10','opp_foul_trouble').rate_level), pc(lf(TS,'all','p10','opp_foul_trouble').rate_ref), f"{lf(TS,'all','p10','opp_foul_trouble').rr:.2f}"))
A("**Foul-trouble data check.** Per-player personal fouls (`pf`) are in the full box score for every played row (2023-24 to 2026-27), so opposing starters' foul trouble is measured directly (starters with >= 5 PF; the team-level PF >= 25 flag is the second view). Not available: who guarded whom, referee crews, the minute at which a player got into foul trouble, and whether the opposing starter then sat.\n")

# ---------------------------------------------------------------- models
A("## 6. Models: logistic vs boosting (date-split test)\n")
A("Train on earlier dates, test on the last ~20% of dates of each timespan. `controls` = prior average, volatility, usage, minutes, progress, start rate, position only. `pregame` = controls + all Lens A terms. `boosting` = LightGBM on the same pregame inputs (continuous versions). `same-game` = controls + Lens B terms: **explanatory, not a forecast**. AUC with 95% player-cluster bootstrap CI; Brier and log-loss in the mart. d = AUC gain vs the reference model with its CI.\n")
for seg in ("all", "top100", "top50"):
    rows = []
    for ev in EV:
        c_, p_, g_, s_ = (pfv(TS, seg, ev, m) for m in ("logit_controls", "logit_pregame", "boosting_pregame", "logit_same_game"))
        if c_ is None: rows.append(dict(cut=EVL[ev], test_events="", note="not scored (too few test events)")); continue
        rows.append(dict(cut=EVL[ev], test_events=str(int(c_.test_events)), controls=f"{c_.auc:.3f} [{c_.auc_lo:.3f}, {c_.auc_hi:.3f}]", pregame=f"{p_.auc:.3f} [{p_.auc_lo:.3f}, {p_.auc_hi:.3f}]", pregame_gain=f"{sg(p_.dauc_vs_ref, 3)} [{sg(p_.dauc_lo, 3)}, {sg(p_.dauc_hi, 3)}]",
                         boosting=f"{g_.auc:.3f}", boosting_vs_pregame=f"{sg(g_.dauc_vs_ref, 3)} [{sg(g_.dauc_lo, 3)}, {sg(g_.dauc_hi, 3)}]", boosting_kept="yes" if g_.beats_logistic_pregame else "no", pregame_logloss=f"{p_.logloss:.4f}", boosting_logloss=f"{g_.logloss:.4f}", same_game_AUC_explanatory=f"{s_.auc:.3f}"))
    A(f"**{seg}**, pooled 2023-24 to 2025-26:\n\n" + md(pd.DataFrame(rows)) + "\n")
ks = ", ".join(f"{r.event} / {r.segment} / {r.timespan}" for r in kept.itertuples())
shp = SH[(SH.timespan == TS)].sort_values("shap_mean_abs", ascending=False).head(8)
A(f"""**Does boosting earn its place? Rarely.** It beats the pregame logistic on the date-split test (gain >= 0.005 AUC, CI above 0, lower log-loss CI and Brier) in {len(kept)} of {n_boost} scored cells: {ks}. Only the all-players 2.0x cut qualifies (pooled 2023-24 to 2025-26 AUC gain {f1(kept[kept.timespan==TS].dauc_vs_ref.iloc[0], 3)}, CI [{f1(kept[kept.timespan==TS].dauc_lo.iloc[0], 3)}, {f1(kept[kept.timespan==TS].dauc_hi.iloc[0], 3)}]); in the top-100 and top-50 cells it is no better and often worse than the logistic. **Linear is enough** everywhere else. SHAP for the kept model (mean |SHAP|, pooled 2023-24 to 2025-26): {', '.join(f"{r.feature} {r.shap_mean_abs:.2f}" for r in shp.itertuples())}. The prior average dominates; the vacuum input (`out_ppg`) and volatility come next, then opponent defence and pace, the other vacuum measure and the minutes trend: the same families the logistic picks out.

**Why AUC stays low.** The big-night cuts depend mostly on within-player noise in a game; the controls-only model already reaches 0.54 to 0.74 (it knows the player's average and volatility), and all the pregame context adds about 0.04 to 0.12. For top-50 stars the pregame model adds nothing credible for 1.5x ({f1(pfv(TS,'top50','x150','logit_pregame').dauc_vs_ref,3)} [{f1(pfv(TS,'top50','x150','logit_pregame').dauc_lo,3)}, {f1(pfv(TS,'top50','x150','logit_pregame').dauc_hi,3)}]) and only a small gain for +10 ({f1(pfv(TS,'top50','p10','logit_pregame').dauc_vs_ref,3)} [{f1(pfv(TS,'top50','p10','logit_pregame').dauc_lo,3)}, {f1(pfv(TS,'top50','p10','logit_pregame').dauc_hi,3)}]).
""")

# ---------------------------------------------------------------- stars
A("## 7. Stars vs non-stars\n")
A("Star = top 50 by PPG (train-period ranks), non-star = everyone else with a prior average of 8+; top 100 gives the same answer and top 25 / top 10 are thin (the mart carries them, flagged).\n")
rows = []
for ev in EV:
    a, b, d = sbr(ev, "star"), sbr(ev, "non_star"), sbr(ev, "difference_star_minus_non_star")
    rows.append(dict(cut=EVL[ev], star_rate=f"{pc(a.base_rate)} [{pc(a.ci_low)}, {pc(a.ci_high)}]", non_star_rate=f"{pc(b.base_rate)} [{pc(b.ci_low)}, {pc(b.ci_high)}]", difference_pp=f"{sg(100 * d.base_rate)} [{sg(100 * d.ci_low)}, {sg(100 * d.ci_high)}]", star_events=int(a.n_events), non_star_events=int(b.n_events)))
A("**Base rates** (std baseline, floor 8, pooled 2023-24 to 2025-26):\n\n" + md(pd.DataFrame(rows)) + "\n")
A("Relative cuts (1.25x, 1.5x, 2.0x) are much harder for high-average players; absolute cuts (+5, +10) are slightly *easier* for them (more shots, more variance in points). So the question 'do stars have more big nights?' has opposite answers depending on the definition.\n")
for ev in ("x150", "p10"):
    g = SC[(SC.timespan == TS) & (SC.star_def == "top50") & (SC.event == ev) & (SC.baseline == "std") & SC.factor.isin(["bb_last1", "bb_last2", "hot_last1", "hot_l5", "def_worst10", "def_best10", "pace_fast10", "pace_slow10", "b2b_2nd", "home", "vac_large", "out_top1", "min_up3", "opp_leaky_l5", "phase_early"])]
    rows = [dict(factor=x.label, star_RR=f"{x.star_rr:.2f} [{x.star_rr_lo:.2f}, {x.star_rr_hi:.2f}]", non_star_RR=f"{x.non_rr:.2f} [{x.non_rr_lo:.2f}, {x.non_rr_hi:.2f}]", RR_ratio=("n/a" if pd.isna(x.rr_ratio) else f"{x.rr_ratio:.2f} [{x.rr_ratio_lo:.2f}, {x.rr_ratio_hi:.2f}]"), star_pp=sg(100 * x.star_rd), non_star_pp=sg(100 * x.non_rd),
                 pp_diff=f"{sg(100 * x.rd_diff)} [{sg(100 * x.rd_diff_lo)}, {sg(100 * x.rd_diff_hi)}]") for x in g.itertuples()]
    A(f"**{EVL[ev]}: factor lift for stars vs non-stars (raw RR, pooled-segment comparison; RR ratio > 1 = bigger relative lift for stars):**\n\n" + md(pd.DataFrame(rows)) + "\n")
I5 = SI[(SI.timespan == TS) & (SI.star_def == "top50") & (SI.baseline == "std") & SI.p_value.notna()]
rows = []
for ev in ("x150", "p10", "z15", "x125", "p5"):
    g = I5[I5.event == ev]
    if len(g): rows.append(dict(cut=EVL[ev], factors_tested=len(g), p_lt_05=int((g.p_value < .05).sum()), expected_by_chance=f"{0.05 * len(g):.1f}", q_lt_10=int((g.q_value < .10).sum()), significant=", ".join(f"{t.term} (interaction OR {t.interaction_or:.2f} [{t.ci_low:.2f}, {t.ci_high:.2f}])" for t in g[g.q_value < .10].itertuples())))
A("**Interaction tests** (logistic with controls + factor + star + factor x star, player-clustered; BH q within cut):\n\n" + md(pd.DataFrame(rows)) + "\n")
A("**Verdict.** *Mostly the same mechanisms, different recent-form behaviour, and a different base rate.* (1) Defence-tier ratios are indistinguishable between stars and non-stars (worst-10 RR 1.17 vs 1.15 for 1.5x), and so is the teammates-out ratio at 1.5x (RR 1.93 vs 1.88). At +10 the teammates-out ratio is smaller for stars (RR 1.70 vs 2.30, ratio 0.74 [0.61, 0.90]) although the absolute effect is the same, about +6 pp (stars +6.1, non-stars +6.0). At 1.5x the vacuum adds about 6 pp for stars and 11 pp for non-stars, mostly because non-stars have the higher base rate. (2) Recent form differs: for non-stars a weak last game goes with fewer big nights (RR 0.69 for +10, 0.81 for 1.5x) and a hot last game with more (RR 1.48 / 1.39); stars show no weak-game penalty (RR 1.00 / 1.01) and a smaller hot-game lift that is not credible on its own (1.14 [0.97, 1.33] / 1.16 [0.95, 1.42]). The bounce-back difference is credible (RR ratio 1.45 [1.20, 1.76] for +10, 1.25 [1.04, 1.51] for 1.5x; +10 interaction q about 0.005). (3) Stars have a small big-night deficit at home (RR 0.87 to 0.88 vs 1.07 to 1.09 for non-stars; +10 interaction OR 0.78 [0.66, 0.94], q about 0.07) and a larger slow-pace penalty (RR 0.73 to 0.75 vs 0.89 to 0.91): leads that survive the 28-test correction only borderline, not findings. (4) Across 28 factor interactions per cut, 4 to 7 reach p < 0.05 vs 1.4 expected by chance, clustering on bounce-back, hot game, home and slow pace; the rest are flat. So: **the same pregame levers move both groups; stars simply do not show the hot-hand / bounce-back dependence that non-stars show.**\n")

# ---------------------------------------------------------------- players
A("## 8. Per-player patterns (shrunk; only where credible)\n")
A(f"Two views, each shrunk with DerSimonian-Laird (between-player variance tau) plus empirical Bayes. **(a) Propensity vs expected:** observed big nights minus the number expected from a controls-only model (prior average, volatility, usage, minutes, progress, start rate, position): does this player have big nights more often than players with the same average and volatility? **(b) Condition splits:** the player's big-night rate in a condition minus his rate outside it (teammates out 10+ PPG, after a weak game, vs bottom-10 defences, home, 2nd night of a back-to-back, after a hot game), min 10 games per side. Players need 40+ eligible games (pooled spans) at a prior average of 8+; 'credible' = the shrunk 95% interval (player-specific evidence only) excludes the league mean; 'flagged' = |z| >= 2.5 or BH q < 0.10. **Expected by chance** is computed under the null that every player is the league mean: 1.2% of players beyond |z| >= 2.5 and 5% beyond p < 0.05.\n")
ps = PS[PS.timespan == TS]
rows = [dict(analysis=x.analysis, cut=x.outcome.replace("_std", ""), players=int(x.n_players), league_mean_pp=sg(100 * x.league_mean_diff), tau_pp=f1(100 * x.tau), abs_z_ge_2_5=int(x.n_abs_z_ge_2_5), expected_by_chance=f"{x.expected_watch_by_chance:.1f}", p_lt_05=int(x.n_p_lt_05), expected_p_lt_05=f"{x.expected_p_lt_05_by_chance:.1f}", q_lt_10=int(x.n_flag_strong_q10), credible_above=int(x.n_credible_above_league), credible_below=int(x.n_credible_below_league), credible_above_in_top50=int(x.n_credible_above_top50)) for x in ps.itertuples()]
A(md(pd.DataFrame(rows)) + "\n")
cr = PP[(PP.timespan == TS) & (PP.analysis == "propensity_vs_expected") & (PP.outcome == "x150_std") & PP.credible_above_league].sort_values("shrunk_diff", ascending=False)
A("**Players credibly above the league on 1.5x big nights given their average and volatility** (pooled 2023-24 to 2025-26; observed vs expected big nights, shrunk difference in pp per game with 95% interval):\n")
A(md(pd.DataFrame([dict(player=x.player_name, games=int(x.n_games), observed=int(x.observed_events), expected=f1(x.expected_events), shrunk_pp=f"{sg(100 * x.shrunk_diff)} [{sg(100 * x.shrunk_ci_low)}, {sg(100 * x.shrunk_ci_high)}]", q=f"{x.q:.3f}", top50="yes" if x.in_top50 else "", top100="yes" if x.in_top100 else "") for x in cr.itertuples()])) + "\n")
cr2 = PP[(PP.timespan == TS) & (PP.analysis == "teammates_out_10plus") & (PP.outcome == "x150_std") & (PP.credible_above_league | PP.credible_below_league)].sort_values("shrunk_diff", ascending=False)
A("**Teammates-out split, 1.5x: players whose response differs from the league average** (league mean is about +5.7 pp; rate with 10+ PPG of regulars out minus rate otherwise; shrunk):\n")
A(md(pd.DataFrame([dict(player=x.player_name, games_with=int(x.n_cond), games_without=int(x.n_ref), rate_with=pc(x.mean_cond), rate_without=pc(x.mean_ref), shrunk_pp=f"{sg(100 * x.shrunk_diff)} [{sg(100 * x.shrunk_ci_low)}, {sg(100 * x.shrunk_ci_high)}]", direction="above league" if x.credible_above_league else "below league") for x in cr2.itertuples()])) + "\n")
A("""**Read.** (1) There is more spread in who has 1.5x nights than chance alone gives (20 players at |z| >= 2.5 vs 3.8 expected; tau about 2.6 pp), so a few role players are credibly more explosive than their numbers imply (OG Anunoby, Deni Avdija, Payton Pritchard, Jamal Murray, Anfernee Simons, Trey Murphy III at 1.5x). Only one of them is in the top 50 and **none in the top 25**: stars are not credibly more big-night-prone than players with the same average and volatility. A controls-only model can be misspecified for players with role changes, so read these as 'worth watching', not as traits. (2) For the specific conditions (rest, home, defence tier, bounce-back, hot game) the count of flagged players is at or below what chance gives and no player is credibly different from the league average. (3) The teammates-out split has real heterogeneity for 1.5x (tau about 5 pp, 5 players credibly more responsive, 4 credibly less) concentrated among role players who rise a lot when the team's scorers sit (Quentin Grimes, Naji Marshall, Spencer Dinwiddie, Pelle Larsson, Daniss Jenkins). No top-50 star is credibly more responsive than the league; four players are credibly *less* responsive (Shai Gilgeous-Alexander, Domantas Sabonis, Tyrese Haliburton, Jakob Poeltl), high-average players for whom a 1.5x night is rare, so this partly reflects the base-rate effect rather than the vacuum itself. 2026-27 per-player rows are provisional and have almost no credible cases (few games).""" + "\n")

# ---------------------------------------------------------------- caveats
CAVEATS = [
    "Associational, not causal. Teammates out is a context variable, not a randomised condition: teams that lose scorers also change minutes, lineups and opponents' game plans.",
    "The baseline matters. Season-to-date averages lag role changes, so 'hot last game', 'minutes up' and 'promoted' look like effects against the std baseline and mostly vanish against the l10 baseline. The prior average is also noisy early in a season (the early-season adjusted effect of about +2.6 pp for 1.5x partly reflects that).",
    "Out is observed from the box score (inactive list or non-coach DNP) of the game itself. It is knowable at about tip-off but not days ahead; late scratches and game-time decisions are not separated, and a coach's-decision DNP is not counted.",
    "The 5-minute rule uses same-game minutes: players who play under 5 minutes are not in the denominator (they cannot have big nights).",
    "Segments use train-period PPG ranks, so top-N membership has no look-ahead but includes players who later changed role. Top 25 and top 10 have 25 and 10 players: always thin, descriptive only.",
    "2026-27 is provisional (through Nov 9: ~106 1.5x events and few games per player once the 5-prior-game and opponent cold-start rules are applied). Pooled spans that include it carry the provisional flag.",
    "Lens B is an accounting identity with the points total: its lifts and the same-game model's AUC of 0.99 are not evidence of anything predictive.",
    "Not available: defender matchups, referee crews, betting lines and totals (the combined score is same-game), the pregame injury report (only the inactive list), shot quality or tracking data, play-by-play (so no 'minute of foul trouble').",
    "Multiple comparisons: about 50 factor levels x 6 cuts x 30 cells in the mart. Use the adjusted columns and the stability table, not single cells; interaction and per-player flags are reported with expected-by-chance counts.",
    "Logistic fits use player-clustered covariance; a few rare-event cells hit convergence warnings (the fits fall back to BFGS); cells that could not be fitted are logged in the manifest and left empty, never filled.",
]
A("## 9. Caveats and data gaps\n")
for c_ in CAVEATS: A(f"- {c_}")
A("")
# ---------------------------------------------------------------- insights
vc = mt(TS, "all", "x150", "vac_large"); hl = lf(TS, "all", "x150", "hot_last1"); hl10 = lf(TS, "all", "x150", "hot_last1", "l10")
INSIGHTS = [
    dict(id="vacuum_chip", kind="add", title="Usage-vacuum chip on tonight's game / player card", text=f"When regular teammates averaging 20+ PPG together are out, a player's 1.5x big-night rate is {pc(vl15.rate_level)} vs {pc(vl15.rate_ref)} (adjusted {sg(100 * vc.ame)} pp [{sg(100 * vc.ame_lo)}, {sg(100 * vc.ame_hi)}]); +10 {pc(vl10.rate_level)} vs {pc(vl10.rate_ref)}. Show it only from the inactive list (about 30 minutes before tip), wording 'associated with'. Hide it for 2026-27-only views until there are more events."),
    dict(id="no_bounce_back", kind="change", title="Say 'no bounce-back' plainly", text=f"There is no bounce-back: after a weak last game the raw 1.5x rate is lower (RR {rrci(lf(TS,'all','x150','bb_last1'))}) and the adjusted odds ratio is {mt(TS,'all','x150','bb_last1').odds_ratio:.2f} [{mt(TS,'all','x150','bb_last1').or_lo:.2f}, {mt(TS,'all','x150','bb_last1').or_hi:.2f}] (no credible change); after two weak games the adjusted +10 odds are lower (OR {mt(TS,'all','p10','bb_last2').odds_ratio:.2f}). Stars show no weak-game or hot-game dependence at all. Do not present rebound-game or hot-streak chips as signals."),
    dict(id="heat_is_baseline_lag", kind="change", title="Relabel hot-game / minutes-up as 'average is stale'", text=f"The hot-game effect (RR {rrci(hl)}) collapses against the last-10 baseline (RR {rrci(hl10)}). Offer a baseline toggle (season-to-date vs last 10) on any big-night chip and note that recent form is already in the last-10 number."),
    dict(id="opp_tier_modest", kind="change", title="Defence and pace tiers: small, with CIs, not 'stars feast on bad defences'", text=f"Adjusted, bottom-10 defences add about {sg(100 * mt(TS,'all','x150','def_worst10').ame)} pp to 1.5x and top-10 defences take away {sg(100 * mt(TS,'all','x150','def_best10').ame)} pp; fast opponents add {sg(100 * mt(TS,'all','x150','pace_fast10').ame)} pp. The top-50 effect against bottom-10 defences is not credible (adjusted OR {mt(TS,'top50','x150','def_worst10').odds_ratio:.2f} [{mt(TS,'top50','x150','def_worst10').or_lo:.2f}, {mt(TS,'top50','x150','def_worst10').or_hi:.2f}]) and unstable by season. Elite defences are the more reliable signal (fewer big nights)."),
    dict(id="no_signal_list", kind="add", title="'What does not matter' strip", text="Once the other factors are held fixed, home vs away, back-to-back and rest days, the opponent's recent defensive form, the opponent missing players, NBA Cup games and late season have no credible big-night effect (raw second-night and late-season lifts of +1.4 and +3.4 pp for 1.5x disappear after adjustment). A short 'tested, nothing there' list is a useful honest panel."),
    dict(id="role_change_flag", kind="add", title="'Role change in progress' flag", text="Recent promotion to the starting five or last-5 minutes 3+ above the season average are associated with +2.5 to +3 pp of 1.5x big nights against the season-to-date baseline (not against the last-10 baseline): show as context for a player whose average is out of date, not as a forecast."),
    dict(id="stars_vs_nonstars", kind="add", title="Stars vs everyone toggle", text=f"Top-50 players reach 1.5x {pc(sbr('x150','star').base_rate)} of games vs {pc(sbr('x150','non_star').base_rate)} for others but +10 {pc(sbr('p10','star').base_rate)} vs {pc(sbr('p10','non_star').base_rate)}: say which definition. Defence-tier lifts and the 1.5x vacuum lift are the same ratio for both groups (the +10 vacuum ratio is smaller for stars, the +6 pp effect is the same); recent-form effects (hot game, weak game) exist for non-stars only."),
    dict(id="how_it_happened", kind="add", title="'How the night happened' bar on recaps (same game, labelled)", text="For a big night show minutes / shots per minute / efficiency shares of the excess (all players about 28% / 36% / 35%; top 50 about 18% / 44% / 38%), plus extra minutes, FGA and TS% vs the player's norm. Label it 'how it happened, not a prediction'."),
    dict(id="no_probability_widget", kind="change", title="Do not ship a pregame big-night probability", text=f"Pregame AUC is {f1(a_all['x150'].auc,2)} (1.5x) and {f1(a_all['p10'].auc,2)} (+10), only {f1(a_all['x150'].dauc_vs_ref,2)} and {f1(a_all['p10'].dauc_vs_ref,2)} above a controls-only model; for top-50 stars the pregame factors add nothing credible for 1.5x. Show base rates by context bucket (prior-average tier x teammates-out) instead of a model score."),
    dict(id="players_credible_only", kind="change", title="Per-player big-night cards: credible cases only, with the chance count", text="Show a player-specific big-night pattern only if the shrunk interval excludes the league mean, and print 'expected by chance' beside the count (20 players at |z| >= 2.5 vs 3.8 expected for 1.5x). No top-25 star qualifies; the credible ones are mostly role players (e.g. OG Anunoby, Deni Avdija, Payton Pritchard at 1.5x). Hide player flags for 2026-27."),
    dict(id="provisional", kind="change", title="Mark 2026-27 provisional and hide thin cells", text="2026-27 has about 106 1.5x events so far (std baseline, 8+ PPG); top 25 / top 10 are always thin (25 / 10 players): show counts only, never a ranking."),
]
A("## 10. App insights (what App Builder could add or change)\n")
for i_, x in enumerate(INSIGHTS, 1): A(f"{i_}. **{x['title']}** ({x['kind']}). {x['text']}")
A("")
A(f"""## 11. Files

`data/marts/big_night_events.parquet` (one row per eligible player-game: baselines, SDs, 12 event flags, all Lens A / Lens B fields), `big_night_counts` (cut x floor x baseline x timespan x segment), `big_night_factor_lift` (RR / OR / pp with CIs, adjusted OR and pp for the model terms, thin and reportable flags), `big_night_models` (logistic terms for lens A and the lens-B identity model, with ORs, AMEs and ranks), `big_night_model_performance` (AUC / Brier / log-loss, paired CIs, boosting kept flag), `big_night_shap`, `big_night_same_game_profile`, `big_night_stars_vs_nonstars`, `big_night_stars_interactions`, `big_night_star_base_rates`, `big_night_player_patterns`, `big_night_player_summary`; manifest `data/marts/big_nights_manifest.json` (definitions, thresholds, cell logs, SHA-256 of each table). DuckDB: the same names as views in `data/marts/nba_phase1.duckdb`. App summary: `data/big_nights_summary.json` (new, not read by the app).
""")
(ROOT / "docs" / "analysis").mkdir(parents=True, exist_ok=True)
open(ROOT / "docs" / "analysis" / "BIG_NIGHTS.md", "w").write("\n".join(D))
print(S.write(INSIGHTS, CAVEATS, man["through"], "d377ec4"))
