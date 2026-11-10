"""Player x condition study: docs/analysis/PLAYER_CONDITIONS.md and data/player_conditions_summary.json (generated from the marts)."""
from __future__ import annotations
import json, sys
from pathlib import Path
import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import player_conditions_core as C

ROOT = C.ROOT; M = ROOT / "data" / "marts"; TS = "pooled_2023_26"
OUT_MD = ROOT / "docs" / "analysis" / "PLAYER_CONDITIONS.md"; OUT_JSON = ROOT / "data" / "player_conditions_summary.json"
MAIN = C.MAIN_OUTCOMES
OUTN = {"dev": "points vs prior avg", "x125": "1.25x", "x150": "1.5x", "x200": "2.0x", "p10": "+10"}
UNIT = {"dev": "pts", "x125": "pp", "x150": "pp", "x200": "pp", "p10": "pp"}
SC = {"dev": 1.0, "x125": 100.0, "x150": 100.0, "x200": 100.0, "p10": 100.0}
VER_SHORT = {"persistent signal": "PERSISTENT", "persistent but small or scale-driven": "persistent (small/scale)", "cross-season only (not within season)": "cross-season only", "within-season only (not shown across seasons)": "within-season only",
             "noise": "noise", "not enough players": "n too small", "thin segment, not classified": "thin"}


def load():
    d = {k: pd.read_parquet(M / f"player_conditions_{k}.parquet") for k in ("summary", "persistence", "reliability", "responders", "profiles")}
    d["main"] = pd.read_parquet(M / "player_conditions.parquet"); return d


def f(x, k=2, sign=False):
    if x is None or (isinstance(x, float) and not np.isfinite(x)): return "n/a"
    return f"{x:+.{k}f}" if sign else f"{x:.{k}f}"


def rci(r, lo, hi): return "n/a" if not np.isfinite(r) else f"{r:+.2f} [{lo:+.2f}, {hi:+.2f}]"


def tbl(headers, rows):
    out = ["| " + " | ".join(headers) + " |", "|" + "---|" * len(headers)]
    out += ["| " + " | ".join(str(c) for c in r) + " |" for r in rows]; return "\n".join(out)


def agg_hits(rel, pers, cls_set, outcomes, seg="all", kind="lg"):
    """Sum of flagged players and held / sign-held counts in the temporal split for the given conditions."""
    p = pers[(pers.scheme == "temporal") & (pers.segment == seg) & pers.outcome.isin(outcomes)]
    keys = rel[(rel.segment == seg) & rel.verdict.isin(cls_set) & rel.outcome.isin(outcomes)][["condition", "outcome"]]
    p = p.merge(keys, on=["condition", "outcome"])
    n, h, sg = p[f"flags_{kind}_n"].sum(), p[f"flags_{kind}_held"].sum(), p[f"flags_{kind}_sign_held"].sum()
    chance = (p[f"flags_{kind}_chance_rate"] * p[f"flags_{kind}_n"]).sum() / n if n else np.nan
    return int(n), int(h), int(sg), chance


