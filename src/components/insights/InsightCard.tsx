"use client";

import { Component, useState, type ReactNode } from "react";
import type { Card } from "./cards";
import type { CardModel, Fix, Verdict } from "@/lib/insights/types";
import { BADGE_TEXT } from "@/lib/insights/util";
import { Legend } from "./Chart";
import { PlayersMostAffected } from "./PlayersMostAffected";
import styles from "./insights.module.css";

const BADGE_CLASS: Record<Verdict, string> = {
  up: "up",
  down: "down",
  flat: "flat",
  thin: "thin",
  pend: "pend",
  info: "info",
  err: "info",
};

export function Badge({ verdict, text }: { verdict: Verdict; text?: string }) {
  return <span className={`${styles.badge} ${styles[BADGE_CLASS[verdict]]}`}>{text ?? BADGE_TEXT[verdict]}</span>;
}

export function Dot({ verdict, label }: { verdict: Verdict; label?: string }) {
  return <i className={`${styles.dot} ${styles[BADGE_CLASS[verdict]]}`} role="img" aria-label={label ?? BADGE_TEXT[verdict]} title={label ?? BADGE_TEXT[verdict]} />;
}

/** Keeps one broken card from taking down the page. */
export class CardBoundary extends Component<{ children: ReactNode; onRetry: () => void; title: string; eyebrow: string; id: string }, { err: boolean }> {
  state = { err: false };
  static getDerivedStateFromError() {
    return { err: true };
  }
  componentDidUpdate(prev: { children: ReactNode }) {
    if (this.state.err && prev.children !== this.props.children) {
      /* a new render may recover; retry is explicit */
    }
  }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <article className={`${styles.card} ${styles.cardHost}`} id={this.props.id} data-card={this.props.id}>
        <div className={styles.eb}>
          <span className={styles.t}>{this.props.eyebrow}</span>
          <span className={`${styles.badge} ${styles.info}`}>Error</span>
        </div>
        <h2 className={styles.ctitle}>{this.props.title}</h2>
        <div className={`${styles.empty} ${styles.errBox}`} role="alert">
          <h5>Couldn’t load this card</h5>
          <div className={styles.cact}>
            <button
              type="button"
              className={`${styles.btn} ${styles.pri}`}
              onClick={() => {
                this.setState({ err: false });
                this.props.onRetry();
              }}
            >
              Try again
            </button>
          </div>
        </div>
      </article>
    );
  }
}

