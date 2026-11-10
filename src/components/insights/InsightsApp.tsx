"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { TOPICS, topicById } from "@/lib/insightTopics";
import type { Bundle, CardModel, Ctx, Fix, Sel, TopicId } from "@/lib/insights/types";
import { fmtN } from "@/lib/insights/util";
import { CARDS, type Card } from "./cards";
import { FilterBar, FilterSheet, TopicRail } from "./Chrome";
import { CardBoundary, Dot, InsightCard, ScanRow } from "./InsightCard";
import { buildUrl, useInsightFilters } from "./useInsightFilters";
import styles from "./insights.module.css";

function safeCompute(card: Card, ctx: Ctx): CardModel {
  try {
    return card.compute(ctx);
  } catch (e) {
    console.error(`insight card ${card.id} failed`, e);
    return {
      verdict: "err",
      headline: "",
      scan: { value: "n/a", unit: "" },
      scope: [],
      pills: [],
      how: "",
      switches: [],
      body: null,
      legend: [],
      facts: [],
      sample: "",
      caveats: [],
      method: "",
      state: { kind: "err", title: "Couldn’t load this card", text: "Something went wrong computing this card. Other cards are unaffected." },
    };
  }
}

export function InsightsApp({ data }: { data: Bundle }) {
  const { st, ready, setTopic, setTs, setSeg, patch, reset, setMode, setView, openCard } = useInsightFilters();
  const [sheet, setSheet] = useState<null | "ts" | "seg">(null);
  const [retry, setRetry] = useState(0);
  const [active, setActive] = useState(0);
  const mode = st.focus ? "full" : st.mode;

  const models = useMemo(() => {
    const f = { ts: st.ts, seg: st.seg };
    const out: Record<string, CardModel> = {};
    for (const c of CARDS) out[c.id] = safeCompute(c, { f, data, sel: st.views[c.id] ?? {} });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st.ts, st.seg, st.views, data, retry]);

  const topic = st.topic ? topicById(st.topic) : undefined;
  const cards = useMemo(() => (st.topic ? CARDS.filter((c) => c.topic === st.topic) : []), [st.topic]);

  /* scroll to the top of the topic when topic or filters change; deep links scroll to their card */
  useEffect(() => {
    if (!ready) return;
    if (st.focus) {
      const id = st.focus;
      const t = window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: "start" }), 60);
      return () => window.clearTimeout(t);
    }
    const el = document.getElementById("topic-top");
    if (el) {
      const margin = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
      if (window.scrollY > el.getBoundingClientRect().top + window.scrollY - margin) el.scrollIntoView({ block: "start" });
    }
  }, [ready, st.topic, st.ts, st.seg, st.focus]);

  /* scroll-spy */
  useEffect(() => {
    if (!st.topic) return;
    let raf = 0;
    const calc = () => {
      raf = 0;
      const els = [...document.querySelectorAll<HTMLElement>("[data-card]")];
      let idx = 0;
      els.forEach((e, i) => {
        if (e.getBoundingClientRect().top <= 150) idx = i;
      });
      setActive(idx);
    };
    const on = () => {
      if (!raf) raf = requestAnimationFrame(calc);
    };
    calc();
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    return () => {
      window.removeEventListener("scroll", on);
      window.removeEventListener("resize", on);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [st.topic, mode, st.ts, st.seg]);

  const onFix = useCallback((fx: Fix) => patch({ ts: fx.ts, seg: fx.seg }), [patch]);
  const nFindings = st.topic ? cards.length : CARDS.length;
  const loc: [string, string] | undefined = topic ? [topic.label, `${Math.min(active + 1, cards.length)}/${cards.length}`] : undefined;
  const closeSheet = useCallback(() => setSheet(null), []);

  const linkFor = (c: Card) => (open: boolean) => buildUrl({ topic: c.topic, ts: st.ts, seg: st.seg }, { id: c.id, sel: models[c.id] ? currentSel(models[c.id], st.views[c.id]) : {}, open });

  return (
    <div className={styles.app}>
      <div className={styles.stack}>
        <TopicRail topic={st.topic} onSelect={setTopic} />
        <FilterBar ts={st.ts} seg={st.seg} loc={loc} onOpen={setSheet} onReset={reset} />
      </div>
      <main className={styles.main}>
        {!topic ? (
          <Overview data={data} models={models} onOpen={setTopic} />
        ) : (
          <>
            <header className={styles.thead} id="topic-top" style={{ scrollMarginTop: undefined }}>
              <div className={styles.trow}>
                <h1>{topic.label}</h1>
                <div className={styles.seg} role="group" aria-label="View mode">
                  <button type="button" className={mode === "full" ? styles.on : ""} aria-pressed={mode === "full"} onClick={() => setMode("full")}>
                    Full
                  </button>
                  <button type="button" className={mode === "scan" ? styles.on : ""} aria-pressed={mode === "scan"} onClick={() => setMode("scan")}>
                    Scan
                  </button>
                </div>
              </div>
              <div className={styles.cnt}>{cards.length} findings</div>
              <p>{topic.q}</p>
            </header>
            {mode === "scan" ? (
              <div className={styles.scanGrid}>
                {cards.map((c, i) => (
                  <ScanRow key={c.id} card={c} model={models[c.id]} index={i + 1} count={cards.length} onOpen={() => openCard(c.topic, c.id)} />
                ))}
                <div className={styles.note} style={{ margin: "0 2px", gridColumn: "1 / -1" }}>
                  Tap a row to open its card. Scan keeps headlines and verdicts; Full adds chart, how to read and caveats.
                </div>
              </div>
            ) : (
              <div className={styles.cardsGrid}>
                {cards.map((c, i) => (
                  <CardBoundary key={c.id} id={c.id} title={c.title} eyebrow={`${topic.label} · ${i + 1} of ${cards.length}`} onRetry={() => setRetry((r) => r + 1)}>
                    <InsightCard
                      card={c}
                      model={models[c.id]}
                      index={i + 1}
                      count={cards.length}
                      topicLabel={topic.label}
                      openInit={st.focus === c.id && st.open}
                      onView={(k, v) => setView(c.id, k, v)}
                      onFix={onFix}
                      onRetry={() => setRetry((r) => r + 1)}
                      linkFor={linkFor(c)}
                    />
                  </CardBoundary>
                ))}
              </div>
            )}
          </>
        )}
      </main>
      {sheet ? (
        <FilterSheet data={data} ts={st.ts} seg={st.seg} nFindings={nFindings} onTs={setTs} onSeg={setSeg} onReset={reset} onClose={closeSheet} />
      ) : null}
    </div>
  );
}

/** The selection actually shown (defaults resolved by the card) for Copy link. */
function currentSel(model: CardModel, raw: Sel | undefined): Sel {
  const out: Sel = {};
  for (const sw of model.switches) out[sw.key] = sw.value;
  return { ...out, ...(raw && Object.keys(out).length ? {} : {}) };
}

/* ───────── overview ───────── */
function Overview({ data, models, onOpen }: { data: Bundle; models: Record<string, CardModel>; onOpen: (t: TopicId) => void }) {
  const through = data.deep.through ?? data.insights.data_as_of?.["2026_27"] ?? "";
  return (
    <>
      <header className={styles.ovH}>
        <div className={styles.cnt}>
          {TOPICS.length} topics · {CARDS.length} findings{through ? ` · data through ${through}` : ""}
        </div>
        <h1>Insights</h1>
        <p>What moves NBA scoring, and what is just noise. Each card says plainly whether the data show a clear change.</p>
      </header>
      <div className={styles.tilesGrid}>
        {TOPICS.map((t) => {
          const cs = CARDS.filter((c) => c.topic === t.id);
          return (
            <button key={t.id} type="button" className={styles.tile} onClick={() => onOpen(t.id)} aria-label={`${t.label}, ${cs.length} findings`}>
              <h3>{t.label}</h3>
              <div className={styles.n}>
                {cs.length}
                <small>findings</small>
              </div>
              <div className={styles.q}>{t.q}</div>
              <div className={styles.dots}>
                {cs.map((c) => {
                  const m = models[c.id];
                  const v = m.state ? (m.state.kind === "pend" ? "pend" : m.state.kind === "err" ? "err" : "thin") : m.verdict;
                  return <Dot key={c.id} verdict={v} label={`${c.title}: ${m.state ? m.state.title : (m.badgeText ?? v)}`} />;
                })}
                <span className={styles.go}>Open →</span>
              </div>
            </button>
          );
        })}
      </div>
      <div className={styles.tileKey} aria-label="Dot key">
        <span><i className={`${styles.dot} ${styles.up}`} />Clear above</span>
        <span><i className={`${styles.dot} ${styles.down}`} />Clear below</span>
        <span><i className={`${styles.dot} ${styles.flat}`} />Not clear</span>
        <span><i className={`${styles.dot} ${styles.thin}`} />Too few games</span>
        <span><i className={`${styles.dot} ${styles.info}`} />Overview</span>
      </div>
      <section className={styles.about} aria-labelledby="about-h">
        <h2 id="about-h">About this data</h2>
        <p>
          Regular-season games only. Each player is compared against himself; numbers are associations, not causes. A result is “clear” only when its 95% interval excludes the baseline.
          {through ? ` Data through ${through}; ` : " "}
          {fmtN(CARDS.length)} findings follow the filters above.
        </p>
        <ul>
          {data.insights.caveats.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
        <p>Method: {typeof data.insights.metric_note === "string" ? data.insights.metric_note : ""}</p>
      </section>
    </>
  );
}
