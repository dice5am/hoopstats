import type { ReactNode } from "react";
import type { BnContextCell } from "@/lib/bigNightsTypes";
import { fmtN, pctS } from "@/lib/insights/util";
import styles from "../insights.module.css";

export function Note({ children }: { children: ReactNode }) {
  return <p className={styles.bnNote}>{children}</p>;
}

export function Sub({ children }: { children: ReactNode }) {
  return <h5 className={styles.subh}>{children}</h5>;
}

/** Plain two-value comparison table (e.g. season average vs last 10). Values arrive pre-formatted. */
export function CompareTable({ head, rows }: { head: [string, string, string]; rows: [string, string, string][] }) {
  return (
    <div className={styles.heatWrap}>
      <table className={styles.heat}>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={h} scope="col" style={i === 0 ? { textAlign: "left" } : undefined}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r[0]}>
              <th scope="row">{r[0]}</th>
              <td>{r[1]}</td>
              <td>{r[2]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Three shares of the same-game excess, drawn as one bar. Neutral tans only: this is not an effect. */
export function ShareBar({ parts }: { parts: { label: string; v: number }[] }) {
  return (
    <div role="group" aria-label="Shares of the excess points">
      <div className={styles.bnShare}>
        {parts.map((p, i) => (
          <div key={p.label} className={styles[`s${i + 1}`]} style={{ flex: `${Math.max(p.v, 0.02)} 1 0` }}>
            {Math.round(p.v * 100)}%
          </div>
        ))}
      </div>
      <div className={styles.bnShareKey}>
        {parts.map((p) => (
          <span key={p.label}>
            <b>{pctS(p.v, 0)}</b>
            {p.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export function Tiles({ tiles }: { tiles: { big: string; label: string; sub?: string }[] }) {
  return (
    <div className={styles.bnTiles}>
      {tiles.map((t) => (
        <div className={styles.bnTile} key={t.label}>
          <b>{t.big}</b>
          <span>{t.label}</span>
          {t.sub ? <i>{t.sub}</i> : null}
        </div>
      ))}
    </div>
  );
}

/** Base rate by prior-average tier × teammates out. Cells under Data's floor are hatched, never read. */
export function ContextTable({ cells, tiers, ev }: { cells: BnContextCell[]; tiers: string[]; ev: "x150" | "p10" }) {
  const vacs = Array.from(new Set(cells.map((c) => c.vac)));
  const get = (t: string, v: string) => cells.find((c) => c.tier === t && c.vac === v);
  const max = Math.max(...cells.filter((c) => !c.thin).map((c) => c[ev].r ?? 0), 0.01);
  return (
    <div className={styles.heatWrap}>
      <table className={styles.heat}>
        <thead>
          <tr>
            <th scope="col" style={{ textAlign: "left" }}>
              Prior avg ↓ · teammates out →
            </th>
            {vacs.map((v) => (
              <th key={v} scope="col">
                {v}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tiers.map((t) => (
            <tr key={t}>
              <th scope="row">{t}</th>
              {vacs.map((v) => {
                const c = get(t, v);
                if (!c || c.thin || c[ev].r == null) {
                  return (
                    <td key={v} className={styles.hatchCell} title="Under 30 players or 300 player-games: not read">
                      too few
                      <small>{c ? `n = ${fmtN(c.n)}` : ""}</small>
                    </td>
                  );
                }
                const r = c[ev];
                return (
                  <td key={v} title={`95% interval ${pctS(r.lo ?? 0)} to ${pctS(r.hi ?? 0)}`}>
                    {pctS(r.r!, 0)}
                    <span className={styles.bnMini} style={{ width: `${Math.round((r.r! / max) * 28)}px` }} aria-hidden="true" />
                    <small>n {fmtN(c.n)}</small>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
