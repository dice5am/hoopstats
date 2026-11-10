import type { Topic, TopicId } from "./insights/types";

/**
 * Card registry (metadata only; the computed model for each card lives in
 * components/insights/cards). Counts on the rail and Overview come from here.
 */
export const TOPICS: Topic[] = [
  { id: "venue", label: "Venue & rest", q: "Do home, back-to-backs and rest days move scoring?" },
  { id: "matchups", label: "Matchups", q: "Do players score more against weak defences and fast teams, and does it hold up?" },
  { id: "big-nights", label: "Big nights", q: "What makes a +10 or ×1.25 night more likely?" },
  { id: "players", label: "Players", q: "Are any individual players really different, or is it noise?" },
  { id: "drivers", label: "Drivers", q: "Which box-score measures go with a player’s points, and how well do they predict?" },
];

export type FilterHonour = { ts: "yes" | "na"; seg: "yes" | "na" | "rows" };

export type CardMeta = {
  id: string;
  topic: TopicId;
  title: string;
  honours: FilterHonour;
};

const YY: FilterHonour = { ts: "yes", seg: "yes" };
const YN: FilterHonour = { ts: "yes", seg: "na" };
const BN: FilterHonour = { ts: "yes", seg: "yes" };

export const CARD_META: CardMeta[] = [
  { id: "home-away", topic: "venue", title: "Home vs away", honours: YY },
  { id: "b2b-2nd", topic: "venue", title: "Back-to-back, 2nd night", honours: YY },
  { id: "b2b-1st", topic: "venue", title: "Back-to-back, 1st night", honours: YY },
  { id: "rest-days", topic: "venue", title: "Rest days", honours: YY },
  { id: "swing", topic: "venue", title: "Game-to-game swing", honours: YY },

  { id: "defence-tiers", topic: "matchups", title: "Defence tiers", honours: YY },
  { id: "opp-tiers", topic: "matchups", title: "Opponent tiers", honours: YY },
  { id: "stars", topic: "matchups", title: "Stars vs everyone", honours: { ts: "yes", seg: "rows" } },
  { id: "stability", topic: "matchups", title: "Season to season", honours: { ts: "na", seg: "rows" } },
  { id: "role-position", topic: "matchups", title: "Role & position", honours: YN },

  { id: "teammates-out", topic: "big-nights", title: "Teammates out", honours: BN },
  { id: "bounce-back", topic: "big-nights", title: "No bounce-back", honours: BN },
  { id: "stale-average", topic: "big-nights", title: "Hot game: a stale average", honours: BN },
  { id: "role-change", topic: "big-nights", title: "Role change in progress", honours: BN },
  { id: "tiers", topic: "big-nights", title: "Defence & pace: small", honours: BN },
  { id: "odds", topic: "big-nights", title: "Big-night odds", honours: YY },
  { id: "situation", topic: "big-nights", title: "Big nights by situation", honours: YY },
  { id: "no-signal", topic: "big-nights", title: "Tested, nothing there", honours: BN },
  { id: "stars-vs-others", topic: "big-nights", title: "Stars vs everyone", honours: BN },
  { id: "how-it-happened", topic: "big-nights", title: "How the night happened", honours: BN },
  { id: "no-forecast", topic: "big-nights", title: "No pregame probability", honours: { ts: "yes", seg: "rows" } },
  { id: "skill", topic: "big-nights", title: "How well odds predict", honours: YY },
  { id: "credible-players", topic: "big-nights", title: "Credible player cases", honours: { ts: "yes", seg: "na" } },

  { id: "players-out", topic: "players", title: "Who responds when a scorer is out", honours: { ts: "na", seg: "yes" } },
  { id: "flags", topic: "players", title: "Flags vs chance", honours: YN },
  { id: "rankings", topic: "players", title: "Rankings: biggest gaps", honours: YN },
  { id: "heatmap", topic: "players", title: "Segment heatmap", honours: YN },
  { id: "watch-list", topic: "players", title: "Watch list", honours: YN },
  { id: "player-effect", topic: "players", title: "Any player-specific effect?", honours: YN },
  { id: "player-splits", topic: "players", title: "Player splits", honours: YY },

  { id: "drivers", topic: "drivers", title: "Points drivers", honours: YY },
  { id: "baseline", topic: "drivers", title: "Model vs baseline", honours: YY },
  { id: "shape", topic: "drivers", title: "Defence & pace curves", honours: YY },
];

export const topicById = (id: string) => TOPICS.find((t) => t.id === id);
export const cardMeta = (id: string) => CARD_META.find((c) => c.id === id);
export const cardsIn = (t: TopicId) => CARD_META.filter((c) => c.topic === t);
export const isTopicId = (s: string | null | undefined): s is TopicId => !!s && TOPICS.some((t) => t.id === s);

