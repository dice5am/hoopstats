import { CARD_META, type CardMeta } from "@/lib/insightTopics";
import type { CardModel, Ctx } from "@/lib/insights/types";
import * as venue from "./venue";
import * as matchups from "./matchups";
import * as bn from "./bignights";
import * as players from "./players";
import * as drivers from "./drivers";
import * as bs from "./bnstudy";

const COMPUTE: Record<string, (ctx: Ctx) => CardModel> = {
  "home-away": venue.homeAway,
  "b2b-2nd": venue.b2bSecond,
  "b2b-1st": venue.b2bFirst,
  "rest-days": venue.restDays,
  swing: venue.swing,
  "defence-tiers": matchups.defenceTiers,
  "opp-tiers": matchups.oppTiers,
  stars: matchups.stars,
  stability: matchups.stability,
  "role-position": matchups.rolePosition,
  "teammates-out": bs.teammatesOut,
  "bounce-back": bs.bounceBack,
  "stale-average": bs.staleAverage,
  "role-change": bs.roleChange,
  tiers: bs.tiers,
  "no-signal": bs.noSignal,
  "stars-vs-others": bs.starsVsOthers,
  "how-it-happened": bs.howItHappened,
  "no-forecast": bs.noForecast,
  "credible-players": bs.credibleOnly,
  situation: bn.situation,
  odds: bn.odds,
  skill: bn.skill,
  "players-out": players.playersOut,
  flags: players.flags,
  rankings: players.rankings,
  heatmap: players.heatmap,
  "watch-list": players.watchList,
  "player-effect": players.playerEffect,
  "player-splits": players.playerSplits,
  drivers: drivers.drivers,
  baseline: drivers.baseline,
  shape: drivers.shape,
};

export type Card = CardMeta & { compute: (ctx: Ctx) => CardModel };

/** Cards that have a computed model; counts everywhere come from this list. */
export const CARDS: Card[] = CARD_META.filter((m) => COMPUTE[m.id]).map((m) => ({ ...m, compute: COMPUTE[m.id] }));
