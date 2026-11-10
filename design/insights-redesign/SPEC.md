# hoopstats Insights redesign — readability + organization spec

For App Builder. Mobile-first at 390px. Keeps the live Hardwood look; adds a token layer (`tokens.css`). No app code was edited.
Mocks: `01`…`11-*.png` in this folder (390×844 @2x). Rebuild: `node design/insights-redesign/build.mjs` (needs playwright-core at `/tmp/pw`).
All numbers in the mocks are real: live default cell (3 seasons 2023–26 · All, data through 2026-11-09) or the cell named on the card. The only invented thing is the *layout* of the incoming big-nights study, labelled "layout preview, no data".

## 0. Read first (discrepancies)
- **Theme:** the live site is **Hardwood** (maple `#e9c99a`, key orange `#e4572e`, ink `#2b1d12`), not a `#F7E7CE` base. I kept Hardwood unchanged. `#F7E7CE` (champagne) is used only as the opaque surface for the sticky bars and the sheet; the cream card surface mixes to ≈`#F7E6CE` anyway.
- **Repo vs live:** `/workspace/hoopstats` is at `d3343cf`, behind live `d377ec4`. It has no code for Matchups, Opponent tiers, Big-night odds, Role & position, Player flags or Player matchup splits. I took those from the live page text and its embedded payload (`deep.cells[ts][seg].eff|tail|perf|sd|spline`, `deep.flags[ts]`, `deep.interactions[ts]`, `deep.auc`). Reconcile names against the real source.
- **One colour change to existing UI:** selected tabs/chips are orange today. Orange must mean "above baseline" in charts, so **selected = ink** (`--sel-bg`). That is the single biggest legibility fix.

## 1. Information architecture (the call)
**Topic rail (sticky chips with counts) + Overview index + shared filter bar, deep-linkable.** Not tabs alone (no map of what exists), not an index alone (still one scroll).
- 5 topics, 23 findings: **Venue & rest 5 · Matchups 5 · Big nights 4 · Players 6 · Drivers 3**. Counts come from the card registry, never hard-coded.
- **Overview** (default landing, `01`): one tile per topic: name, count, one-line question, one verdict dot per card (colour = card verdict at current filters), "Open →".
- **Topic page**: header (name, count, question, **Full | Scan** toggle) then cards. **Scan** (`08`) = headline + verdict dot + key number per finding, tap to open: a whole topic in about one screen. **Full** = standard cards. Scan/Full persists in localStorage.
- **Sticky stack = 100px** (rail 48 + filter bar 52). Location is always visible: active chip + "2/5" counter (scroll-spy on cards) + each card's eyebrow "MATCHUPS · 1 OF 5".
- **Deep links:** `/?t=matchups&ts=pooled_2023_26&seg=top50&m=dev#defence-tiers`. `t` topic, `ts`/`seg` filters (omit defaults), `m` card view, hash = card id (scroll + expand caveats if `&open=1`). Chip taps `replaceState`; "Copy link to card" in every card.
- Rail: horizontal scroll, active chip scrolled into view, right fade. Chip height 36, tap area 44.

