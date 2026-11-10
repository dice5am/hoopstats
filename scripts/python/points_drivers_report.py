"""Builds POINTS_DRIVERS.md from data/marts/points_drivers.parquet + data/manifests/points_drivers.json (every number in the tables is read from them).
Usage: .venv/bin/python scripts/points_drivers_report.py [--out data/marts/POINTS_DRIVERS.md]"""
import argparse, json, re
from pathlib import Path
import numpy as np, pandas as pd

ROOT = Path(__file__).resolve().parents[1]
TS = ["pooled_2023_26", "pooled_2023_27", "2023_24", "2024_25", "2025_26", "2026_27"]
SG = ["all", "top100", "top50", "top25", "top10"]
LBL = {"min": "minutes", "fga": "FGA", "fta": "FTA", "fg3a": "3PA", "usg_pct": "USG%", "ts_pct": "TS%", "efg_pct": "eFG%", "pace": "pace", "ast_pct": "AST%",
       "oreb_pct": "OREB%", "dreb_pct": "DREB%", "tov_pct": "TOV%", "def_rating": "def rating", "off_rating": "off rating", "net_rating": "net rating", "pie": "PIE", "pts": "prior PPG"}
f = lambda v, d=2: "n/a" if v is None or pd.isna(v) else f"{v:.{d}f}"
ci = lambda r: f"{r.coef_std:+.2f} [{r.ci_low:+.2f}, {r.ci_high:+.2f}]" if pd.notna(r.ci_low) else f"{r.coef_std:+.2f} (no CI)"


