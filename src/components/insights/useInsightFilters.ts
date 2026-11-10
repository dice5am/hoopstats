"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cardMeta, isTopicId } from "@/lib/insightTopics";
import type { Sel, TopicId } from "@/lib/insights/types";
import { SEGMENT_ORDER, TIMESPAN_ORDER, type SegmentKey, type TimespanKey } from "@/lib/timespans";

export const DEFAULT_TS: TimespanKey = "pooled_2023_26";
export const DEFAULT_SEG: SegmentKey = "all";

export type Mode = "full" | "scan";

export type InsightState = {
  topic: TopicId | null;
  ts: TimespanKey;
  seg: SegmentKey;
  mode: Mode;
  views: Record<string, Sel>;
  /** card id targeted by the URL hash */
  focus: string | null;
  /** hash target should open its caveats */
  open: boolean;
};

const INITIAL: InsightState = { topic: null, ts: DEFAULT_TS, seg: DEFAULT_SEG, mode: "full", views: {}, focus: null, open: false };

function parse(): Partial<InsightState> {
  const q = new URLSearchParams(window.location.search);
  const out: Partial<InsightState> = {};
  const t = q.get("t");
  const ts = q.get("ts");
  const seg = q.get("seg");
  if (isTopicId(t)) out.topic = t;
  if (ts && (TIMESPAN_ORDER as string[]).includes(ts)) out.ts = ts as TimespanKey;
  if (seg && (SEGMENT_ORDER as string[]).includes(seg)) out.seg = seg as SegmentKey;
  const hash = decodeURIComponent(window.location.hash.replace(/^#/, ""));
  const meta = hash ? cardMeta(hash) : undefined;
  if (meta) {
    out.focus = meta.id;
    out.topic = meta.topic;
    out.open = q.get("open") === "1";
    const m = q.get("m");
    const s = q.get("s");
    if (m || s) out.views = { [meta.id]: { m: m ?? undefined, s: s ?? undefined } };
  }
  return out;
}

export function buildUrl(st: { topic: TopicId | null; ts: TimespanKey; seg: SegmentKey }, card?: { id: string; sel: Sel; open?: boolean }): string {
  const q = new URLSearchParams();
  if (st.topic) q.set("t", st.topic);
  if (st.ts !== DEFAULT_TS) q.set("ts", st.ts);
  if (st.seg !== DEFAULT_SEG) q.set("seg", st.seg);
  if (card) {
    if (card.sel.m) q.set("m", card.sel.m);
    if (card.sel.s) q.set("s", card.sel.s);
    if (card.open) q.set("open", "1");
  }
  const qs = q.toString();
  return `${window.location.origin}${window.location.pathname}${qs ? `?${qs}` : ""}${card ? `#${card.id}` : ""}`;
}

/**
 * One state for topic, timespan, segment, Scan/Full and per-card views.
 * URL is the source on load; later changes `replaceState` (no history spam).
 */
export function useInsightFilters() {
  const [st, setSt] = useState<InsightState>(INITIAL);
  const [ready, setReady] = useState(false);
  const first = useRef(true);

  useEffect(() => {
    const fromUrl = parse();
    let mode: Mode = "full";
    try {
      mode = window.localStorage.getItem("hs-insights-mode") === "scan" ? "scan" : "full";
    } catch {
      /* private mode */
    }
    setSt((s) => ({ ...s, ...fromUrl, mode }));
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (first.current) {
      first.current = false;
      return;
    }
    const url = buildUrl(st);
    window.history.replaceState(null, "", url.replace(window.location.origin, ""));
  }, [st.topic, st.ts, st.seg, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const setTopic = useCallback((topic: TopicId | null) => setSt((s) => ({ ...s, topic, focus: null, open: false })), []);
  const setTs = useCallback((ts: TimespanKey) => setSt((s) => ({ ...s, ts, focus: null })), []);
  const setSeg = useCallback((seg: SegmentKey) => setSt((s) => ({ ...s, seg, focus: null })), []);
  const patch = useCallback((p: { ts?: TimespanKey; seg?: SegmentKey }) => setSt((s) => ({ ...s, ...p, focus: null })), []);
  const reset = useCallback(() => setSt((s) => ({ ...s, ts: DEFAULT_TS, seg: DEFAULT_SEG, focus: null })), []);
  const setMode = useCallback((mode: Mode) => {
    try {
      window.localStorage.setItem("hs-insights-mode", mode);
    } catch {
      /* ignore */
    }
    setSt((s) => ({ ...s, mode }));
  }, []);
  const setView = useCallback((id: string, key: "m" | "s", value: string) => setSt((s) => ({ ...s, views: { ...s.views, [id]: { ...s.views[id], [key]: value } } })), []);
  const openCard = useCallback((topic: TopicId, id: string) => setSt((s) => ({ ...s, topic, focus: id, open: false })), []);

  return { st, ready, setTopic, setTs, setSeg, patch, reset, setMode, setView, openCard };
}