### Finding-to-home map (nothing dropped)
| Today (live section → item) | New home (topic · card id · where) |
|---|---|
| Home vs away: story, stat tiles (mean diff, CI, units), overall whisker | Venue & rest · `home-away` · headline, scope, chart |
| …by position / age / experience whiskers | `home-away` · "Split by" row (segment = All only) |
| …Big nights lines (+10, ×1.25) | Big nights · `situation` |
| …Spread line | Venue & rest · `swing` |
| B2B 2nd: story + minutes-vs-rate attribution; Top 100 / Top 10 peer notes | `b2b-2nd` · headline + caveats ("Top 100: −0.12 …, Top 10: +0.47 …") |
| …Points / Minutes / Per 36 tiles + whiskers | `b2b-2nd` · metric views [Points · Minutes · Per 36] |
| …by position, age, experience (pts), experience (min) | `b2b-2nd` · "Split by" (Minutes only has Experience) |
| …Big nights lines | Big nights · `situation` |
| …Spread line | `swing` |
| …Longer rest (3+ days off −0.33) | Venue & rest · `rest-days` |
| B2B 1st: whisker + story | `b2b-1st` |
| …Big nights, Spread | `situation`, `swing` |
| Player rankings: noise note, ranking note (shrunk flat), Top/Bottom 25 × H/A, B2B 2nd, B2B 1st | Players · `rankings` |
| …Segment heatmap (PPG segment, position, age, experience × H−A, 2nd−R, 1st−R) | Players · `heatmap` |
| …Watch list (names, links to Players) | Players · `watch-list` |
| …Caveats (2026-27 tiny, nominal flags, observational) | caveats of `rankings` / `watch-list` |
| Player flags vs chance (3 outcomes × 4 tests) | Players · `flags` |
| Matchups: tier contrasts (Worst 5/10, Best 10/5) × Points / +10 / ×1.25 | Matchups · `defence-tiers` |
| …By PPG segment (two contrast charts) | Matchups · `stars` |
| …Is it stable season to season (All, Top 50) + Top-50 caveat | Matchups · `stability` |
| …"Any single player with a big-night effect? No" (τ 0.00/0.00) | Players · `player-effect` |
| …Top 50 conditioned odds ratio 1.01 (0.89–1.16) | Big nights · `odds` (it is that card at Top 50) |
| Opponent tiers (defence ladder, pace ladder × 3 metrics; "why contrasts") | Matchups · `opp-tiers` (why-contrasts → caveats) |
| Big-night odds (OR by defence/pace × +10/+5/×1.25; raw rates) | Big nights · `odds` (raw rates → scope line/caveats) |
| …AUC 0.57, AUC range, calibration slope 0.66, 6.7 vs 7.1%, log-loss +0.0016 | Big nights · `skill` |
| Role and position (points + ×1.25 odds, starter definition, overlap caveat) | Matchups · `role-position` (timespan only) |
| Player matchup & big-night splits (shrunk per-player, worst 5/10, H/A, B2B 2nd, 3 metrics, league band) | Players · `player-splits` (client-loaded: loading state) |
| Points drivers (Pregame/Same game, Mixed/OLS, ranked effects, left-out, not-in-model) | Drivers · `drivers` (left-out/not-in-model → caveats) |
| …Model vs prior-average baseline (MAE 4.75 vs 4.81, R² .455 vs .431, 12/18 and 8/18 cells) | Drivers · `baseline` |
| …Defence / pace fitted curves (p = 0.621) | Drivers · `shape` |
| Method footer, data-as-of | Overview footer "About this data" + "Method" button in every card's caveats |
| *(incoming)* big-nights study | Big nights · `big-night-study` (placeholder, `07`) |