export function InsightCard({
  card,
  model,
  index,
  count,
  topicLabel,
  openInit,
  onView,
  onFix,
  onRetry,
  linkFor,
}: {
  card: Card;
  model: CardModel;
  index: number;
  count: number;
  topicLabel: string;
  openInit: boolean;
  onView: (key: "m" | "s", value: string) => void;
  onFix: (fix: Fix) => void;
  onRetry: () => void;
  linkFor: (open: boolean) => string;
}) {
  const [open, setOpen] = useState(openInit);
  const [method, setMethod] = useState(false);
  const [copied, setCopied] = useState(false);
  const eyebrow = `${topicLabel} · ${index} of ${count}`;
  const st = model.state;
  const verdict: Verdict = st ? (st.kind === "err" ? "err" : st.kind === "pend" ? "pend" : "thin") : model.verdict;

  const copy = async () => {
    const url = linkFor(true);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt("Copy this link", url);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const head = (
    <>
      <div className={styles.eb}>
        <span className={styles.t}>{eyebrow}</span>
        <Badge verdict={verdict} text={st ? undefined : model.badgeText} />
      </div>
      <h2 className={styles.ctitle}>{card.title}</h2>
    </>
  );

  if (st) {
    return (
      <article className={`${styles.card} ${styles.cardHost} ${st.kind === "pend" ? styles.pendCard : ""}`} id={card.id} data-card={card.id}>
        {head}
        <p className={styles.scope}>
          <span>{model.scope.join(" · ")}</span>
          {model.pills.map((p) => (
            <span key={p.text} className={`${styles.mini} ${p.hot ? styles.hot : ""}`}>
              {p.text}
            </span>
          ))}
        </p>
        <div className={`${styles.empty} ${st.kind === "err" ? styles.errBox : ""}`} role="status">
          <h5>{st.title}</h5>
          <p>{st.text}</p>
          {st.fixes?.length ? (
            <div className={styles.cact}>
              {st.fixes.map((fx, i) => (
                <button key={fx.label} type="button" className={`${styles.btn} ${i === 0 ? styles.pri : styles.ghost}`} onClick={() => onFix(fx)}>
                  {fx.label}
                </button>
              ))}
            </div>
          ) : st.kind === "err" ? (
            <div className={styles.cact}>
              <button type="button" className={`${styles.btn} ${styles.pri}`} onClick={onRetry}>
                Try again
              </button>
            </div>
          ) : null}
        </div>
        <div style={{ height: 2 }} />
      </article>
    );
  }

  return (
    <article className={`${styles.card} ${styles.cardHost}`} id={card.id} data-card={card.id} aria-busy={model.async ? undefined : undefined}>
      {head}
      <p className={styles.hl}>{model.headline}</p>
      <p className={styles.scope}>
        <span>{model.scope.join(" · ")}</span>
        {model.pills.map((p) => (
          <span key={p.text} className={`${styles.mini} ${p.hot ? styles.hot : ""}`}>
            {p.text}
          </span>
        ))}
      </p>
      {model.how ? (
        <div className={styles.how}>
          <b>How to read</b>
          <span>{model.how}</span>
        </div>
      ) : null}
      {model.switches.length ? (
        <div className={styles.switches}>
          {model.switches.map((sw) => (
            <div className={styles.switchRow} key={sw.key}>
              {sw.label ? <span className={styles.switchLab}>{sw.label}</span> : null}
              <div className={styles.views} role="group" aria-label={sw.label ?? "View"}>
                {sw.options.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    disabled={o.disabled}
                    aria-pressed={sw.value === o.id}
                    className={sw.value === o.id ? styles.on : ""}
                    onClick={() => onView(sw.key, o.id)}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {model.body}
      <Legend keys={model.legend} />
      <PlayersMostAffected source={model.responders ?? { kind: "none" }} />
      <div className={styles.cfoot}>
        <button type="button" className={styles.disc} aria-expanded={open} aria-controls={`${card.id}-cav`} onClick={() => setOpen(!open)}>
          <span>
            Caveats &amp; sample<em>{model.sample}</em>
          </span>
          <i className={`${styles.chev} ${open ? styles.up : ""}`} />
        </button>
        {open ? (
          <div className={styles.cav} id={`${card.id}-cav`}>
            {model.facts.length ? (
              <div className={styles.facts}>
                {model.facts.map((fa) => (
                  <div className={styles.fact} key={fa.label}>
                    <b>{fa.value}</b>
                    <span>{fa.label}</span>
                  </div>
                ))}
              </div>
            ) : null}
            <div>
              <h4>Caveats</h4>
              <ul>
                {model.caveats.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
            {method && model.method ? (
              <p className={styles.methodTxt}>
                <b>Method</b>
                {model.method}
              </p>
            ) : null}
            <div className={styles.cact}>
              <button type="button" className={`${styles.btn} ${styles.small}`} onClick={copy}>
                Copy link to card
              </button>
              {model.method ? (
                <button type="button" className={`${styles.btn} ${styles.small} ${styles.ghost}`} aria-expanded={method} onClick={() => setMethod(!method)}>
                  Method
                </button>
              ) : null}
              {copied ? <span className={styles.copied} role="status">Link copied</span> : null}
            </div>
          </div>
        ) : null}
      </div>
    </article>
  );
}

export function ScanRow({ card, model, index, count, onOpen }: { card: Card; model: CardModel; index: number; count: number; onOpen: () => void }) {
  const verdict: Verdict = model.state ? (model.state.kind === "pend" ? "pend" : model.state.kind === "err" ? "err" : "thin") : model.verdict;
  const val = model.state ? "n/a" : model.scan.value;
  return (
    <button type="button" className={styles.scan} data-card={card.id} onClick={onOpen} aria-label={`Open ${card.title}`}>
      <Dot verdict={verdict} />
      <div>
        <div className={styles.st}>
          {index} of {count} · {card.title}
        </div>
        <div className={styles.sh}>{model.state ? model.state.title : model.headline}</div>
      </div>
      <div className={styles.sv}>
        {val}
        {!model.state && model.scan.unit ? <small>{model.scan.unit}</small> : null}
      </div>
    </button>
  );
}
