# Points at home vs away, and on back-to-backs

*Data through 2026-11-09: full 2023-24, 2024-25 and 2025-26 regular seasons plus 2026-27 to date (154 games).*
*Numbers for charts: `data/insights_home_away_b2b.json` (league) and `data/insights_player_splits.json` + `public/splits/<player_id>.json` (players). Scripts: `/workspace/nba-phase1/scripts/analysis_home_away_b2b.py` and `analysis_player_splits.py`. Deterministic: bootstrap seed 20261104; two runs gave byte-identical league output.*
*This version replaces the 2-season (2025-26 + 2026-27) analysis. Scorer tiers are replaced by nested PPG segments (below).*

## The short version

- **Home vs away makes almost no difference to points, in any season.**
  - Pooled 2023-24 to 2025-26 (default view): **+0.09 pts** at home, 95% CI −0.00 to +0.18, p = 0.046, 726 players / 1,561 player-seasons. Minutes −0.11, points per 36 +0.15. Not a robust edge: it is borderline p, tiny, and the per-season estimates (+0.06, +0.14, +0.08) are all inside their own CIs of zero.
  - Adding 2026-27 to date: +0.09 (CI −0.01 to +0.19, p = 0.086). The earlier 2-season result (+0.08 for 2025-26) is unchanged: +0.08, CI −0.08 to +0.23.
- **Second night of a back-to-back: slightly more points, entirely because of more minutes.**
  - Pooled 2023-26: **+0.28 pts** (CI +0.16 to +0.41, p < 0.001), minutes **+0.70**, points per 36 **−0.03**. Every season is positive: +0.23 (2023-24), +0.21 (2024-25), +0.40 (2025-26, same as before).
  - The gain sits with role players and young players. Rookies +0.62 pts / +1.32 min; guards +0.42 / +0.83; centers −0.03.
  - **Top scorers do not gain.** Top 100 by PPG: −0.12 pts (CI −0.42 to +0.18), minutes −0.19; top 10: +0.47 (CI −0.43 to +1.22), minutes −0.31. The earlier "top 10 play 1.33 fewer minutes in 2025-26" is real in that season (still −1.33) but is not stable across seasons (−0.66 in 2023-24, +0.31 in 2024-25), so treat it as "stars are not helped", not as a fixed effect.
- **First night of a back-to-back is close to a normal game:** +0.05 pts pooled (CI −0.07 to +0.16), minutes +0.09.
- **2026-27 is still too small for back-to-backs** (37 and 39 qualifying players; teams have played ≈1 back-to-back each). Home/away: +0.07 (CI −0.35 to +0.48, 302 players), consistent with zero.
- **Per player:** individual splits are mostly noise. τ (true between-player spread, DerSimonian–Laird): home/away 0.18–0.36 pts per season, 0.26 pooled; second night 0.06–0.54 (0.42 pooled), first night 0.00 in every span except 2026-27 (too few players). **No player is "strong" (BH FDR 10%) in any timespan or comparison, among all league players or app players.** Among all qualifying league players, 0-10 per comparison per timespan cross |z| ≥ 2.5 (2-10 in full seasons and pooled spans; chance alone gives about 1.2%, i.e. ≈ 6 of ~500). The app-player 'watch' list has 62 entries across the 5 non-current timespans (the same players recur across overlapping spans). Earlier 2-season result: no strong flags, 21 watch; unchanged in kind.

### What changed vs the earlier 2-season results

| | earlier (2025-26, 2026-27 to Nov 2) | now |
|---|---|---|
| Home vs away, league | +0.08 (2025-26), null | +0.08 (2025-26, unchanged); +0.06 / +0.14 in 2023-24 / 2024-25; pooled +0.09 (borderline p = 0.046), null in practice |
| 2nd night | +0.40, minutes-driven | +0.40 (2025-26); +0.23, +0.21 in the earlier seasons; pooled +0.28, minutes +0.70, per-36 flat. Same story, a bit smaller |
| τ home/away | ≈ 0.31 | 0.31 in 2025-26 (unchanged); 0.36, 0.18 in 2023-24, 2024-25; 0.26 pooled |
| Strong flags | none | none |
| Watch flags | 21 (2025-26 + combined) | 10 / 12 / 13 per single season, 15 (pooled 2023-26), 12 (pooled 2023-27) |
| Scorer tiers | top 10 / 11-25 / 26-50 / 51-100 / rest | replaced by nested top100 ⊃ top50 ⊃ top25 ⊃ top10 and all |
| "combined" | 2025-26 + 2026-27 | now means 2023-24..2025-26 (`pooled_2023_26`) |