def main():
    d = load(); rel, pers, summ, resp, prof, main_ = d["reliability"], d["persistence"], d["summary"], d["responders"], d["profiles"], d["main"]
    C.init()
    rows_ts = C.ts_rows(TS)
    A = rel[rel.segment == "all"].set_index(["condition", "outcome"])
    sm = summ[(summ.timespan == TS)].set_index(["condition", "outcome", "segment"])
    L = []; w = L.append
    # ------------------------------------------------------------ numbers for the headline
    ver = A.verdict
    sig = [(c, o) for (c, o), v in ver.items() if v == "persistent signal"]
    sig_conds = sorted({c for c, o in sig}); sig_main = [(c, o) for c, o in sig if o in MAIN]
    within = sorted({c for (c, o), v in ver.items() if v == "within-season only (not shown across seasons)" and o in MAIN})
    allnoise = sorted({c for c in C.COND_IDS if all(ver.get((c, o), "noise") in ("noise", "not enough players") for o in C.OUTCOMES)})
    n_cells = len(A); n_cls = A.verdict.value_counts().to_dict()
    nz_sig = aggs = agg_hits(rel, pers, ["persistent signal"], C.OUTCOMES); nz_oth = agg_hits(rel, pers, ["within-season only (not shown across seasons)", "noise", "cross-season only (not within season)", "persistent but small or scale-driven"], C.OUTCOMES)
    topseg = rel[rel.segment.isin(["top100", "top50"])].groupby(["segment", "verdict"]).size().unstack(fill_value=0)
    oc = lambda c, o: A.loc[(c, o)]
    # ================================================================ document
    w("# PLAYER_CONDITIONS: which players respond to which conditions, and does it persist? (hoopstats)\n")
    w("Data through **2026-11-09**. One player x condition table over 28 conditions from every earlier study (home/away, back-to-back, rest days, opponent defence and pace tiers, opponent recent defensive form, teammates out, bounce-back, hot game, minutes and role trend, season phase), "
      "5 outcomes (points minus the prior season-to-date average; big-night rates at 1.25x, 1.5x, 2.0x and +10), 5 segments (all, top 100 / 50 / 25 / 10 by PPG) and the 6 app timespans (2026-27 and pooled spans including it are **provisional**) plus one training span (2023-24 + 2024-25). "
      "Scripts: `scripts/python/player_conditions_{core,run,assemble,summary,report}.py`; marts `data/marts/player_conditions*.parquet` (DuckDB views of the same names in `data/marts/nba_phase1.duckdb`); App Builder summary `data/player_conditions_summary.json` (not wired into the app).\n")
    w("Language: effects are *associated with* a condition for that player, never caused by it. Eligibility, the 8 PPG floor on the prior season-to-date average, the 5-prior-game rule and the teammates-out definition are those of BIG_NIGHTS.md.\n")
    w("## 1. Headline: is any of it bettable?\n")
    w(f"**Short answer: almost none of it. Of {n_cells} condition x outcome cells (all players), only {len(sig)} show player differences that persist out of sample (plus {n_cls.get('persistent but small or scale-driven', 0)} that persist but are small or scale-driven: {', '.join(f'{c} {OUTN[o]}' for (c, o), v in ver.items() if v == 'persistent but small or scale-driven')}), and all {len(sig)} belong to two related conditions, 'the team's top scorer is out' and 'a 20+ PPG teammate is out'. For every other condition (home/away, back-to-backs, rest, defence tier, pace, opponent form, bounce-back, hot game, minutes trend, role change, early vs late season) the player-specific effects either do not persist or only agree within a season; treat them as noise.** "
      f"Stars (top 100 / 50) show no persistent player-specific condition effect at all, and for most conditions there are too few star-seasons to test it.\n")
    w("1. **What persists.** " + "; ".join(f"{cc} ({', '.join(OUTN[o] for c, o in sig if c == cc)})" for cc in sig_conds) +
      ". For the team's top scorer out (points vs prior average) the 2023-25 -> 2025-26 correlation of player effects is " + rci(oc('out_top1', 'dev').temporal_pearson_r, oc('out_top1', 'dev').temporal_r_lo, oc('out_top1', 'dev').temporal_r_hi) +
      f" over {int(oc('out_top1', 'dev').temporal_n_pairs)} players (BH q {oc('out_top1', 'dev').temporal_q_value:.3f}); the odd-even within-season split gives {oc('out_top1', 'dev').odd_even_pearson_r:+.2f} (Spearman-Brown {oc('out_top1', 'dev').odd_even_sb_r:+.2f}). "
      f"The calibration slope of next-period effects on this period's shrunk effects is {oc('out_top1', 'dev').temporal_calib_slope:.2f} [{oc('out_top1', 'dev').temporal_calib_slope_lo:.2f}, {oc('out_top1', 'dev').temporal_calib_slope_hi:.2f}] (1 = perfectly calibrated, 0 = noise). Real but moderate: the spread of true effects across players is about {oc('out_top1', 'dev').eb_tau_pooled_2023_26:.1f} points (EB tau) around a league mean of {oc('out_top1', 'dev').league_mean_pooled_2023_26:+.1f}, and a player's raw estimate is only about {oc('out_top1', 'dev').eb_reliability_pooled_2023_26 * 100:.0f}% signal.")
    bord = [(c, o) for (c, o) in sig if A.loc[(c, o)].temporal_q_value >= 0.05]
    if bord: w("   Borderline across seasons (BH q between 0.05 and 0.10): " + ", ".join(f"{c} {OUTN[o]} (q {A.loc[(c, o)].temporal_q_value:.3f})" for c, o in bord) + ".")
    w(f"2. **Within-season only (do not carry across seasons):** {', '.join(within)}. Odd/even halves of the same seasons agree (they share the same teams, injury spells and schedule), but 2023-25 effects do not predict 2025-26 effects. This is consistent with team-situation effects, not stable player traits. Do not read it as bettable.")
    w(f"3. **Noise, or too thin to test, in every outcome:** {', '.join(allnoise) if allnoise else 'none'}. Verdict counts over all {n_cells} all-player cells: " + ", ".join(f"{VER_SHORT.get(k, k)} {v}" for k, v in n_cls.items()) + ".")
    sx = sm.loc[("out_top1", "dev", "all")]; se_ = sm.loc[("early_vs_late", "dev", "all")]
    w(f"4. **Flags vs chance.** Per condition the number of players whose shrunk effect differs credibly from the league mean is zero or near zero for most conditions (permutation expectation about 0.01); the largest counts are for the team's-top-scorer-out dev cell ({sx.n_strong_lg} strong + {sx.n_watch_lg} watch vs {sx.exp_strong_lg + sx.exp_watch_lg:.2f} expected), a 20+ PPG teammate out, minutes-up and early-vs-late (section 4). Excess over chance is necessary but not sufficient: early_vs_late (points) has {se_.n_strong_lg + se_.n_watch_lg} vs-league flags against {se_.exp_strong_lg + se_.exp_watch_lg:.2f} expected, yet its cross-season correlation is {A.loc[('early_vs_late', 'dev')].temporal_pearson_r:+.2f}: the flagged players are flagged within a season, not across seasons. Flags that say 'effect differs from zero' mostly restate a league-wide effect (every player is flagged when the league mean is clearly non-zero and tau is about 0); the player-specific statement is the **vs-league flag**.")
    n1, h1, s1, c1 = nz_sig; n2, h2, s2, c2 = nz_oth
    w(f"5. **Do flags hold out of sample?** In the 2023-25 -> 2025-26 test, vs-league flags (strong or watch) in the persistent conditions: {n1} flagged, sign repeated for {s1} ({100 * s1 / max(n1, 1):.0f}%; chance 50%), significance repeated for {h1} (chance expectation {c1 * 100:.0f}% from the test season's own flag rate). In all other conditions: {n2} flagged, sign repeated {s2} ({100 * s2 / max(n2, 1):.0f}%), significance repeated {h2}. A single held-out season has little power for per-player significance, so the sign is the fairer yardstick.")
    w("6. **Stars.** In top 100 / top 50 no condition x outcome cell is classified persistent (" + "; ".join(f"{sg}: " + ", ".join(f"{VER_SHORT.get(k, k)} {int(v)}" for k, v in topseg.loc[sg].items() if v) for sg in topseg.index) + "); most star cells fail the n >= 30 paired-player requirement for the cross-season test (a star needs 10+ games on each side in 2025-26 alone). Top 25 / top 10 are always thin and are descriptive only.")
    w("7. **2026-27 (provisional).** At most 22 players have 3+ games on each side of any condition in 2026-27 and none for most; the extra out-of-sample check is empty for almost every cell (see section 6). It adds nothing yet.")
    w("8. **Not a betting model.** Effects are in points against the player's own prior average (or big-night rates), not against a sportsbook line; there are no lines in the data. A market that already prices 'top scorer out' league-wide would not be beaten by the league-wide part of the effect.\n")
    # ------------------------------------------------------------ method
    w("## 2. Method\n")
    w("**Rows.** The big-nights dataset (regular season, >= 5 minutes, >= 5 prior games this season and overall, opponent with >= 5 prior games) restricted to a prior season-to-date average of **8+ PPG** (all five outcomes then exist for every row). **Outcomes:** `dev` = points minus the prior season-to-date average; `x125`, `x150`, `x200` = points >= 1.25 / 1.5 / 2.0 x that average; `p10` = points >= average + 10. Rates are reported in percentage points (pp), dev in points.\n")
    w("**Conditions (28)** use the factor definitions of BIG_NIGHTS.md. The reference ('not in condition') is the complement for tiers and rest categories, 'rested' for back-to-back nights, 'no regular teammate out' for the vacuum conditions, the neutral band for opponent-form, minutes-trend and role conditions, and late season for the early-vs-late condition. Rest 0 days coincides with the second night of a back-to-back by construction; the conditions overlap and are not independent tests.\n")
    ct = []
    for cid, grp, lab, cs, rs in C.CONDS:
        a, b = C.MASKS[cid]; ct.append([cid, grp, lab, f"{int((a & rows_ts).sum()):,}", f"{int((b & rows_ts).sum()):,}"])
    w(tbl(["condition", "group", "definition", "games in condition", "games in reference"], ct) + f"\n\n(pooled 2023-24 to 2025-26, 8+ PPG floor: {int(rows_ts.sum()):,} player-games.)\n")
    w("**Per player effect.** In-condition mean minus reference mean, per player and timespan, with the **minimum n of 10 games on each side** (3 and 3 for 2026-27 and 5 and 5 for the within-season halves). The standard error uses the player's **pooled variance** over the games of both sides (for dev, the sample variance of dev; for events, the smoothed pooled rate (S+1)/(N+2)): sqrt(v (1/n_cond + 1/n_ref)). A pooled (null-based) variance does not depend on the sign of the difference; a per-side variance biases inverse-variance weighted league means for rare or skewed outcomes (we first used per-side variances and caught this with the permutation null, where the league mean came out 'significant' in most permutations).\n")
    w("**Empirical Bayes.** Per timespan x segment x condition x outcome: DerSimonian-Laird tau^2, random-effects league mean mu, shrunk effect theta = mu + B (d - mu) with B = tau^2 / (tau^2 + se^2), posterior SD sqrt(B se^2 + (1 - B)^2 var(mu)); 95% shrunk interval theta +/- 1.96 SD. **EB reliability** = tau^2 / (tau^2 + mean se^2). Segments with their own parameters: all, top 100, top 50 (>= 30 players). Top 25 and top 10 (thin) reuse the top 50 parameters and are marked thin.\n")
    w("**Flags (documented thresholds).** Both flags need the minimum n; a **strong** flag also needs **n >= 15 on both sides**.\n"
      "- `flag` (effect differs from zero): **strong** = the shrunk 95% interval excludes 0 and n >= 15 on both sides; **watch** = the shrunk 90% interval excludes 0 (strong not met); else none. `flag_direction` = sign of the shrunk effect.\n"
      "- `flag_vs_league` (player differs from the league mean; the player-specific statement): the same rule applied to theta - mu with posterior SD sqrt(B) * se.\n"
      "- When tau is about 0 the shrunk estimates all equal mu and `flag` is simply a statement about the league mean, so read `flag_vs_league` for 'who responds differently'.\n")
    w("**Flagged vs chance.** Permutation null: 200 within-player shuffles of the condition labels (keeping each player's n on both sides), the whole pipeline (SE, tau, shrinkage, flags) recomputed each time. Expected counts are the permutation means; permutation p = (1 + #{null >= observed}) / 201. Because the shuffle removes the league-wide effect too, the null for `flag` is about 5% of players when the league effect would otherwise show; the null for `flag_vs_league` is about zero (shrinkage removes flags unless tau > 0).\n")
    w("**Persistence (the key test).** Player effects from period A are compared with the same effects in a later or held-out period B, for players eligible in both (min n each period), and each segment:\n"
      "- `temporal`: A = 2023-24 + 2024-25 pooled, B = 2025-26 (held-out season).\n"
      "- `odd_even`: odd vs even games (by within-season game number) of the pooled 2023-26 span, min n 5 per side per half; Spearman-Brown corrected r = 2r / (1 + r). Halves share teams, injuries and schedule, so this measures within-season consistency and **overstates cross-season persistence**.\n"
      "- `random_halves`: mean of 20 random half splits of the games (same caveat; CI approximate because the splits overlap).\n"
      "- `provisional_2026_27`: 2023-26 -> 2026-27 to date (tiny n).\n"
      "Reported per condition x outcome x segment: Pearson r (Fisher 95% CI) and Spearman rho, EB reliabilities of each period on the paired players, the maximum r expected if effects were perfectly stable sqrt(rel_A rel_B), the disattenuated r, the calibration slope of B's raw effect on A's shrunk effect (WLS, HC1 interval), a partial r controlling for the player's overall rate of the outcome (guards against 'high-rate players have bigger pp effects'), and the flag hit rates (flags in A -> same-direction flag in B, vs a chance rate from B's own flag share; sign-only repeat vs 50%).\n"
      "**Classification (all players).** `persistent` = temporal r > 0 with BH q < 0.10 (across the 28 x 5 cells) and odd-even r > 0 with q < 0.10; `cross_season_only`, `within_season_only` = only one of the two; `noise` = neither; `insufficient` = fewer than 30 paired players in either scheme; top 25 / top 10 = thin. **Verdict** `persistent signal` additionally needs the base-rate check (temporal partial r >= half the raw r) and a practical size (pooled EB reliability >= 0.10); otherwise 'persistent but small or scale-driven'.\n")
    w("**`held_out_of_sample` in the player table.** For a flagged player-condition-outcome row, the later period is: pooled 2023-25 -> 2025-26; 2023-24 -> 2024-25; 2024-25 -> 2025-26; 2025-26 and pooled 2023-26 -> 2026-27 (provisional); none for 2026-27 and pooled 2023-27. `held_out_of_sample` (for `flag`) and `held_vs_league` (for `flag_vs_league`) are true if the player has a strong or watch flag in the same direction in the later period, false if he is eligible there and does not, NA if the row is not flagged or he is not eligible in the later period; `held_sign_*` is the sign-only version. Segment-specific versions carry the segment suffix. Rows for the later period use that period's own EB.\n")
    # ------------------------------------------------------------ section 3: league-level effects
    w("## 3. League-level effect per condition (context)\n")
    w("Pooled 2023-24 to 2025-26, all players with the minimum n: the league mean effect (EB random-effects), the between-player SD of true effects tau, and the EB reliability. These are the part of the effect a market already knows; the player-specific part is tau.\n")
    rows = []
    for cid in C.COND_IDS:
        r = [cid]
        for o in MAIN:
            s = sm.loc[(cid, o, "all")]
            r.append(f"{s.league_mean * SC[o]:+.2f} / {s.tau * SC[o]:.2f} / {s.eb_reliability:.2f}")
        rows.append(r)
    w(tbl(["condition"] + [f"{OUTN[o]} ({UNIT[o]}): mean / tau / rel" for o in MAIN], rows) + "\n")
    # ------------------------------------------------------------ section 4: flagged vs chance
    w("## 4. Flagged players vs expected by chance\n")
    w("Pooled 2023-24 to 2025-26, all players. `vs league`: strong + watch counts and the permutation expectation (mean of 200 shuffles) with the permutation p of the strong count; `!= 0`: strong + watch counts and expectation (dominated by the league-wide effect when tau is about 0). Segment and timespan versions are in `player_conditions_summary`. The permutation expectation for `!= 0` is a mean of all-or-nothing outcomes (when tau is about 0 all players share the league mean and are flagged together in about 5-10% of shuffles), so it is not a typical count; read it only as the scale of the null.\n")
    for o in MAIN:
        rows = []
        for cid in C.COND_IDS:
            s = sm.loc[(cid, o, "all")]
            rows.append([cid, int(s.n_players), f"{s.n_strong_lg}+{s.n_watch_lg}", f"{s.exp_strong_lg + s.exp_watch_lg:.2f}", f"{s.perm_p_strong_lg:.3f}", f"{s.n_strong_nz}+{s.n_watch_nz}", f"{s.exp_strong_nz + s.exp_watch_nz:.1f}", A.loc[(cid, o)].verdict if (cid, o) in A.index else ""])
        w(f"**{OUTN[o]}**\n")
        w(tbl(["condition", "players", "vs league: strong+watch", "expected", "perm p (strong)", "!= 0: strong+watch", "expected", "persistence verdict"], rows) + "\n")
    # ------------------------------------------------------------ section 5: persistence
    w("## 5. Persistence and reliability per condition x outcome\n")
    w("All players. `temporal` r is the correlation of player effects 2023-25 vs 2025-26 (n players, BH q for r > 0); `odd-even` r (Spearman-Brown in brackets); `random` r = mean of 20 random half splits; `EB rel` = tau^2 / (tau^2 + mean se^2) pooled 2023-26; `slope` = calibration slope of 2025-26 effects on 2023-25 shrunk effects (n/a when the shrunk effects have no spread).\n")
    for o in MAIN:
        rows = []
        for cid in C.COND_IDS:
            if (cid, o) not in A.index: continue
            r = A.loc[(cid, o)]
            sl = f"{r.temporal_calib_slope:.2f} [{r.temporal_calib_slope_lo:.2f}, {r.temporal_calib_slope_hi:.2f}]" if np.isfinite(r.temporal_calib_slope) else "n/a"
            rows.append([cid, f"{rci(r.temporal_pearson_r, r.temporal_r_lo, r.temporal_r_hi)} ({int(r.temporal_n_pairs)}), q {f(r.temporal_q_value, 2)}", f"{r.odd_even_pearson_r:+.2f} ({r.odd_even_sb_r:+.2f}), n {int(r.odd_even_n_pairs)}, q {f(r.odd_even_q_value, 2)}",
                         f"{r.random_pearson_r:+.2f}", f"{r.eb_reliability_pooled_2023_26:.2f}", sl, f"**{VER_SHORT[r.verdict]}**" if r.verdict == "persistent signal" else VER_SHORT[r.verdict]])
        w(f"**{OUTN[o]}**\n"); w(tbl(["condition", "temporal r [95% CI] (n)", "odd-even r (SB)", "random r", "EB rel", "slope [95% CI]", "verdict"], rows) + "\n")
    w("The other outcomes (1.25x, 2.0x) are in `player_conditions_persistence` / `player_conditions_reliability`. For the persistent signals the cross-check on the other outcomes:\n")
    rows = []
    for c, o in sig:
        r = A.loc[(c, o)]; rows.append([c, OUTN[o], rci(r.temporal_pearson_r, r.temporal_r_lo, r.temporal_r_hi), f"{r.temporal_partial_r_base:+.2f}", f"{r.odd_even_sb_r:+.2f}", f"{r.eb_reliability_pooled_2023_26:.2f}", f"{r.eb_tau_pooled_2023_26 * SC[o]:.2f} {UNIT[o]}", f"{r.league_mean_pooled_2023_26 * SC[o]:+.2f} {UNIT[o]}"])
    w(tbl(["condition", "outcome", "temporal r [95% CI]", "partial r (base rate)", "odd-even SB r", "EB rel", "tau", "league mean"], rows) + "\n")
    w("**Flag hit rates, temporal split (2023-25 flags -> 2025-26), all players.** Flagged = strong or watch.\n")
    rows = []
    for lab, cl in (("persistent signal conditions", ["persistent signal"]), ("all other cells", ["within-season only (not shown across seasons)", "noise", "cross-season only (not within season)", "persistent but small or scale-driven"])):
        for kind, kn in (("lg", "vs league"), ("nz", "!= 0")):
            n, h, sg, ch = agg_hits(rel, pers, cl, C.OUTCOMES, kind=kind)
            rows.append([lab, kn, n, f"{sg} ({100 * sg / max(n, 1):.0f}%)", f"{h} ({100 * h / max(n, 1):.0f}%)", f"{ch * 100:.0f}%" if np.isfinite(ch) else "n/a"])
    w(tbl(["cells", "flag type", "flagged in 2023-25", "same sign in 2025-26", "same-direction flag in 2025-26", "chance rate"], rows) + "\n")
    w("Reading: significance rarely repeats because one held-out season is short; for the `!= 0` flag the hit rate mostly reflects the league-wide effect (the chance column controls for it using the test season's own flag share). Compare the sign-repeat rate with 50%.\n")
    # segments
    w("**Segments.** Verdict counts by segment (all 140 cells each):\n")
    vc = rel.groupby(["segment", "verdict"]).size().unstack(fill_value=0)
    w(tbl(["segment"] + [VER_SHORT.get(c, c) for c in vc.columns], [[sg] + [int(vc.loc[sg, c]) for c in vc.columns] for sg in C.SEGS_ALL]) + "\n")
    w("Top 100 / top 50 have no persistent condition; the cross-season test often has < 30 paired players (a star needs 10+ games on each side in 2025-26 and in 2023-25). The star-segment figures for each condition are in the mart; example (points vs prior average, top 100 / top 50):\n")
    rows = []
    for cid in ("out_top1", "vac_star", "vac_any", "home", "hot_last1", "bb_last1", "early_vs_late"):
        r = []
        for sg in ("top100", "top50"):
            x = rel[(rel.segment == sg) & (rel.condition == cid) & (rel.outcome == "dev")].iloc[0]
            r.append(f"temporal {rci(x.temporal_pearson_r, x.temporal_r_lo, x.temporal_r_hi)} ({int(x.temporal_n_pairs)}); odd-even {x.odd_even_pearson_r:+.2f} ({int(x.odd_even_n_pairs)})")
        rows.append([cid] + r)
    w(tbl(["condition", "top 100", "top 50"], rows) + "\n")
    # ------------------------------------------------------------ section 6: provisional
    w("## 6. 2026-27 provisional check\n")
    v = pers[(pers.scheme == "provisional_2026_27") & (pers.segment == "all") & (pers.outcome == "dev")]
    ok = v[v.n_pairs >= 10]
    w(f"With the 3-and-3 minimum, {int((v.n_pairs > 0).sum())} of 28 conditions have any paired player and only {len(ok)} have 10 or more ({', '.join(ok.condition)}); none of those correlations is distinguishable from zero (CIs span zero). The team's top scorer out / a 20+ PPG teammate out have no paired players yet. 2026-27 per-player rows are in the mart (provisional) and are almost always shrunk to the league mean.\n")
    # ------------------------------------------------------------ section 7: responders
    w("## 7. Top responders\n")
    w("Pooled 2023-24 to 2025-26, all players, **ranked by shrunk effect** (the ranking is identical to ranking by deviation from the league mean), only players with **n >= 15 games on each side**; non-thin segments only (top 100 and top 50 lists are in `player_conditions_responders`). Persistence marks: the verdict of the condition x outcome cell; 'shrunk 2023-25' and 'raw 2025-26' are the same player's estimates in the training and held-out period (the 2025-26 season is also inside the pooled estimate, so they are not independent of the shrunk value shown).\n")
    for cid, o in [("out_top1", "dev"), ("out_top1", "x150"), ("vac_star", "dev")]:
        g = resp[(resp.segment == "all") & (resp.condition == cid) & (resp.outcome == o)]
        if g.empty: continue
        r0 = A.loc[(cid, o)]; s0 = sm.loc[(cid, o, "all")]
        w(f"### {cid}, {OUTN[o]}: {C.COND_LABEL[cid]}\n")
        w(f"League mean {s0.league_mean * SC[o]:+.2f} {UNIT[o]}, tau {s0.tau * SC[o]:.2f}, EB reliability {s0.eb_reliability:.2f}; flagged vs league {s0.n_strong_lg} strong + {s0.n_watch_lg} watch against {s0.exp_strong_lg + s0.exp_watch_lg:.2f} expected by chance. Persistence: **{VER_SHORT[r0.verdict]}** (temporal r {r0.temporal_pearson_r:+.2f}, odd-even SB r {r0.odd_even_sb_r:+.2f}).\n")
        for dirn, lab in (("top_positive", "Most responsive (largest shrunk effect)"), ("top_negative", "Least responsive (smallest shrunk effect)")):
            rows = []
            for r in g[g.direction == dirn].sort_values("rank").itertuples(index=False):
                rows.append([r.rank, r.player_name, f"{int(r.n_cond)} / {int(r.n_ref)}", f"{r.raw_diff * SC[o]:+.2f}", f"{r.shrunk * SC[o]:+.2f} [{r.shrunk_ci_low * SC[o]:+.2f}, {r.shrunk_ci_high * SC[o]:+.2f}]", r.flag_vs_league,
                             f"{r.shrunk_2023_25 * SC[o]:+.2f}" if np.isfinite(r.shrunk_2023_25) else "n/a", f"{r.raw_diff_2025_26 * SC[o]:+.2f}" if np.isfinite(r.raw_diff_2025_26) else "n/a"])
            w(f"*{lab}* ({UNIT[o]}):\n"); w(tbl(["#", "player", "n in / out", "raw diff", "shrunk [95%]", "vs league", "shrunk 2023-25", "raw 2025-26"], rows) + "\n")
    w("**Other conditions, points vs prior average: top 3 each way (all players, n >= 15).** Cells whose true-effect spread is negligible (EB reliability < 0.05) are not ranked. Marked with the persistence verdict; only ranks from conditions marked persistent or cross-season are worth reading, the rest are what noise looks like.\n")
    rows = []
    for cid in C.COND_IDS:
        g = resp[(resp.segment == "all") & (resp.condition == cid) & (resp.outcome == "dev")]
        if g.empty: continue
        if not g.ranking_meaningful.iloc[0]:
            rows.append([cid, "not ranked (no measurable spread between players)", "", VER_SHORT[A.loc[(cid, "dev")].verdict]]); continue
        pos = ", ".join(f"{r.player_name} ({r.shrunk:+.1f})" for r in g[g.direction == "top_positive"].sort_values("rank").head(3).itertuples())
        neg = ", ".join(f"{r.player_name} ({r.shrunk:+.1f})" for r in g[g.direction == "top_negative"].sort_values("rank").head(3).itertuples())
        rows.append([cid, pos, neg, VER_SHORT[A.loc[(cid, "dev")].verdict]])
    w(tbl(["condition", "highest shrunk", "lowest shrunk", "persistence (dev)"], rows) + "\n")
    # ------------------------------------------------------------ section 8: profiles
    w("## 8. Example player profiles\n")
    w("Points vs prior average, pooled 2023-24 to 2025-26, all-player EB. For each player: the three conditions where his shrunk effect is furthest above the league mean and the three furthest below (n >= 15 games on each side; deviation = shrunk - league mean). 'condition persistence' is the verdict of the condition; conditions with no measurable spread between players (EB reliability < 0.05) are left out; anything marked noise is shown only to be honest about it. The persistence marks come from the all-player test and are not shown to hold in the star segments, so a star's row marked persistent says the condition has persistent player differences in the population, not that his own effect is reliable. Full profiles (dev, 1.5x, +10) for every player are in `player_conditions_profiles`.\n")
    ex = ["Quentin Grimes", "Spencer Dinwiddie", "Payton Pritchard", "Jalen Brunson", "Nikola Jokić", "Shai Gilgeous-Alexander", "LeBron James"]
    for nm in ex:
        g = prof[(prof.player_name == nm) & (prof.outcome == "dev")]
        if g.empty: continue
        w(f"**{nm}**" + (" (top 50)" if g.in_top50.iloc[0] else "") + f", {int(g.n_conditions_available.iloc[0])} conditions with n >= 15:\n")
        rows = []
        for r in g.sort_values(["side", "rank"], ascending=[False, True]).itertuples(index=False):
            rows.append([("above league" if r.side == "most_positive" else "below league"), r.condition, f"{int(r.n_cond)} / {int(r.n_ref)}", f"{r.raw_diff:+.2f}", f"{r.shrunk:+.2f} [{r.shrunk_ci_low:+.2f}, {r.shrunk_ci_high:+.2f}]", f"{r.deviation_from_league:+.2f}", r.flag_vs_league, VER_SHORT.get(r.verdict, r.verdict)])
        w(tbl(["side", "condition", "n in / out", "raw", "shrunk [95%]", "vs league mean", "flag vs league", "condition persistence"], rows) + "\n")
    # ------------------------------------------------------------ caveats
    w("## 9. Caveats and data gaps\n")
    CAV = [
        "Associational, not causal. A player's response to 'top scorer out' mixes role (second option vs role player), minutes, lineups and opponent adjustments; it is a pattern in his games, not a trait he carries to another team.",
        "Teammates out is observed from the box score of the game itself (inactive or non-coach DNP); it is knowable at about tip-off, not days ahead. Team changes between periods are not modelled: a player who moved teams has a different set of teammates in the two periods.",
        "One held-out season is short. Persistence of per-player significance is low-powered; the correlation, calibration slope and sign repeat are the fairer reads. Cross-season correlations use players with 10+ games on both sides in both periods, so rare conditions (3+ rest days, role changes, best/worst-5 defence) can be tested for few players only.",
        "Odd-even and random halves share the same seasons: they overstate persistence (team-specific and spell-specific effects). We only call something 'persistent' if it also shows across seasons.",
        "The conditions overlap (rest 0 = second night of a back-to-back; best-5 within best-10; vacuum measures): 28 conditions x 5 outcomes = 140 cells per segment are tested. Persistence uses BH q < 0.10 over those cells; flags use a permutation expectation per cell, not a multiplicity correction across cells.",
        "Event outcomes (1.25x, 1.5x, 2.0x, +10) are sparse per player (a 1.5x night is about 16% of games, 2.0x about 4%): their per-player intervals are wide and most shrink to the league mean. Pp effects scale with a player's base rate, so we report a partial correlation controlling for it.",
        "The effect against the prior season-to-date average inherits the baseline lag found in BIG_NIGHTS.md (after a hot game or a minutes increase the season average is stale). Those two conditions are at least partly 'average is out of date', not response.",
        "The persistent responders are largely the same names under 'top scorer out' and '20+ PPG teammate out' (role players who become primary options when a team's leading scorer sits); their effect is a role effect on their team, not a portable trait, and players who changed teams between periods are compared across different casts.",
        "Stars: top 25 and top 10 are always thin (25 and 10 players) and reuse the top 50 EB parameters; only top 100 and top 50 can be ranked.",
        "2026-27 and the pooled spans that include it are provisional. The 2023-24 + 2024-25 span is an internal training span, not an app timespan (rows carry `aux_training_span`).",
        "Not available: sportsbook lines (so no edge calculation), defender matchups, referee crews, pregame injury report beyond the inactive list, play-by-play.",
    ]
    for c in CAV: w("- " + c)
    w("")
    # ------------------------------------------------------------ insights
    INS = []
    def ins(title, text, kind): INS.append(dict(id=f"pc{len(INS) + 1}", kind=kind, title=title, text=text))
    r = oc("out_top1", "dev")
    ins("Show 'responds to the top scorer being out' for players who clear the bar", f"The one player-specific pattern that persists across seasons: players differ in how much they gain when their team's top scorer is out (dev: temporal r {r.temporal_pearson_r:+.2f} [{r.temporal_r_lo:+.2f}, {r.temporal_r_hi:+.2f}], tau {r.eb_tau_pooled_2023_26:.1f} pts around a league mean of {r.league_mean_pooled_2023_26:+.1f}). Show the shrunk effect with its interval and n for players flagged vs league (strong or watch), never the raw difference; wording 'associated with'; trigger from the inactive list.", "add")
    ins("Do not ship player-specific cards for the noise conditions", "Back-to-back and rest days, defence tier, pace, opponent recent form, minutes down, 3+ rest and role change have no player-specific effect that survives out of sample (and nothing measurable at all for most of them). Show the league-level effect and a 'tested, no player pattern persists' note instead of a player ranking.", "change")
    ins("Label within-season-only patterns as 'this season only' or hide them", "Home/away, hot game, bounce-back (dev), minutes up, early vs late, worst-5 defence and the any-teammate-out measures are consistent within a season but do not predict the next season. If shown at all, mark 'this season, may reflect the current team situation', and never as a trait.", "change")
    ins("Stars: league-level effects only", "No condition has a persistent player-specific effect among the top 100 / 50, and the cross-season test is mostly under-powered for them. For stars show the pooled league effects from BIG_NIGHTS, not individual responder lists.", "change")
    ins("Use shrunk estimates and the vs-league flag", "`flag` (differs from zero) is a statement about the league mean whenever tau is about 0. Use `flag_vs_league` (+ shrunk interval + n both sides) for who responds differently, and show the reliability (EB reliability about 0.3 to 0.45 for the persistent cells: a player's raw estimate is mostly noise).", "change")
    ins("Show flagged-vs-chance beside any list", "Print the expected-by-chance count beside the flagged count (about 0 for vs-league flags under the permutation null) and the persistence verdict of the condition; do not rank a condition whose verdict is noise.", "add")
    ins("Hide 2026-27 per-player condition rows", "2026-27 has at most a few players with 3+ games on both sides of a condition; the held-out check is empty. Mark provisional or hide.", "change")
    ins("Do not present these as betting edges", "The effects are in points against the player's own prior average, not against a line; league-wide parts are already visible to the market. Use as context ('responds more than most when X'), not as a bet.", "change")
    w("## 10. App insights (what App Builder could add or change)\n")
    for i, x in enumerate(INS, 1): w(f"{i}. **{x['title']}** ({x['kind']}). {x['text']}")
    w("")
    w("## 11. Files\n")
    w("`player_conditions` (one row per timespan x condition x outcome x player: n both sides, means, raw difference with SE and 95% interval, shrunk estimate and interval, `flag` / `flag_vs_league` with direction and the held-out marks for all / top100 / top50, persistence class), `player_conditions_summary` (timespan x segment x condition x outcome: n players, league mean, tau, EB reliability, flagged counts with permutation expectation, sd, 95th percentile and p; thin and provisional flags), `player_conditions_persistence` (scheme x segment x condition x outcome: correlations with CIs, Spearman-Brown, reliabilities, calibration slope, partial r, flag hit rates), `player_conditions_reliability` (one row per condition x outcome x segment: classification, verdict, key figures), `player_conditions_responders` (top 10 each way per condition x outcome, segments all / top100 / top50, with persistence marks), `player_conditions_profiles` (per player: three most and three least affected conditions for dev / 1.5x / +10), `player_conditions_definitions`; manifest `data/marts/player_conditions_manifest.json`. DuckDB: same names as views in `data/marts/nba_phase1.duckdb`. App summary: `data/player_conditions_summary.json` (new, not read by the app).")
    OUT_MD.write_text("\n".join(L) + "\n")
    return INS, CAV


if __name__ == "__main__":
    INS, CAV = main()
    import player_conditions_summary as S
    print(S.write(INS, CAV)); print(OUT_MD, OUT_MD.stat().st_size)
