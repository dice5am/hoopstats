"use client";

import { useCallback, useEffect, useState } from "react";
import { decodePlayerSlots, type PlayerSlots } from "./teamGames";

/** Per-session memory cache of decoded /slots/<id>.json, plus in-flight dedupe. */
const cache = new Map<string, PlayerSlots>();
const inflight = new Map<string, Promise<PlayerSlots>>();

function fetchSlots(id: string): Promise<PlayerSlots> {
  let p = inflight.get(id);
  if (!p) {
    p = fetch(`/slots/${encodeURIComponent(id)}.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`slots ${r.status}`);
        return r.json();
      })
      .then((w) => {
        const slots = decodePlayerSlots(w);
        cache.set(id, slots);
        return slots;
      })
      .finally(() => inflight.delete(id));
    inflight.set(id, p);
  }
  return p;
}

export type SlotsState =
  | { status: "ready"; slots: PlayerSlots }
  | { status: "loading" }
  | { status: "failed"; retry: () => void };

/**
 * His season-chart slots. Responses for a player no longer picked are
 * ignored (no stale chart on quick switches); a cached player is ready on
 * the first render.
 */
export function useSlots(id: string): SlotsState {
  const [failedId, setFailedId] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [, setLoaded] = useState<string | null>(null);

  useEffect(() => {
    if (cache.has(id)) return;
    let live = true;
    fetchSlots(id).then(
      () => live && setLoaded(id),
      () => live && setFailedId(id),
    );
    return () => {
      live = false;
    };
  }, [id, attempt]);

  const retry = useCallback(() => {
    setFailedId(null);
    setAttempt((n) => n + 1);
  }, []);

  const slots = cache.get(id);
  if (slots) return { status: "ready", slots };
  if (failedId === id) return { status: "failed", retry };
  return { status: "loading" };
}