## Timespans and segments (spec)

**Six timespans.** `pooled_2023_27` (all four seasons through 2026-11-09), `pooled_2023_26` (three complete seasons, **the default**), `2023_24`, `2024_25`, `2025_26`, `2026_27` (to date, through 2026-11-09).

**Default view = `pooled_2023_26` / `all`** (the old "combined" meaning shifts to three seasons; use the legacy aliases below to read the old keys).

**Five nested segments**, ranked by **PPG within each timespan** (points per game over every game the player played in the timespan; a 0-minute game does not count):

| segment | members |
|---|---|
| `all` | every player with games in the timespan (no floor); the comparison itself needs ≥ 3 games per side |
| `top100` | the 100 highest PPG among players meeting the floor |
| `top50` ⊂ top100, `top25` ⊂ top50, `top10` ⊂ top25 | the top 50 / 25 / 10 of the same ranking |

- **Minimum-games floor to be ranked** (the same ~24% of an 82-game season everywhere): 20 GP per full season (`2023_24`, `2024_25`, `2025_26`), 40 for `pooled_2023_26`, 50 for `pooled_2023_27`, and for `2026_27` ceil(20/82 × median team games played so far) = **3** at 2026-11-09. The 2026-27 floor is provisional and rises with the schedule; the old 2026-27 floor was 4.
- **Tiebreak:** PPG (descending), then games played (descending), then lower player_id. Members of the pooled segments are chosen by the player's pooled PPG over the whole span.
- **Pooled spans use player-season units:** a player contributes one paired difference per season with ≥ 3 games per side, the CI is a **cluster bootstrap by player** (resampling players, keeping a player's seasons together), 10,000 resamples, seed 20261104. Segment membership for a unit comes from the pooled rank. Per-player files (below) instead pool a player's games across the span.
- **Segment sizes at the default:** all 802 players with games, 562 meeting the 40-GP floor; top100 PPG ≥ 14.83, top50 ≥ 19.49, top25 ≥ 22.87, top10 ≥ 26.34. Segments with n = 1–2 units (2026-27 back-to-backs) have no CI (null).
- **Secondary cuts (only descriptive, not nested):** position (G / F / C), age bucket (≤23, 24-27, 28-31, 32+), experience bucket (rookie, 1-3, 4-7, 8+). Position and age are complete in every season (0 missing). Experience is missing for 50 players (569 player-games) in 2023-24, 41 (466) in 2024-25, 57 (681) in 2025-26 and 0 in 2026-27: they were on no official roster for that season and the NBA player endpoint only gives current experience. They stay in the overall numbers and drop out of experience cuts. Nothing was estimated.

## How it was measured

- **Games.** Regular season only (game ids starting 002). NBA Cup group and knockout games count. The Cup final (006), play-in and playoffs are excluded. A game counts only if the player logged more than 0 minutes.
- **Paired, per player.** For each player (or player-season), the average in condition A minus the average in B; the summary is the mean and median of those differences. ≥ 3 games per side. p = paired t-test; 95% CI = percentile bootstrap (10,000).
- **Three measures.** Points per game; minutes per game; points per 36 = 36 × total points ÷ total minutes within each condition. Points moving while per-36 does not means the change is about minutes.
- **Home / away.** "vs." = home, "@" = away. **Neutral-site games are excluded from home/away only** (flagged by the NBA box-score summary): 2023-24 none, 2024-25 six, 2025-26 five, 2026-27 one (0022600189). Three 2025-26 games (0022500259-261, 2025-11-19) have no box-score summary in the source, so their neutral flag is unknown; the schedule marks them non-neutral and they are treated as regular home/away.
- **Back-to-back labels** from the player's team schedule dates (including the Cup final): *2nd night* = team played the day before; *1st night* = team plays the next day and did not play the day before; *rested* = ≥ 1 day off and no game next day. Season openers are excluded. No three-in-three-nights stretches exist in the data. Team-game counts (2nd night / 1st night / rested): 2023-24 422 / 422 / 1,586; 2024-25 450 / 450 / 1,530; 2025-26 441 / 441 / 1,548; 2026-27 51 / 52 / 175.
- **Position** first-listed position on that season's official roster (G-F → G, F-C → F, C-F → C), PlayerIndex fallback for players not on the roster; **age** on Feb 1 of the season; **experience** the roster's years of experience with rookies = 0.

## Caveats

- 2026-27 is a tiny sample (about 12-13 games per team). Its floor is 3 games and most 2026-27 back-to-back segment cells have n ≤ 15.
- Observational: rest is not assigned at random and players held out do not appear.
- Multiple comparisons: the JSON holds many hundred comparisons. Only 'strong' flags survive an FDR correction, and there are none. 'watch' (|z| ≥ 2.5, nominal) flags are leads, not findings. Segment cells at n < 30 units have wide CIs.
- Pooled and 2026-27-inclusive spans reuse the same players across seasons; do not treat season rows and pooled rows as independent evidence.
- Segment membership depends on that span's PPG, so a player can be top 25 in one season and unranked in another.

## `data/insights_home_away_b2b.json` schema (`insights-home-away-b2b-v2`)

Strict JSON (no NaN/Infinity; undefined values are `null`). Numbers rounded to 4 decimals.

- `schema_version`, `data_as_of` ({season: "full regular season" | date}), `default` = `{timespan: "pooled_2023_26", segment: "all"}`.
- `timespans` (ordered list of the 6 ids), `segments` (`["all","top100","top50","top25","top10"]`), `comparisons` (`["home_away","b2b_second_vs_rested","b2b_first_vs_rested"]`; in `results` the keys are `home_away`, `b2b_2nd` (= 2nd night minus rested), `b2b_1st` (= 1st night minus rested)).
- `timespan_info[ts]` = `{label, seasons, pooled, min_games_floor, n_players_with_games, n_ranked, data_as_of}`. `segment_info[seg]` = text.
- **`results[ts][seg]`** = `{segment_size, ppg_floor_min_games, ppg_rank_max, n_ranked, ppg_range:[min,max] (null for all), home_away, b2b_2nd, b2b_1st}`. Each comparison block = `{n_players, n_units, games_a, games_b, pts:{mean, median, ci95:[lo,hi], p, mean_a, mean_b}, minutes:{…same…}, per36:{…same…}, small_n}`; the block is `null` when no unit qualifies; `ci95`/`p` are `null` when there are fewer than 2 units.
- **`secondary[ts][position|age|experience][level]`** = `{home_away, b2b_2nd, b2b_1st}` with the same block shape; `_missing_units_home_away` records the missing-attribute counts.
- `segment_missing[season][position|age|experience]` = `{players, player_games, names}`; `segment_sources_player_seasons`; `team_game_counts_by_rest`; `three_in_three_nights`; `neutral_games_excluded_from_home_away[season]` (game ids); `sources` (inputs and hashes); `definitions`; `caveats`; `metric_note`.
- **Backward compatibility (hybrid `results`).** The unchanged app reads `results[<comparison>].by_scope[<scope>]`, so `results` holds BOTH shapes side by side (keys cannot collide):
  - old shape: `results.home_away | b2b_second_vs_rested | b2b_first_vs_rested` = `{label, a, b, by_scope}`, `by_scope["2025-26" | "2026-27" | "combined"]` = `{overall, segments:{position, age, experience, scorer_tier}}`. Scopes are aliases: `legacy_scope_alias` = `{"2025-26":"2025_26","2026-27":"2026_27","combined":"pooled_2023_26"}` (so `combined` now means three seasons, 2023-24..2025-26, not 2025-27).
  - new shape: `results[<timespan>][<segment>]` as above.
  - **Deprecated shim:** `segments.scorer_tier` (levels `top_10, 11_25, 26_50, 51_100, rest`, by the unit's own-season PPG rank; floor = that season's floor, 3 games for 2026-27 instead of the old 4) is kept only so the unchanged app keeps rendering. The nested `top100/top50/top25/top10` segments replace it. The same shim lives in `secondary[ts].scorer_tier` for `2025_26`, `2026_27`, `pooled_2023_26` only. App Builder should move to `results[ts][seg]` and drop `scorer_tier`.

## `data/insights_player_splits.json` (`insights-player-splits-v2`) and `public/splits/<player_id>.json` (`player-splits-v2`)

- 526 per-player files (one per player in `data/betting_points.json`, 15.4 MB total, 9.5-51 KB each: each holds every game since 2023-24). Committed (not generated at build time).
- **Scope keys are the six timespan ids** and also, as aliases to the same objects, the legacy `2025-26`, `2026-27`, `combined` (= `pooled_2023_26`). A player's numbers in a timespan pool his games across the span; `null` when he has no games in it.
- **Per-player file:** `{schema_version, player_id, full_name, team, data_as_of, timespans, default_timespan, seasons[ts], league[ts], game_fields, games}`.
  - `seasons[ts] = {conditions, comparisons, segment}`. `conditions[home|away|b2b_2nd|b2b_1st|rested] = {n, pts, pts_sd, min, per36}` (unchanged). `comparisons[cmp]` unchanged (`qualifies`, `n_a`, `n_b`, `pts:{raw, shrunk, shrink_weight, se, ci95, z, p, q, percentile, flag}`, `minutes`, `per36`).
  - **New `segment`** = `{gp, ppg, ppg_rank, meets_floor, min_games_floor, segments:[ids the player belongs to, always incl. "all"], segment_league:{seg:{cmp:{n_players, pts_mean, pts_median, min_mean, per36_mean}}}}`. `ppg_rank` is null below the floor. `segment_league` is the league baseline (mean raw difference of qualifying players) for each of the player's segments, to compare him against his peers.
  - `league[ts] = {comparisons, conditions, timespan}` (whole league, as before; `comparisons[cmp]` gains no breaking keys).
  - `games` rows (`game_fields` = season, date, game_id, opp, venue, rest, pts, min) now cover all four seasons; `season` is the first field, so filter by it for a timespan.
- **Homepage file:** `{schema_version, data_as_of, default, timespans, segments, definitions, ranking_note, ranking_population, league, rankings, heatmaps, distributions, flagged, players_table, caveats, sources}`.
  - `league[ts] = {comparisons, conditions, by_segment, timespan}`. `comparisons[cmp]` = `{n_players, pts_mean, pts_median, tau, min_mean, per36_mean, n_strong_all_players, n_watch_all_players}` (new last two: flags among all league players). **New `by_segment[seg][cmp]`** = `{n_players, pts_mean, pts_median, min_mean, per36_mean}`.
  - `rankings[cmp][ts]`, `distributions[cmp][ts]`: unchanged shape (top/bottom 25 by shrunk and raw, histograms); keyed by timespan (+ legacy aliases). `shrunk_is_flat` is true when τ < 0.1.
  - `heatmaps.segment_x_condition[ts]` keys: `scorer_segment` (new, rows = the 5 nested segments; **replaces `scorer_tier`**), `position`, `age`, `experience`, plus the deprecated shim `scorer_tier` for `2025_26`, `2026_27`, `pooled_2023_26` only (old levels, kept so the unchanged app renders) (same layout: `rows, cond_cols, pts, n, cmp_cols, cmp_pts_mean, cmp_n`). `heatmaps.player_x_condition[ts]` unchanged.
  - **New `players_table[ts]`** = `{columns, rows, segment_max_rank:{top100:100,…}, note}`: one row per app player with games (`player_id, full_name, team, gp, ppg, ppg_rank`, then per comparison `_raw, _shrunk, _z, _flag, _n_a, _n_b`). Segment membership = `ppg_rank <= N`.
  - `flagged` entries carry `scope` = timespan id only (no legacy-alias duplicates); sorted by scope, comparison, |z|.
- **Per-player definitions** (unchanged): raw = mean A − mean B; se = player's SD over all his games in the span × √(1/n_a + 1/n_b); ci95 = raw ± t(0.975, df = games − 1) × se; shrunk = league + w × (raw − league), w = τ²/(τ²+se²), τ² from DerSimonian–Laird per timespan and comparison; z = (raw − league)/se; q = Benjamini–Hochberg across qualifying players (same span and comparison); flag `…_strong` for q < 0.10, `…_watch` for |z| ≥ 2.5, else null; minutes/per-36 raw only.

## Sources

- **Game logs:** NBA PlayerGameLogs (curated warehouse `player_game_logs`), 2023-24 to 2026-27.
- **Neutral-site flag and box scores:** NBA BoxScoreSummaryV3 / BoxScoreTraditionalV3 (curated `game_meta`, `player_game_box` in the warehouse).
- **Rosters / ages / experience:** official team rosters (CommonTeamRoster) for each season, PlayerIndex and CommonPlayerInfo for gaps (pulled 2026-11-10).
- **Schedule:** ScheduleLeagueV2 for each season.
- Hashes of every input are listed in the JSON under `sources.inputs`.
