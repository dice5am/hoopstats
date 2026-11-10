import type { ReactNode } from "react";
import { cardMeta } from "@/lib/insightTopics";
import type { CardModel, ChartSpec, Ctx, LegendKey } from "@/lib/insights/types";
import { respondersFor } from "@/lib/insights/responders";
import { pillsFor, scopeFor } from "@/lib/insights/util";
import { Chart } from "../Chart";

export const WHISKER = "Whisker = the 95% range the true value likely sits in. If it touches the dotted line, we can’t tell it from no change.";

export const ASSOC = "Associations only, not causes.";

export const EARLY_NOTE =
  "2026-27 is an early sample (about 13 games per team): treat every number as provisional. It enters only its own timespan and the 4-season pool.";

export const SEG_NOTE =
  "Top-N segments are chosen on scoring over the same games, so small top cells (Top 25, Top 10) are never read.";

/** Skeleton model: everything defaulted so cards only fill what they know. */
export function baseModel(ctx: Ctx, id: string, over: Partial<CardModel> = {}): CardModel {
  const meta = cardMeta(id)!;
  return {
    verdict: "thin",
    headline: "",
    scan: { value: "—", unit: "" },
    scope: scopeFor(ctx.f),
    pills: pillsFor(ctx.f, meta.honours),
    how: "",
    switches: [],
    body: null,
    legend: [],
    facts: [],
    sample: "",
    caveats: [],
    method: "",
    responders: respondersFor(id, ctx),
    ...over,
  };
}

export function chartBody(spec: ChartSpec, extra?: ReactNode): ReactNode {
  return (
    <>
      <Chart spec={spec} />
      {extra}
    </>
  );
}

export const LG = {
  diff: ["up", "down", "flat", "thin", "whk", "bl"] as LegendKey[],
  diffNoThin: ["up", "down", "flat", "whk", "bl"] as LegendKey[],
  rank: ["flat", "ring", "thin", "whk"] as LegendKey[],
};

export function sw(key: "m" | "s", value: string, options: { id: string; label: string; disabled?: boolean }[], label?: string) {
  return { key, value, options, label };
}

/** pick a valid option id, falling back to the first enabled one */
export function pick(sel: string | undefined, options: { id: string; disabled?: boolean }[]): string {
  const o = options.find((x) => x.id === sel && !x.disabled);
  return o?.id ?? options.find((x) => !x.disabled)?.id ?? options[0].id;
}