def md_table(rows, head):
    return "\n".join(["| " + " | ".join(head) + " |", "|" + "---|" * len(head)] + ["| " + " | ".join(str(x) for x in r) + " |" for r in rows])


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--out", default=str(ROOT / "data/marts/POINTS_DRIVERS.md")); a = ap.parse_args()
    df = pd.read_parquet(ROOT / "data/marts/points_drivers.parquet")
    m = json.load(open(ROOT / "data/manifests/points_drivers.json"))
    mod = df[~df.model.str.startswith("screen") & (df.model != "none")].copy()
    mod["base_model"] = mod.model.str.split("@").str[0]; mod["window"] = mod.model.str.split("@").str[1]
    mod["b_r2"] = mod.notes.str.extract(r"baseline_r2=(-?[\d.]+)")[0].astype(float)
    mod["b_rmse"] = mod.notes.str.extract(r"baseline_rmse=(-?[\d.]+)")[0].astype(float)
    mod["b_l10"] = mod.notes.str.extract(r"baseline_l10_mae=(-?[\d.]+)")[0].astype(float)
    cell = mod.groupby(["lens", "timespan", "segment", "model"]).agg(r2=("test_r2", "first"), mae=("test_mae", "first"), rmse=("test_rmse", "first"), base=("baseline_mae", "first"),
                                                                      b_r2=("b_r2", "first"), b_rmse=("b_rmse", "first"), b_l10=("b_l10", "first"), thin=("thin_flag", "first"),
                                                                      n_games=("n_games", "first"), n_players=("n_players", "first")).reset_index()
    cov = pd.DataFrame(m["coverage"])
    L = []
    A = L.append
    A("# POINTS_DRIVERS: which variables are associated with player points (hoopstats)\n")
    A(f"Data through **{m['through']}** (2023-24 to 2026-27 to date). Built by `scripts/points_drivers.py` (report by `scripts/points_drivers_report.py`); seed {m['seed']}; table `data/marts/points_drivers.parquet` "
      f"(also the DuckDB view `points_drivers` in `data/marts/nba_phase1.duckdb`; {m['n_rows']:,} rows; sha256 `{m['parquet_sha256'][:12]}…`). Data deliverable only: not used by the app; no app changes.\n")
    A("**Language.** Everything below is *association / prediction*, never cause. \"fga is associated with +6.5 PTS per SD\" means players-games with more FGA have more PTS on average, holding the other kept variables fixed. "
      "It does not say that taking more shots would cause more points.\n")
    A("## 1. Table contract\n")
    A("One tidy row per lens × segment × timespan × model × driver. Columns, in order: `lens` (extra leading column: `explanatory` | `pregame`), `segment, timespan, model, driver, coef_std, ci_low, ci_high, rank_in_cell, kept_after_vif, shap_mean_abs, test_r2, test_mae, test_rmse, baseline_mae, n_games, n_players, thin_flag, notes`. Nulls, never NaN.\n")
    A("- `model`: `screen_pearson`, `screen_spearman` (step 2, screening only: `coef_std` = correlation with PTS, naive Fisher CI that ignores player clustering, one row per candidate incl. dropped ones, `kept_after_vif` says whether it survived steps 3), `ols_cluster`, `enet`, `mixedlm`, `gbm_shap`. A fit that was skipped for too few rows is `none`.")
    A("- Pregame models carry the input window in the name: `@l5` / `@l10` (mean of the last 5 / up to 10 prior games) and `@std` (this season's prior games), each also as `…+ppg` (the same inputs plus the player's prior average PTS for that window). **`@l10` (inputs only) is the pre-declared primary pregame spec**; the others are sensitivity runs.")
    A("- `coef_std`: change in PTS per +1 SD of the predictor (train-set mean/SD, after clipping at the train 0.5/99.5 percentiles); the target is raw points. `ci_low/ci_high`: 95% CI (OLS: player-cluster robust; MixedLM: model-based fixed-effect CI; elastic net has no CI, only survival = non-zero; boosting has none, only `shap_mean_abs` in PTS).")
    A("- `rank_in_cell`: rank by |`coef_std`| (|SHAP| for boosting) among the kept drivers; **null in thin cells**, for zeroed elastic-net drivers, and for boosting when it was not kept.")
    A("- `test_*`: score of the whole model on the held-out last-20%-of-dates rows (same value on each driver row of that model). `baseline_mae` = MAE of the naive baseline on the same test rows: the player's **prior season-to-date average PTS** (the game itself excluded). The baseline's R² / RMSE and its last-10 variant's MAE are in `notes` (`baseline_r2`, `baseline_rmse`, `baseline_l10_mae`).")
    A("- `n_games`, `n_players`: player-games and players in the cell (train + test) for that lens. `thin_flag` = fewer than 30 players or fewer than 300 player-games.\n")
    A("## 2. Data, coverage and gaps\n")
    A("Source: `player_game_box` (traditional) joined to `player_game_box_advanced` on (`game_id`, `player_id`). Regular season games only (game_id `002…`, includes NBA Cup group/knockout; the Cup final, play-in and playoffs are excluded, as in the app).\n")
    rows = [(r["season"], f"{r['games']:,}", f"{int(r['played_002']):,}", f"{int(r['with_advanced']):,}", int(r["missing_adv"]), f"{int(r['min_ge5']):,}") for r in m["coverage"]]
    A(md_table(rows, ["season", "games", "played player-games", "with advanced row", "missing advanced", "with ≥ 5 min"]))
    A("\n**Advanced coverage is complete for 2023-24 and 2024-25 (and 2025-26, 2026-27): 0 played player-games lack an advanced row, and every advanced field is 100% non-null.** No gaps found. "
      "Known quirks (kept as returned, see `docs/warehouse-box-scores.md`): `ast_to` is 0 when a player had 0 turnovers (so it is not used); ratings and pace are extreme below ~5 minutes.\n")
    A(f"Modelling rows: player-games with ≥ 5 minutes ({m['modelling_rows']:,}); advanced rates below 5 min are unreliable. The player's prior games for the rolling inputs are also ≥ 5-minute games. "
      f"A row is **eligible** (same rows for both lenses so baselines are comparable) when the player has ≥ 5 prior games overall and ≥ 3 prior games this season: **{m['eligible_rows']:,} rows**. "
      "Segment ranks (PPG) still use all minutes > 0 games exactly as in the home/away rerun.\n")
    A("**Candidate drivers and what happened to each**\n")
    A("Used as candidates (screened for every cell): minutes, FGA, FTA, 3PA, USG%, TS%, eFG%, pace, AST%, OREB%, DREB%, TOV%, def rating, off rating, net rating, PIE, and (pregame `+ppg` runs only) the prior average PTS.\n")
    A("Present in the warehouse but not used as separate candidates:\n")
    A(md_table(sorted(m["adv_not_used"].items()), ["advanced column", "reason"]))
    A("\nNot available in the warehouse (so not analysed): " + "; ".join(m["not_available"]) + ".\n")
    A("## 3. Method (playbook order)\n")
    st = m["stack"]
    A(f"1. **Stack**: free Python only: statsmodels {st['statsmodels']}, scikit-learn {st['scikit-learn']}, shap {st['shap']}, lightgbm {st['lightgbm']} (gradient boosting; chosen over scikit-learn's boosting for speed and native SHAP), pandas {st['pandas']}, duckdb {st['duckdb']}. statsmodels, scikit-learn, shap and lightgbm were not installed in `nba-phase1/.venv` and were pip-installed there.")
    A("2. **Correlation screen**: Pearson and Spearman of each candidate with PTS on the train rows. Screening only; never a finding on its own.")
    A(f"3. **Multicollinearity**: standardise (clip at train 0.5/99.5 percentiles, then z-score with train mean/SD). Pre-specified definition drops first (net rating = off − def exactly). In the explanatory lens PIE is dropped because the same-game PIE contains the player's own PTS by construction. "
      f"Then VIF on the train rows: while the largest VIF is > {m['rules']['vif_max']:g}, take that variable and the variables it is correlated with at |r| ≥ 0.6 and drop the lowest-priority one (priority, high to low: prior PPG, minutes, FGA, FTA, 3PA, TS%, USG%, pace, AST%, OREB%, DREB%, TOV%, eFG%, def rating, off rating, PIE, net rating: direct box counts before rates before composites). Every drop and reason is in the `notes` of the screen rows and in `data/manifests/points_drivers.json`.")
    A("4. **OLS** on the train rows with player-cluster robust standard errors and 95% CIs.")
    A("5. **Elastic net** (`ElasticNetCV`, l1_ratio 0.3/0.6/1.0, 40 alphas) with **time-ordered CV inside train** (up to 5 expanding date chunks; validation always later than fitting). Survivors = non-zero coefficients.")
    A("6. **MixedLM** (statsmodels), player random intercept, REML, fixed effects with 95% CIs. Test predictions = fixed effects + the player's intercept for players seen in train (prior information, since train precedes test).")
    A(f"7. **Gradient boosting + SHAP** (LightGBM, number of trees chosen by the same time-ordered CV; SHAP on ≤ 3,000 test rows). Kept only if it clearly beats the best linear model on test: **MAE lower by ≥ {m['rules']['gbm_rule'].split('>= ')[1].split(' ')[0]} with a player-cluster bootstrap 95% CI for the MAE gain above 0 and a higher R²**. Otherwise \"linear is enough\" (rows are still written, with `rank_in_cell` null and the verdict in `notes`).\n")
    A("**Split**: by date only. For each timespan the unique game dates are ordered; train = the earlier 80% of dates, test = the last 20% (cut-offs below). The same date cut is used for every segment of a timespan, and every segment is modelled separately.\n")
    rows = [(k, v["first"], v["last"], v["n_dates"], v["cutoff"], v["n_test_dates"]) for k, v in m["date_split"].items()]
    A(md_table(rows, ["timespan", "first date", "last date", "game dates", "test starts", "test dates"]))
    A("\n**Segments**: nested all / top100 / top50 / top25 / top10 by PPG within the timespan, with the app's games floors (" + ", ".join(f"{k}: {v}" for k, v in m["floors"].items()) + "; tiebreak PPG, games played, lower player_id), using `analysis_home_away_b2b.py`'s own functions.")
    A("- **Explanatory lens**: membership = the app's segments, ranked on the whole window. This uses PPG from the test dates too, so the player pool is selected partly on the outcome being modelled. Fine for describing how points are produced, but its test scores are not a forecast.")
    A("- **Pregame lens**: membership fixed *before* the test window: ranked on the **train rows only**, with the games floor scaled by the train share of player-games. No look-ahead. Players with no train games in the window are not in the cell. Segment sizes therefore differ slightly between the two lenses.\n")
    A("**Lenses**\n")
    A("- **Explanatory**: same-game box stats (minutes, FGA, FTA, 3PA, USG%, TS%, … of the same game). These describe how points are produced; they are **not** pregame predictors. Warning: PTS = 2 × TS% × (FGA + 0.44 × FTA) is an accounting identity, so TS%, FGA and FTA 'explain' points almost by construction, and a non-linear model recovers that product almost exactly (this is why boosting is kept in most explanatory cells). Read it as an accounting of where points come from, not as a finding about what to bet on.")
    A("- **Pregame**: every input is strictly prior. For each player, chronologically across seasons: `l5` = mean over the last 5 prior games, `l10` = mean over up to the last 10 prior games (≥ 5 are guaranteed), `std` = mean over this season's prior games (≥ 3). The game itself is excluded (checked on about 200 random player-games against a hand computation: 0 mismatches). "
      "Percentages come from totals: TS% = Σ PTS / (2 (Σ FGA + 0.44 Σ FTA)), eFG% = (Σ FGM + 0.5 Σ 3PM) / Σ FGA; USG%, pace, AST%, OREB%, DREB%, TOV%, PIE are minutes-weighted pooled, off/def rating possession-weighted pooled (never an unweighted average of per-game rates).\n")
    # ---- results
    A("## 4. Results, default cell (pooled_2023_26 × all)\n")
    d0 = mod[(mod.timespan == "pooled_2023_26") & (mod.segment == "all")]
    for lens, mdls, title in [("explanatory", ["ols_cluster", "mixedlm"], "Explanatory (same-game)"), ("pregame", ["ols_cluster@l10", "mixedlm@l10"], "Pregame (primary spec: inputs = prior last-10 means)")]:
        A(f"### {title}: standardised effects, PTS per +1 SD, 95% CI\n")
        x = d0[d0.lens == lens]
        o, mx, en = x[x.model == mdls[0]].set_index("driver"), x[x.model == mdls[1]].set_index("driver"), x[x.model == mdls[0].replace("ols_cluster", "enet")].set_index("driver")
        sh = x[x.model == mdls[0].replace("ols_cluster", "gbm_shap")].set_index("driver")
        order = list(o.sort_values("rank_in_cell").index)
        rows = [(int(o.loc[d].rank_in_cell), LBL[d], ci(o.loc[d]), int(mx.loc[d].rank_in_cell), ci(mx.loc[d]), f(en.loc[d].coef_std) + ("" if en.loc[d].coef_std != 0 else " (zeroed)"), f(sh.loc[d].shap_mean_abs, 3)) for d in order]
        A(md_table(rows, ["OLS rank", "driver", "OLS (cluster-robust)", "MixedLM rank", "MixedLM", "elastic net coef", "SHAP mean abs"]))
        A("")
        dr = [dd for dd in m["cells"] if dd["ts"] == "pooled_2023_26" and dd["seg"] == "all" and dd["lens"] == lens and (dd["window"] in (None, "l10"))][0]
        A("VIF / definition drops: " + "; ".join(f"**{LBL[d['driver']]}** ({d['reason']})" for d in dr["drops"]) + f". Max |r| among kept = {dr['max_corr_kept']:.2f}; max VIF after drops = {max(dr['vif_final'].values()):.1f}.")
        e = dr.get("enet", {})
        A(f"Elastic net: alpha {e['alpha']:.3g}, l1_ratio {e['l1_ratio']:g}, survivors {len(e['survivors'])}/{len(dr['kept'])}" + (f" ({', '.join(LBL[s] for s in e['survivors'])})." if len(e["survivors"]) < len(dr["kept"]) else " (all kept).") + f" MixedLM player-intercept variance {dr['mixedlm']['player_var']:.2f} vs residual {dr['mixedlm']['resid_var']:.2f}.\n")
    A("### Test-set fit, default cell (last 20% of dates; baseline = prior season-to-date average)\n")
    A("Explanatory models use same-game inputs, so comparing them with the prior-average baseline is not a like-for-like forecast comparison; the baseline is shown for reference only. The pregame rows are the fair comparison.\n")
    cd = cell[(cell.timespan == "pooled_2023_26") & (cell.segment == "all")]
    rows = []
    for lens in ("explanatory", "pregame"):
        x = cd[cd.lens == lens]
        b = x.iloc[0]
        rows.append((lens, "baseline: prior average", f(b.b_r2, 3), f(b.base, 3), f(b.b_rmse, 3), "–"))
        for r in x.sort_values(["model"]).itertuples():
            rows.append((lens, r.model, f(r.r2, 3), f(r.mae, 3), f(r.rmse, 3), f"{(r.base - r.mae) / r.base:+.1%}" if lens == "pregame" else "n/a (same-game inputs)"))
    A(md_table(rows, ["lens", "model", "test R²", "test MAE", "test RMSE", "MAE vs baseline"]))
    gk = mod[(mod.base_model == "gbm_shap") & (mod.timespan == "pooled_2023_26") & (mod.segment == "all")].groupby("model").notes.first()
    A("\nBoosting verdict, default cell: " + "; ".join(f"`{k}`: {'KEPT' if 'NOT kept' not in v else 'not kept (linear is enough)'}" for k, v in gk.items()) + ".\n")
    # ---- across cells
    A("## 5. Top drivers across segments and timespans\n")
    A("Ranked by |standardised OLS coefficient| (top 4). Thin cells are not ranked. Explanatory = OLS on same-game stats; pregame = OLS@l10 on prior last-10 means.\n")
    for lens, model in (("explanatory", "ols_cluster"), ("pregame", "ols_cluster@l10")):
        rows = []
        for ts in TS:
            row = [ts]
            for s in SG:
                d = mod[(mod.lens == lens) & (mod.model == model) & (mod.timespan == ts) & (mod.segment == s)]
                if d.empty: row.append("not fitted (too few rows)"); continue
                if d.thin_flag.iloc[0]: row.append("thin: not ranked"); continue
                row.append(", ".join(LBL[x] for x in d.sort_values("rank_in_cell").head(4).driver))
            rows.append(row)
        A(f"**{lens}** (`{model}`)\n")
        A(md_table(rows, ["timespan"] + SG))
        A("")
    A("Effect-size detail for the default timespan (pregame OLS@l10, PTS per +1 SD, 95% cluster-robust CI):\n")
    rows = []
    for s in SG:
        d = mod[(mod.lens == "pregame") & (mod.model == "ols_cluster@l10") & (mod.timespan == "pooled_2023_26") & (mod.segment == s)]
        thin = d.thin_flag.iloc[0]
        g = {r.driver: r for r in d.itertuples()}
        rows.append((s + (" (thin)" if thin else ""), d.n_players.iloc[0], f"{int(d.n_games.iloc[0]):,}") + tuple(ci(g[k]) if k in g else "dropped" for k in ("fga", "fta", "ts_pct", "min")))
    A(md_table(rows, ["segment", "players", "player-games", "FGA", "FTA", "TS%", "minutes"]))
    A("\nSame for the explanatory lens (OLS, same-game stats):\n")
    rows = []
    for s in SG:
        d = mod[(mod.lens == "explanatory") & (mod.model == "ols_cluster") & (mod.timespan == "pooled_2023_26") & (mod.segment == s)]
        g = {r.driver: r for r in d.itertuples()}
        rows.append((s + (" (thin)" if d.thin_flag.iloc[0] else ""),) + tuple(ci(g[k]) if k in g else "dropped" for k in ("fga", "ts_pct", "fta", "min")))
    A(md_table(rows, ["segment", "FGA", "TS%", "FTA", "minutes"]))
    # ---- fit across cells
    A("\n## 6. Fit versus the prior-average baseline, every cell\n")
    A("Test MAE (points). Baseline = prior season-to-date average on the same test rows. `best lin` = the best of OLS / elastic net / MixedLM on MAE. Pregame uses the primary spec `@l10`. `*` = thin cell.\n")
    for lens, suffix in (("explanatory", ""), ("pregame", "@l10")):
        rows = []
        for ts in TS:
            for s in SG:
                x = cell[(cell.lens == lens) & (cell.timespan == ts) & (cell.segment == s)]
                if x.empty or x.base.isna().all():
                    rows.append((ts, s, "not fitted", "", "", "", "", "", "")); continue
                g = {r.model: r for r in x.itertuples()}
                lin = [g[k + suffix] for k in ("ols_cluster", "enet", "mixedlm") if k + suffix in g]
                best = min(lin, key=lambda r: r.mae)
                gb = g.get("gbm_shap" + suffix)
                gkept = mod[(mod.lens == lens) & (mod.model == "gbm_shap" + suffix) & (mod.timespan == ts) & (mod.segment == s)].notes.iloc[0]
                rows.append((ts, s + ("*" if x.thin.iloc[0] else ""), f"{int(x.n_players.iloc[0])} / {int(x.n_games.iloc[0]):,}", f(x.base.iloc[0], 3), f"{f(best.mae, 3)} ({best.model.split('@')[0]})", f"{f(best.r2, 3)} vs {f(x.b_r2.iloc[0], 3)}",
                             (f"{(x.base.iloc[0] - best.mae) / x.base.iloc[0]:+.1%}" if lens == "pregame" else "n/a"), f"{f(gb.mae, 3)}" if gb is not None else "n/a", "kept" if gb is not None and "NOT kept" not in gkept else "no"))
        A(f"**{lens}**" + (" (pregame `@l10`)" if suffix else "") + "\n")
        A(md_table(rows, ["timespan", "segment", "players / games", "baseline MAE", "best linear MAE", "R² (best vs baseline)", "MAE vs baseline", "boosting MAE", "boosting kept"]))
        A("")
    # pregame verdict counts
    pg = cell[(cell.lens == "pregame") & (cell.model.str.endswith("@l10")) & ~cell.thin & cell.base.notna()]
    cnt = {}
    for k in ("ols_cluster", "enet", "mixedlm", "gbm_shap"):
        x = pg[pg.model == k + "@l10"]
        cnt[k] = (int((x.mae < x.base).sum()), int((x.rmse < x.b_rmse).sum()), len(x))
    A("**Pregame verdict (non-thin cells, `@l10`):** number of cells where the model beats the prior-average baseline, on MAE / on RMSE: " + "; ".join(f"{k}: {v[0]}/{v[2]} (MAE), {v[1]}/{v[2]} (RMSE)" for k, v in cnt.items()) + ".")
    ok = pg.groupby(["timespan", "segment"]).apply(lambda x: (x.mae.min() < x.base.iloc[0]), include_groups=False)
    A(f" Best of the four models beats the baseline MAE in {int(ok.sum())} of {len(ok)} non-thin cells.\n")
    bw = cell[(cell.lens == "pregame") & (cell.timespan == "pooled_2023_26") & (cell.segment == "all")].copy()
    bw["dmae"] = (bw.base - bw.mae) / bw.base
    A("Pregame window sensitivity, default cell (MAE improvement vs baseline; positive = better than the prior average):\n")
    rows = []
    for w in ("l5", "l5+ppg", "l10", "l10+ppg", "std", "std+ppg"):
        x = bw[bw.model.str.endswith("@" + w)]
        rows.append((w,) + tuple(f"{f(x[x.model == k + '@' + w].mae.iloc[0], 3)} ({x[x.model == k + '@' + w].dmae.iloc[0]:+.1%})" for k in ("ols_cluster", "enet", "mixedlm", "gbm_shap")))
    A(md_table(rows, ["window", "OLS", "elastic net", "MixedLM", "boosting"]))
    A("")
    # ---- thin cells
    th = df[df.thin_flag].groupby(["lens", "timespan", "segment"]).agg(n_players=("n_players", "first"), n_games=("n_games", "first"), fitted=("model", lambda s: not (s == "none").all())).reset_index()
    A("## 7. Thin cells (fewer than 30 players or fewer than 300 player-games): no driver ranking\n")
    A(md_table([(r.lens, r.timespan, r.segment, r.n_players, f"{int(r.n_games):,}", "fitted, unranked" if r.fitted else "NOT fitted (too few rows)") for r in th.itertuples()], ["lens", "timespan", "segment", "players", "player-games", "status"]))
    A("\nAll top25 and top10 cells are thin by the 30-player rule (they have 25 and 10 players), whatever the timespan. The coefficients and test scores of those cells are still in the table for completeness, but should not be read as rankings. "
      "2026-27 top10 is not fitted at all (62 player-games).\n")
    # ---- reads
    A("## 8. Plain-English read\n")
    ex = mod[(mod.lens == "explanatory") & (mod.model == "ols_cluster") & (mod.timespan == "pooled_2023_26")]
    pgm = mod[(mod.lens == "pregame") & (mod.model == "ols_cluster@l10") & (mod.timespan == "pooled_2023_26")]
    pgp = mod[(mod.lens == "pregame") & (mod.model == "ols_cluster@l10+ppg") & (mod.timespan == "pooled_2023_26") & (mod.segment == "all")]
    def eff(d, drv):
        r = d[d.driver == drv]
        return f"{r.coef_std.iloc[0]:+.2f} [{r.ci_low.iloc[0]:+.2f}, {r.ci_high.iloc[0]:+.2f}]" if len(r) else "dropped"
    A("**Explanatory lens (how points are produced; same-game).** In every non-thin cell the same three same-game measures carry most of the association with PTS: FGA, TS% and FTA, with minutes, 3PA and off rating a distant second tier. "
      f"Default cell (OLS, PTS per +1 SD, 95% CI): FGA {eff(ex[ex.segment=='all'], 'fga')}, TS% {eff(ex[ex.segment=='all'], 'ts_pct')}, FTA {eff(ex[ex.segment=='all'], 'fta')}. "
      f"Minutes has a small *negative* coefficient ({eff(ex[ex.segment=='all'], 'min')}) once FGA and FTA are in the model: minutes matter through the shots taken. USG% was dropped by VIF (it is a function of FGA, FTA, TOV and minutes). "
      "Pace, AST%, DREB%, def rating are near zero. Because PTS = 2·TS%·(FGA + 0.44·FTA), this lens reads like an accounting identity: high R² (OLS ≈ 0.92, boosting ≈ 0.998 in the default cell) tells us the stats add up to the points, not what to expect next game. "
      "The picture is stable across the 4 single seasons and the 2 pools; section 5 lists the ordering per cell.\n")
    A("**Pregame lens, per segment (default timespan pooled_2023_26; OLS@l10 drivers with 95% CI; test MAE vs the prior-average baseline):**\n")
    for s in SG:
        d = pgm[pgm.segment == s]
        thin = d.thin_flag.iloc[0]
        x = cell[(cell.lens == "pregame") & (cell.timespan == "pooled_2023_26") & (cell.segment == s) & (cell.model.str.endswith("@l10"))]
        bm = x.base.iloc[0]
        g = x.set_index("model")
        if thin:
            A(f"- **{s} (thin: {int(d.n_players.iloc[0])} players, {int(d.n_games.iloc[0]):,} player-games).** Not ranked. Pregame test MAE: baseline {bm:.2f}, OLS {g.loc['ols_cluster@l10'].mae:.2f}, MixedLM {g.loc['mixedlm@l10'].mae:.2f}; "
              f"test R² OLS {g.loc['ols_cluster@l10'].r2:.2f} vs baseline {g.loc['ols_cluster@l10'].b_r2:.2f}. Treat as unreliable.")
        else:
            top = d.sort_values("rank_in_cell").head(3)
            A(f"- **{s} ({int(d.n_players.iloc[0])} players, {int(d.n_games.iloc[0]):,} player-games).** Pregame OLS@l10 top drivers: " + ", ".join(f"{LBL[r.driver]} {r.coef_std:+.2f} [{r.ci_low:+.2f}, {r.ci_high:+.2f}]" for r in top.itertuples()) +
              f". Test MAE: baseline {bm:.3f}, OLS {g.loc['ols_cluster@l10'].mae:.3f}, MixedLM {g.loc['mixedlm@l10'].mae:.3f}, boosting {g.loc['gbm_shap@l10'].mae:.3f}.")
    A("\n**Pregame lens (what prior form predicts; the one relevant for points props).** Prior volume (FGA and FTA over the last 10 games) is by far the strongest pregame signal; efficiency and the other rates are weak by comparison, and rate stats such as pace, def rating and PIE carry intervals that include 0 in the default cell. "
      f"Default cell (pregame OLS@l10): FGA {eff(pgm[pgm.segment=='all'], 'fga')}, FTA {eff(pgm[pgm.segment=='all'], 'fta')}, TS% {eff(pgm[pgm.segment=='all'], 'ts_pct')}, minutes {eff(pgm[pgm.segment=='all'], 'min')}. "
      f"When the prior average PTS is added (`+ppg`), it absorbs FGA, FTA and 3PA by VIF (they are near-duplicates of it); prior PPG then has {eff(pgp, 'pts')}.\n")
    d = cell[(cell.lens == "pregame") & (cell.timespan == "pooled_2023_26") & (cell.segment == "all") & (cell.model.isin(["ols_cluster@l10", "mixedlm@l10"]))].set_index("model")
    A(f"**How much better than 'the player's prior average'?** Not much. In the default cell the test MAE is {d.loc['ols_cluster@l10'].base:.3f} for the baseline against {d.loc['ols_cluster@l10'].mae:.3f} (OLS) and {d.loc['mixedlm@l10'].mae:.3f} (MixedLM), "
      f"i.e. {(d.loc['ols_cluster@l10'].base - d.loc['ols_cluster@l10'].mae) / d.loc['ols_cluster@l10'].base:.1%} and {(d.loc['mixedlm@l10'].base - d.loc['mixedlm@l10'].mae) / d.loc['mixedlm@l10'].base:.1%} lower; R² {d.loc['ols_cluster@l10'].r2:.3f} / {d.loc['mixedlm@l10'].r2:.3f} vs {d.loc['ols_cluster@l10'].b_r2:.3f}. "
      "In the high-scorer segments the linear models do **not** reliably beat the prior average on MAE (see section 6), and in the thin top-scorer cells they are usually worse. Per-game scoring is mostly noise around a player's level (residual SD ≈ 6 points), and the rolling box inputs do not remove it. "
      "Boosting was **not** kept in any pregame cell (it never clearly beats the best linear model), so for pregame \"linear is enough\"; it was kept in most explanatory cells only because of the TS%·(FGA+0.44·FTA) identity.\n")
    # gbm kept explanatory list
    gk = mod[(mod.lens == "explanatory") & (mod.base_model == "gbm_shap")].groupby(["timespan", "segment"]).notes.first()
    kept = [f"{a}×{b}" for (a, b), v in gk.items() if "NOT kept" not in v]
    notk = [f"{a}×{b}" for (a, b), v in gk.items() if "NOT kept" in v]
    A(f"Boosting kept (explanatory): {len(kept)} of {len(gk)} fitted cells; not kept: {', '.join(notk) if notk else 'none'}. Pregame: kept in {len([1 for _, v in mod[(mod.lens == 'pregame') & (mod.base_model == 'gbm_shap')].groupby(['model', 'timespan', 'segment']).notes.first().items() if 'NOT kept' not in v])} of {len(mod[(mod.lens == 'pregame') & (mod.base_model == 'gbm_shap')].groupby(['model', 'timespan', 'segment']))} pregame cell-specs.\n")
    A("## 9. Limitations\n")
    for t in [
        "Associations, not causes; collinear box variables (FGA, FTA, minutes, USG%, prior PPG) share signal, so individual coefficients depend on which near-duplicates the VIF step dropped (logged).",
        "Explanatory lens is an accounting identity plus context (PTS = 2·TS%·(FGA + 0.44·FTA)); its high R² is not forecast skill. Its segment membership uses the full window's PPG (selection on the outcome).",
        "Pregame lens uses only prior box rolling inputs. It has no opponent, home/rest, injury, lineup, minutes-expectation or betting-line information (not in the warehouse), which are exactly what move a real points prop. Minutes are the prior-games average, not the expected minutes for tonight.",
        "The baseline is season-to-date prior average PTS (≥ 3 games), the pre-declared 'player's prior average'. A last-10 average is a slightly different baseline; its test MAE is in `notes` (`baseline_l10_mae`).",
        "Rows require ≥ 5 minutes, ≥ 5 prior games overall and ≥ 3 prior games this season: early-season games, rookies' first games and garbage-time cameos are excluded. Players with no train games in a window are not in its pregame cell.",
        "One time split per cell (last ~20% of game dates) gives one test score per model; differences of a few hundredths of a point are within noise (the player-cluster bootstrap is used only for the boosting decision). 2026-27 has 15 game dates, test = 3 dates (provisional, small).",
        "OLS CIs are player-cluster robust; the MixedLM CIs are model-based, and are narrower. The MixedLM test prediction uses the train-period player intercept, which is legitimate prior information but gives it an advantage over plain OLS. Elastic net and boosting have no interval for the effects.",
        "Winsorising the predictors at the train 0.5/99.5 percentiles trims the extreme advanced-rate values (ratings, pace) that the source returns for short stints.",
        "Players' minutes-weighted pooled rates for USG%, pace, AST%, OREB%, DREB%, TOV%, PIE are approximations of the exact pooled rate (they are not rebuilt from team totals)."]:
        A("- " + t)
    Path(a.out).write_text("\n".join(L) + "\n")
    print("wrote", a.out, len(L), "blocks")


if __name__ == "__main__":
    main()