/**
 * Today's section → new home. Every row of the old single-scroll page, so nothing is dropped.
 * Kept here as the checklist of record (also printed in the build report).
 */
export const FINDING_MAP: { from: string; to: string }[] = [
  { from: "Home vs away: story, stat tiles, overall whisker", to: "venue · home-away" },
  { from: "Home vs away: by position / age / experience", to: "venue · home-away · Split by" },
  { from: "Home vs away: big-night lines (+10, ×1.25)", to: "big-nights · situation" },
  { from: "Home vs away: spread line", to: "venue · swing" },
  { from: "B2B 2nd: story + minutes-vs-rate attribution, Top 100 / Top 10 peer notes", to: "venue · b2b-2nd · headline + caveats" },
  { from: "B2B 2nd: Points / Minutes / Per 36", to: "venue · b2b-2nd · view switch" },
  { from: "B2B 2nd: by position, age, experience (pts), experience (min)", to: "venue · b2b-2nd · Split by" },
  { from: "B2B 2nd: big-night lines", to: "big-nights · situation" },
  { from: "B2B 2nd: spread line", to: "venue · swing" },
  { from: "B2B 2nd: longer rest (3+ days off)", to: "venue · rest-days" },
  { from: "B2B 1st: whisker + story", to: "venue · b2b-1st" },
  { from: "B2B 1st: big nights, spread", to: "big-nights · situation; venue · swing" },
  { from: "Player rankings (Top/Bottom 25 × H/A, B2B 2nd, B2B 1st) + noise & ranking notes", to: "players · rankings" },
  { from: "Segment heatmap", to: "players · heatmap" },
  { from: "Watch list", to: "players · watch-list" },
  { from: "Player-splits caveats", to: "players · rankings / watch-list · caveats" },
  { from: "Player flags vs chance", to: "players · flags" },
  { from: "(new) player × condition study, top-scorer-out lead", to: "players · players-out; every card’s “Players most affected” block" },
  { from: "Matchups: tier contrasts × Points / +10 / ×1.25", to: "matchups · defence-tiers" },
  { from: "Matchups: by PPG segment", to: "matchups · stars" },
  { from: "Matchups: stable season to season + Top-50 caveat", to: "matchups · stability" },
  { from: "Matchups: any single player with a big-night effect?", to: "players · player-effect" },
  { from: "Matchups: Top 50 conditioned odds ratio", to: "big-nights · odds (Top 50)" },
  { from: "Opponent tiers (defence & pace ladders, why contrasts)", to: "matchups · opp-tiers" },
  { from: "Big-night odds (OR by defence/pace × +10/+5/×1.25, raw rates)", to: "big-nights · odds" },
  { from: "Big-night odds: AUC, calibration, train vs test, log-loss", to: "big-nights · skill" },
  { from: "Role and position", to: "matchups · role-position" },
  { from: "Player matchup & big-night splits", to: "players · player-splits" },
  { from: "Points drivers (lens, model, ranked effects, left-out, not-in-model)", to: "drivers · drivers" },
  { from: "Model vs prior-average baseline", to: "drivers · baseline" },
  { from: "Defence / pace fitted curves", to: "drivers · shape" },
  { from: "Method footer, data-as-of", to: "Overview · About this data + every card’s Method" },
  { from: "(placeholder for the incoming big-nights study)", to: "replaced by the 11 big-nights study cards below" },
];

/** docs/analysis/BIG_NIGHTS.md §10, item by item (the doc's numbering) → card. */
export const BIG_NIGHTS_MAP: { n: number; item: string; to: string }[] = [
  { n: 1, item: "Usage-vacuum chip (teammates out, “associated with”)", to: "big-nights · teammates-out (+ Players most affected)" },
  { n: 2, item: "Say “no bounce-back” plainly", to: "big-nights · bounce-back" },
  { n: 3, item: "Hot game / minutes-up as a stale average, season vs last-10 toggle", to: "big-nights · stale-average" },
  { n: 4, item: "Defence and pace tiers: small, with CIs", to: "big-nights · tiers" },
  { n: 5, item: "“Tested, nothing there” strip", to: "big-nights · no-signal" },
  { n: 6, item: "Role-change flag", to: "big-nights · role-change" },
  { n: 7, item: "Stars vs everyone toggle (+ recent-form interaction)", to: "big-nights · stars-vs-others" },
  { n: 8, item: "How the night happened (same game, labelled)", to: "big-nights · how-it-happened" },
  { n: 9, item: "No pregame probability: context base rates + AUC note", to: "big-nights · no-forecast" },
  { n: 10, item: "Per-player cards: credible cases only, flagged vs expected by chance", to: "big-nights · credible-players (+ Players most affected)" },
  { n: 11, item: "2026-27 provisional, thin cells hidden", to: "every big-nights card (gate: bnGate) + provisional notes" },
];