## 2. Standard insight card (`03`, `04`, `10`)
Anatomy, top to bottom (numbers match `03`):
1. **Eyebrow** `TOPIC · i OF n` (Barlow 12 caps) + **verdict badge**: `▲ Clear` · `▼ Clear` · `○ Not clear` · `Too few games` · `Study incoming` · `Error`.
2. **Title** = the topic label (Barlow 24 caps), e.g. DEFENCE TIERS.
3. **Headline** = one plain sentence stating the finding (Inter 700 17/1.3, ≤ 25 words, ≤ 3 lines). Numbers rounded ≤ 1 dp, always says clear or "can't be told from zero". Generate from the verdict, reusing `comparisonStory`/`direction`; do not print the same sentence again as a figcaption (live repeats it).
4. **Scope** (12 dim): `span · segment · players · games`, plus `early sample` pill for 2026-27.
5. **How to read** (≤ 2 lines, 13px, ink-left-bar block): what one bar/dot is, and what the baseline means.
6. **View switch** (≤ 4 options, ink-selected; optional second "Split by" row). Existing per-section toggles become this; timespan/segment never appear here.
7. **Chart** (rules §3) with one shared axis and unit title.
8. **Legend**: only the keys used (Above / Below / Can't tell / 95% CI / Too few games / Lead only).
9. **Caveats & sample** disclosure (44px row, closed by default; summary on the right e.g. "n = 65,085 games").

Expanded (`04`): 3 fact tiles (players, games, min games per side), **Caveats** bullets, **Method** line, `Copy link` + `Method` buttons. Caveats must include: "Associations only, not causes" where applicable, the sample sizes per row, and any card-specific caveat from the map above. Collapsing keeps scroll position.

**States** (all keep the card frame and eyebrow):
| State | Look |
|---|---|
| Collapsed / expanded | caveats closed / open (chevron rotates) |
| Loading | skeleton in the final layout (title real, headline 2 bars, one row per expected row); `aria-busy`. Only `player-splits` is async today |
| Empty / too few games | badge `Too few games`, dashed box: reason with the real n, one-tap fix buttons ("Show All", "Show 2025-26"). Nothing is drawn, no guess |
| Not credible row | hatched row, no bar, value dim or `n/a`, reason in the CI line (see `05`, `09`) |
| Not clear | tan bar/ring, badge `○ Not clear`, headline says "can't be told from zero" |
| Error | `Error` badge, solid box, `Try again`; other cards unaffected |
| Study incoming | dashed card border, dashed badge, ghost controls at 55% opacity, hatched ghost rows `n/a`, label "layout preview, no data" (`07`) |

## 3. Chart legibility rules (`05`, `09`, `07`)
1. **Every chart prints an axis title with unit and direction**: e.g. "Points vs his prior average (pts)" with `← fewer` / `more →` under the ends. Ticks ≤ 5, ≥ 12px, signed (+/−), baseline tick bold.
2. **Baseline** = dotted ink line through all rows, always labelled on the axis: `0` for differences, `1` for odds ratios/ratios (log axis, ticks 0.8 · 1 · 1.25), `0.5` for AUC, `1` for calibration slope. One baseline per chart; if a card needs several (`skill`), each gauge row prints its own baseline label.
3. **Whisker = 95% confidence interval.** Defined in `05` and in every "how to read" block once per topic: *the range the true value likely sits in; if it touches the dotted line we can't tell it from no change.* Caps ±5px, 2px ink.
4. **One colour meaning everywhere** (below). Orange is never used for UI state, selected tabs or links.
5. **Bars vs dots:** differences from 0 → bar from baseline + whisker; ratios, odds, rankings, per-player → dot + whisker. Ranked lists sort by effect; ladders keep tier order.
6. **Values are text, not colour:** signed value right-aligned (Barlow 800 18), CI text + n left/right under the plot. The colour is only a second channel (▲/▼ glyph in badge and legend; orange vs brown differ by lightness for colour-blind users).
7. **Rows:** ≤ 5 rows = *detail row* (label + value line, 26px plot, CI/n line); ≥ 6 rows = *compact row* (label 92 | plot | value 62, 40px high).
8. **Same scale across rows and across a card's views of the same unit.** Autoscale to the widest CI so nothing clips (live Top-50 matchups overflow a fixed ±1).
9. **n is always visible** when it varies per row ("11,005 vs 54,080 games").
10. **Min type 12px at 390** (axis ticks included; today's SVG labels render ≈9–10px).
11. **Reference band** (league-wide estimate, `player-splits`) = translucent tan band `--d-band`, named in the legend.
12. **Never draw an estimate you can't stand behind:** thin rows are hatched, no bar.

### Colour meaning (tokens in `tokens.css`)
| Meaning | Mark | Token | Contrast (graphic vs card) |
|---|---|---|---|
| Credible, **above** baseline | orange fill `▲` | `--d-up` `#e4572e` | 3.0:1 |
| Credible, **below** baseline | brown fill `▼` | `--d-down` `#5c4128` | 7.7:1 |
| **Can't tell** (interval touches baseline) / expected-by-chance | tan fill **+ 1.5px `#7a5630` outline** | `--d-flat` / `--d-flat-ink` | outline 5.4:1 (fill alone 2.1, so never the sole signal) |
| **Too few games / not credible** | hatched, nothing drawn | `--d-thin` | text carries it |
| **Lead only** (player "watch": nominal |z| ≥ 2.5, not FDR-strong) | hollow orange ring | `--d-lead` | filled only if `strong` (0 today) |
| Baseline / grid / whisker | dotted / 20% / ink | `--d-baseline` `--d-grid` `--d-whisker` | |

### "Greyed = not credible": thresholds from the data
A row's state is computed, in this order:
1. **Too few games (hatched)** if any: `cell.thin === true` (today Top 25, Top 10 in every span; 2026-27 Top 50) · `block.small_n` or `n_units < 2` (home/away, B2B) · `sup` true on the effect · `nl < 30` or `nr < 30` games on a side (matchups; the app already blanks these) · **player rows: `min(n_a, n_b) < 10` games** (*proposal*: the data floor is only 3 per side, so Zyon Pullin is #1 at +4.60 on 5 home / 3 away games, CI −6.91 to +16.11) · **heatmap cell: `cmp_n < 10` players** (*proposal*, no per-cell CI exists).
2. **Clear** if not thin and the CI excludes the baseline.
3. **Not clear** otherwise.
Card verdict = verdict of the card's **headline row**: `home-away` Overall · `b2b-*` Overall pts · `defence-tiers` Worst 5 · `opp-tiers` Worst 5 (defence) · `stars` Top 50 · `stability` latest full season · `role-position` Centers · `odds` Worst 10 · `situation` B2B 2nd ×1.25 · `swing` B2B 2nd · `rest-days` · `drivers` rank-1 driver · `baseline` MAE gain CI · `shape` spline p; descriptive cards (`heatmap`, `watch-list`) use `Overview` (ink ring). The `2026_27` span adds the `early sample` pill and never changes the verdict rules.

## 4. Shared filter bar (`02`, `06`)
- **Position:** second row of the sticky stack, under the rail, on every page including Overview. Replaces the per-section timespan/segment switches (Home/away–B2B top switcher, Matchups/Opponent tiers/Big-night odds selectors) with one state.
- **Two pills** (40px, label above value): `TIMESPAN` and `SEGMENT`. Non-default turns the pill ink and shows a **↺ reset** (40px). The `n/a` rules live on the cards, not the pill.
- **Sheet** (bottom, champagne, scrim, grab handle, `Esc`/scrim closes, focus trap, no Apply button: changes apply live, footer `Reset` + `Show N findings`). Chips are 52px tall with a sublabel; thin options are hatched with a `thin` tag (never hidden); `2026-27` carries `early`.
- **Options = only what the data has:**
  - Timespan (6): `pooled_2023_27` "4 seasons pooled", `pooled_2023_26` "3 seasons 2023–26" (**default**), `2023_24`, `2024_25`, `2025_26`, `2026_27` "to 2026-11-09".
  - Segment (5): `all` (default), `top100`, `top50`, `top25`, `top10` (PPG rank). Sublabels use the span's real `ppg_range` (3-season: ≥14.8 / ≥19.5 / ≥22.9 / ≥26.3). No team, position or date filters exist in the data; do not add them (position/age/experience are *splits inside cards*).
- **Which filters each card honours** (each non-honoured filter shows a `segment n/a` / `timespan n/a` chip in the scope line):
  | Card | Timespan | Segment |
  |---|---|---|
  | `home-away`, `b2b-2nd`, `b2b-1st`, `rest-days`, `swing`, `situation` | yes | yes (position/age/experience splits only at `all`) |
  | `defence-tiers`, `opp-tiers`, `odds`, `skill`, `drivers`, `baseline`, `shape` | yes | yes; Top 25/10 thin |
  | `stars` | yes | shows every segment as rows, marks the selected one |
  | `stability` | rows are seasons (ignores) | shows All and Top 50 |
  | `role-position`, `flags`, `rankings`, `heatmap`, `watch-list` | yes | n/a |
  | `player-splits` | yes | follows the label "All" on live; **verify** |
  | `big-night-study` | TBD | TBD |
- Filter changes keep the topic and scroll to the top of the topic; URL updates; counts and verdict dots recompute.

## 5. Tokens (see `tokens.css`; existing `--hw-*` untouched)
- Surfaces: `--hw-champagne #f7e7ce` (sticky bars, sheet), `--s-card rgba(255,248,238,.62)` (was .42), `--s-card-2 .85`, `--s-sunk`, `--s-scrim`.
- State: `--sel-bg #2b1d12`, `--sel-fg #fff8ee`. Data: `--d-*` (above).
- Type (existing families): Barlow Condensed 800 caps for titles (34 topic, 24 card, 12 labels, 15 chips); Inter for body (14), headline (17/700), small (12). `font-variant-numeric: tabular-nums` on all numbers.
- Space 4/8/12/16/24/32, page gutter 16, tap ≥ 44, borders 3px card / 2.5px controls, radius 0. Text contrast: ink 13.3:1, ink-2 7.7:1, dim 6.4:1, cream-on-ink 15.5:1, key-ink on orange 5.1:1.

## 6. Build notes (App Builder)
- New: `src/lib/insightTopics.ts` (registry: id, topic, title, filters honoured, headline-row selector, verdict fn); `InsightCard`, `TopicRail`, `FilterBar`, `FilterSheet`, `Verdict` util (§3). Extend `DotWhisker` with `kind` (`up|down|flat|thin|ring`), `baseline`, `log`, bar mode; keep its API.
- One `useInsightFilters()` hook backed by `useSearchParams` + `replaceState`; pass `timespan/segment` down (the components already take them).
- Scroll-spy: `IntersectionObserver` per card → counter + active chip. Reduced-motion: no transitions on the sheet.
- Desktop (≥ 1000px, not mocked): rail becomes a sticky left column (220px) with counts; filter bar sticks at the top of the content column; cards single column max 760px; Scan rows in two columns.
- A11y: chips `role="tab"` with `aria-selected` only for the rail; sheet is `role="dialog"`; every chart keeps `role="img"` with the headline as label; badges have text, not colour alone.

## 7. Data limits
- Repo behind live (see §0): Matchups/Tiers/Odds/Role/Flags/Player-splits field names unverified against source; `player-splits` async source and segment support unverified.
- **Heatmap and watch list have no interval per cell/player in the data** → heatmap can only be "descriptive" or thin by n; ask Data Engineer for CIs if Cavin wants verdicts there.
- Position/age/experience splits exist only at segment `All`; minutes split only by experience.
- Top 25 / Top 10 are thin in every span; 2026-27 Top 25/10 are not computed; 2026-27 Top 50 is thin (237 games).
- No weekly/rolling time axis in Insights, only seasons. Do not offer "last 30 days".
- Player `n < 10` and heatmap `n < 10` thresholds are design proposals; Data Engineer should confirm.
- Big-nights study: no data. Outcomes today are +5, +10, ×1.25; the study adds ×1.5 and ×2, so the card's outcome switch is ghosted until the schema lands.

## 8. Mocks
`01-topic-index` Overview · `02-topic-with-filter-bar` Matchups, Top 50 applied, sticky stack · `03-insight-card-collapsed` anatomy 1–7 · `04-card-expanded-caveats` anatomy 8–9 + caveats · `05-chart-legibility` whisker, baseline, tan, hatched · `06-filter-sheet-open` · `07-big-nights-placeholder` · `08-topic-scan-mode` Venue & rest · `09-players-topic` rankings (lead rings, thin #1) · `10-card-states` loading / too few games / error · `11-players-flags-vs-chance`.
