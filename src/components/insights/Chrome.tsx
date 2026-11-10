"use client";

import { useEffect, useRef } from "react";
import { TOPICS, cardsIn } from "@/lib/insightTopics";
import type { Bundle, TopicId } from "@/lib/insights/types";
import { SEGMENT_ORDER, TIMESPAN_ORDER, type SegmentKey, type TimespanKey } from "@/lib/timespans";
import { segName, tsName } from "@/lib/insights/util";
import { CARDS } from "./cards";
import { DEFAULT_SEG, DEFAULT_TS } from "./useInsightFilters";
import styles from "./insights.module.css";

const count = (t: TopicId) => CARDS.filter((c) => c.topic === t).length;

/* ───────── topic rail ───────── */
export function TopicRail({ topic, onSelect }: { topic: TopicId | null; onSelect: (t: TopicId | null) => void }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>('[aria-current="page"]');
    if (el && window.matchMedia("(max-width: 999px)").matches) {
      const box = ref.current!;
      box.scrollTo({ left: el.offsetLeft - 16, behavior: "smooth" });
    }
  }, [topic]);
  return (
    <nav className={styles.rail} aria-label="Insight topics" ref={ref}>
      <button type="button" className={`${styles.chip} ${topic === null ? styles.on : ""}`} aria-current={topic === null ? "page" : undefined} onClick={() => onSelect(null)}>
        Overview
      </button>
      {TOPICS.map((t) => (
        <button key={t.id} type="button" className={`${styles.chip} ${topic === t.id ? styles.on : ""}`} aria-current={topic === t.id ? "page" : undefined} onClick={() => onSelect(t.id)}>
          {t.label}
          <span className={styles.ct}>{count(t.id)}</span>
        </button>
      ))}
    </nav>
  );
}

/* ───────── filter bar ───────── */
export function FilterBar({
  ts,
  seg,
  loc,
  onOpen,
  onReset,
}: {
  ts: TimespanKey;
  seg: SegmentKey;
  loc?: [string, string];
  onOpen: (which: "ts" | "seg") => void;
  onReset: () => void;
}) {
  const modTs = ts !== DEFAULT_TS;
  const modSeg = seg !== DEFAULT_SEG;
  return (
    <div className={styles.fbar} role="group" aria-label="Filters">
      <button type="button" id="pill-ts" className={`${styles.pill} ${styles.ts} ${modTs ? styles.mod : ""}`} aria-haspopup="dialog" onClick={() => onOpen("ts")}>
        <span className={styles.pl}>Timespan</span>
        <span className={styles.pv}>{tsName(ts)}</span>
        <i className={styles.caret} />
      </button>
      <button type="button" id="pill-seg" className={`${styles.pill} ${styles.sg} ${modSeg ? styles.mod : ""}`} aria-haspopup="dialog" onClick={() => onOpen("seg")}>
        <span className={styles.pl}>Segment</span>
        <span className={styles.pv}>{segName(seg)}</span>
        <i className={styles.caret} />
      </button>
      {modTs || modSeg ? (
        <button type="button" className={styles.reset} aria-label="Reset filters" onClick={onReset}>
          ↺
        </button>
      ) : loc ? (
        <div className={styles.loc} aria-live="polite">
          {loc[0]}
          <b>{loc[1]}</b>
        </div>
      ) : null}
    </div>
  );
}

/* ───────── filter sheet ───────── */
export function FilterSheet({
  data,
  ts,
  seg,
  nFindings,
  onTs,
  onSeg,
  onReset,
  onClose,
}: {
  data: Bundle;
  ts: TimespanKey;
  seg: SegmentKey;
  nFindings: number;
  onTs: (t: TimespanKey) => void;
  onSeg: (s: SegmentKey) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>('button[aria-pressed="true"]')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !box.current) return;
      const f = [...box.current.querySelectorAll<HTMLElement>("button:not([disabled])")];
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      prev?.focus();
    };
  }, [onClose]);

  const info = data.insights.timespan_info;
  const subTs = (t: TimespanKey): string => {
    const i = info[t];
    if (t === "2026_27") return `to ${data.deep.through ?? "date"}`;
    if (i?.pooled && i.seasons.length) return `${i.seasons[0]} to ${i.seasons[i.seasons.length - 1]}`;
    return "full season";
  };
  const subSeg = (s: SegmentKey): string => {
    if (s === "all") return "everyone ranked";
    const r = data.insights.results[ts]?.[s]?.ppg_range;
    return r ? `PPG ≥ ${r[0].toFixed(1)}` : "PPG rank";
  };
  const segThin = (s: SegmentKey) => {
    const c = data.deep.cells[ts]?.[s];
    return !c || c.thin;
  };
  return (
    <>
      <button type="button" className={styles.scrim} aria-label="Close filters" onClick={onClose} tabIndex={-1} />
      <div className={styles.sheet} role="dialog" aria-modal="true" aria-label="Filters" ref={box}>
        <div className={styles.grab} />
        <div className={styles.sheetHead}>
          <h2>Filters</h2>
        </div>
        <div className={styles.glab}>
          <span>Timespan</span>
        </div>
        <div className={styles.opts}>
          {TIMESPAN_ORDER.map((t) => (
            <button key={t} type="button" aria-pressed={ts === t} className={`${styles.opt} ${ts === t ? styles.on : ""}`} onClick={() => onTs(t)}>
              <b>{tsName(t)}</b>
              <i>{subTs(t)}</i>
              {t === "2026_27" ? <span className={styles.tag}>early</span> : null}
            </button>
          ))}
        </div>
        <div className={styles.glab}>
          <span>Segment (PPG rank)</span>
        </div>
        <div className={styles.opts}>
          {SEGMENT_ORDER.map((s) => (
            <button key={s} type="button" aria-pressed={seg === s} className={`${styles.opt} ${seg === s ? styles.on : ""} ${segThin(s) ? styles.thinopt : ""}`} onClick={() => onSeg(s)}>
              <b>{segName(s)}</b>
              <i>{subSeg(s)}</i>
              {segThin(s) ? <span className={styles.tag}>thin</span> : null}
            </button>
          ))}
        </div>
        <p className={styles.note}>
          Thin options stay selectable: cards show “too few games” instead of a guess. Position, age and experience are splits inside cards.
        </p>
        <div className={styles.sfoot}>
          <button type="button" className={styles.btn} onClick={onReset}>
            Reset
          </button>
          <button type="button" className={`${styles.btn} ${styles.pri}`} onClick={onClose}>
            Show {nFindings} findings
          </button>
        </div>
      </div>
    </>
  );
}

export { cardsIn };
