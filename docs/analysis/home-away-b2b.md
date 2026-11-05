# Points at home vs away, and on back-to-backs

*Data through 2026-11-02. It covers the full 2025-26 regular season and 2026-27 to date, including the official points/minutes corrections in 88a2676.*
*Numbers for charts are in `data/insights_home_away_b2b.json`. Script: `/workspace/nba-phase1/scripts/analysis_home_away_b2b.py`. It is deterministic: bootstrap seed 20261104, and two runs gave byte-identical output.*

## The short version

- **Home vs away makes almost no difference to points.** The typical player scores about the same at home as on the road.
  - 2025-26: **+0.08 pts** at home (median +0.17), 95% CI −0.08 to +0.23, p = 0.35, from 522 players.
  - Minutes and points per 36 are flat too.
  - No position, age, experience or scorer tier shows a home edge that holds up across seasons.
- **On the second night of a back-to-back, players score slightly *more*, not less.** That is because they play more minutes, not because they score more efficiently.
  - 2025-26: **+0.40 pts** vs rested games (median +0.44), CI +0.20 to +0.60, p < 0.001, from 489 players.
  - Minutes rise **+0.84** (CI +0.58 to +1.08). Points per 36 are unchanged (+0.01, CI −0.32 to +0.34).
  - The gain sits almost entirely with **role players** (players ranked outside the top 100 scorers): **+0.51 pts** and **+1.13 min**, p < 0.001.
  - The **top 10 scorers** play **1.33 fewer minutes** on second nights (CI −2.19 to −0.49) while their points stay level (+0.24, CI −1.88 to +2.31).
  - The likely reason is that teams sit or limit stars on back-to-backs and the minutes go to the bench. Players who sit out entirely aren't in the data at all.
- **The first night of a back-to-back is close to a normal game for points.**
  - 2025-26: **+0.14 pts** (CI −0.07 to +0.34, p = 0.19), with minutes up **+0.51** (CI +0.25 to +0.78).
  - Guards are slightly up: +0.43 pts, CI +0.13 to +0.72.
  - The top 10 scorers lean lower (−1.30 pts), but with only 10 players the CI (−3.17 to +0.57) is wide.
- **2026-27 is too small to say anything yet.**
  - Home vs away (192 players, about 3–4 games per side): −0.13 pts, CI −0.76 to +0.49.
  - No player has 3+ back-to-back games yet, so both back-to-back comparisons have **n = 0** this season. Teams have played only about 1 back-to-back each.

## How it was measured

- **Games.** Regular season only (game IDs starting 002).
  - NBA Cup group and knockout games count. The Cup final (006), playoffs and play-in are excluded.
  - Only games where the player logged more than 0 minutes; a 0-minute game counts as not played.
- **Paired, per player.** For each player I took their average in condition A and in condition B, then the difference (A minus B). The summary is the mean and median of those differences across players, not a pooled average of all games.
  - A player needs **at least 3 games on each side** to be included.
  - p-values are from a paired (one-sample) t-test against 0.
  - 95% CIs are from a percentile bootstrap with 10,000 resamples.
- **Three measures.**
  - Points per game.
  - Minutes per game.
  - Points per 36 minutes, computed as 36 × total points ÷ total minutes within each condition.
  - If points move but points per 36 don't, the change is about minutes.
- **Home / away.** Home is "vs." in the matchup, away is "@".
  - The 5 neutral-site games in 2025-26 are left out: Mexico City, Berlin, London and the two Cup semifinals in Las Vegas, as flagged by the NBA box-score summary.
  - 2026-27 has had no neutral-site games yet.
- **Back-to-back labels** come from the dates of the team the player played for.
  - *2nd night:* the team played the day before.
  - *1st night:* the team plays the next day and did not play the day before.
  - *Rested:* at least one day off before the game and no game the next day. Each team's season opener is left out.
  - There were no three-games-in-three-nights stretches.
  - The 2025-26 Cup final is counted as a played date, though it had no games on the days either side, so it changed no labels.
  - For 2026-27, the full official schedule is used, so a game on the cutoff night knows whether the team plays the next day.
- **Team-game counts.**
  - 2025-26: 441 second nights, 441 first nights and 1,548 rested games.
  - 2026-27 to date: 38, 38 and 108.
- **Combined (both seasons).** Each player-season counts as one unit, so a player can appear twice, each time with that season's segment.
  - The CI resamples players, so a player's two seasons stay together.
  - 2026-27 only adds home/away units; there are no back-to-back units yet. So combined back-to-back numbers equal 2025-26.
  - Combined home vs away: +0.02 pts (CI −0.17 to +0.21) from 714 units (540 players). Minutes are −0.25 at home (CI −0.47 to −0.02, p = 0.03), but points per 36 are flat.

## Segments

- **Position:** first-listed position from that season's official team roster (G-F counts as G, F-C as F, C-F as C).
  - For 2025-26 players no longer on a roster, I used the NBA player index for 2025-26.
- **Age:** age on Feb 1 of the season, from birth date. Buckets: 23 or younger, 24–27, 28–31, 32+.
- **Experience:** the roster's years-of-experience for that season, with rookies as 0. Buckets: rookie, 1–3, 4–7, 8+.
- **Scorer tier:** rank by that season's points per game among players with at least 20 games (2025-26) or at least 4 games (2026-27).
  - Tiers are top 10, 11–25, 26–50 and 51–100. "Rest" is everyone else, including players under the games threshold.

Notable 2025-26 back-to-back segments (second night minus rested, points):

- **By position.**
  - Guards: +0.49 (CI +0.23 to +0.75, n = 239).
  - Forwards: +0.44 (CI +0.09 to +0.78, n = 186).
  - Centers: −0.03 (CI −0.60 to +0.54, n = 64).
  - For every position the minutes rise and points per 36 stay flat.
- **By experience.** The youngest players gain most:
  - rookies +0.66 pts and +1.38 min (n = 69);
  - 1–3 years +0.44 pts and +1.12 min (n = 166);
  - 8+ years +0.37 pts and +0.32 min, not significant (n = 99).
- **By scorer tier.**
  - Top 10: +0.24 pts and −1.33 min (n = 10).
  - Ranks 11–25: +0.16 (n = 15).
  - Ranks 26–50: +0.14 (n = 24).
  - Ranks 51–100: −0.24 (n = 50).
  - Rest: +0.51 (n = 390).
  - None of the top-100 tiers is distinguishable from zero.

Every segment, season and measure is in the JSON. Each entry lists n, games per side, mean, median, CI and p.

## Caveats

- **2026-27 is a tiny sample** (about 6–8 games per team). Treat it as a placeholder until the season builds up.
- **Observational data.** Venue and rest aren't assigned at random, and players held out on back-to-backs don't appear. So the back-to-back result describes the games that were actually played, not how tired any one player is.
- **Many comparisons.** The JSON holds several hundred comparisons (3 topics × 3 scopes × 18 groups × 3 measures), so some p < 0.05 results will be chance. The single-season home-vs-away segment results that clear p < 0.05, such as ranks 26–50 at +0.99 at home, don't repeat in 2026-27 or in the combined numbers.
- **Small tiers.** The top 10 and 11–25 tiers have only 10–25 players, and their CIs are wide.
- **Missing data.** Experience is missing for **57 players in 2025-26 (681 player-games)**. They were on neither the 2025-26 nor the 2026-27 official team roster, and the NBA's other player endpoint only gives *current* experience. They count in the overall numbers but not in the experience segments. Position and age are complete for both seasons. Nothing was estimated or filled in.
- **Trades.** For a traded player, rest is judged by the team he played for that night.

## Sources

- **Box scores:** NBA PlayerGameLogs (curated warehouse).
- **Neutral-site flag:** NBA BoxScoreSummaryV3.
- **Rosters:** official NBA team rosters (CommonTeamRoster).
  - 2025-26 pulled 2026-11-05 03:59 UTC (Nov 4, 10:59 PM Toronto time).
  - 2026-27 pulled 2026-11-04 22:56 UTC.
- **Birth dates for 51 players on neither roster:** CommonPlayerInfo, pulled 2026-11-05 04:03 UTC.
- **2025-26 position fallback:** NBA PlayerIndex 2025-26, pulled 2026-10-08.
- **2026-27 schedule:** NBA ScheduleLeagueV2.
- File hashes of every input are listed in the JSON under `sources.inputs`.
