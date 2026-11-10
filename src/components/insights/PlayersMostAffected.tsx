"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { PcCell, PcRowsFile } from "@/lib/playerConditionsTypes";
import { PC_OUTCOMES, loadCondRows, setFromCondRows, statusOf, scaleOf, unitOfOutcome, type CondStatus, type ConditionsSource, type Responder, type ResponderSet, type ResponderSource } from "@/lib/insights/responders";
import { fmtN, sg } from "@/lib/insights/util";
import styles from "./insights.module.css";

export const EMPTY_TITLE = "Per-player data coming";
export const EMPTY_TEXT =
  "Which players respond most to this condition, with intervals and a held-out check, will appear here once the per-player table ships. Nothing is shown until then.";

export function PerPlayerEmpty({ compact = false }: { compact?: boolean }) {
  return (
    <div className={styles.empty} role="status">
      <h5>{EMPTY_TITLE}</h5>
      {compact ? null : <p>{EMPTY_TEXT}</p>}
    </div>
  );
}

const fmtEst = (r: Responder) => (r.unit === "ratio" ? `×${r.est.toFixed(2)}` : sg(r.est, r.unit === "pts" ? 2 : 1));
const fmtCi = (r: Responder) => {
  const d = r.unit === "ratio" ? 2 : r.unit === "pts" ? 2 : 1;
  return r.unit === "ratio" ? `${r.lo.toFixed(2)} to ${r.hi.toFixed(2)}` : `${sg(r.lo, d)} to ${sg(r.hi, d)}`;
};

export function RRow({ r }: { r: Responder }) {
  return (
    <li className={styles.pmaRow}>
      {r.href ? (
        <Link href={r.href} className={styles.pmaName}>
          {r.name}
        </Link>
      ) : (
        <span className={styles.pmaName}>{r.name}</span>
      )}
      <span className={styles.pmaVal}>
        {fmtEst(r)}
        {r.unit !== "ratio" ? <small>{r.unit}</small> : null}
      </span>
      <span className={styles.pmaMeta}>
        {r.vsLeague != null ? <span title="The player’s shrunk effect minus the league-wide effect for this condition">vs league {sg(r.vsLeague, r.unit === "pts" ? 2 : 1)}</span> : null}
        <span>95% CI {fmtCi(r)}</span>
        <span>n = {fmtN(r.n)} ({r.nLabel})</span>
        {r.flag ? <span className={`${styles.mini} ${r.flag === "strong" ? styles.hot : ""}`}>{r.flag}</span> : <span className={styles.mini}>no flag</span>}
        <span className={styles.mini} title="Persistence test on games the estimate did not use">
          held-out: {r.heldOut == null ? "not tested" : r.heldOut ? "yes" : "no"}
        </span>
      </span>
    </li>
  );
}

export function Lists({ set }: { set: ResponderSet }) {
  return (
    <>
      <div className={styles.pmaCols}>
        <div className={styles.pmaCol}>
          <h5>{set.labels?.[0] ?? "Most positive"}</h5>
          {set.positive.length ? (
            <ul className={styles.pmaList}>{set.positive.map((r) => <RRow key={r.id} r={r} />)}</ul>
          ) : (
            <p className={styles.pmaNone}>{set.labels ? "No rows for this view." : "No player above zero."}</p>
          )}
        </div>
        <div className={styles.pmaCol}>
          <h5>{set.labels?.[1] ?? "Most negative"}</h5>
          {set.negative.length ? (
            <ul className={styles.pmaList}>{set.negative.map((r) => <RRow key={r.id} r={r} />)}</ul>
          ) : (
            <p className={styles.pmaNone}>{set.labels ? "No rows for this view." : "No player below zero."}</p>
          )}
        </div>
      </div>
      {set.note ? <p className={styles.pmaNote}>{set.note}</p> : null}
    </>
  );
}

/** Reusable "Players most affected" block. Driven only by a ResponderSource (see lib/insights/responders.ts). */
export function PlayersMostAffected({ source }: { source: ResponderSource }) {
  return source.kind === "conditions" ? <ConditionResponders source={source} /> : <PlainBlock source={source} />;
}

function PlainBlock({ source }: { source: Exclude<ResponderSource, ConditionsSource> }) {
  const [res, setRes] = useState<{ key: string; set?: ResponderSet; err?: boolean }>({ key: "" });
  const key = source.kind === "async" ? source.key : "";
  useEffect(() => {
    if (source.kind !== "async") return;
    let live = true;
    source
      .load()
      .then((set) => live && setRes({ key: source.key, set }))
      .catch(() => live && setRes({ key: source.key, err: true }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  let inner;
  let cond: string | undefined;
  if (source.kind === "none") {
    inner = <PerPlayerEmpty />;
  } else if (source.kind === "na") {
    inner = <p className={styles.pmaNone}>{source.text}</p>;
  } else if (source.kind === "ready") {
    cond = source.set.condition;
    inner = <Lists set={source.set} />;
  } else if (res.key !== source.key) {
    inner = <div className={styles.sk} style={{ height: 40 }} aria-busy="true" />;
  } else if (res.err || !res.set) {
    inner = <p className={styles.pmaNone}>Couldn’t load per-player rows for this card.</p>;
  } else {
    cond = res.set.condition;
    inner = <Lists set={res.set} />;
  }
  return (
    <section className={styles.pma} aria-label="Players most affected">
      <div className={styles.pmaH}>
        <h4>Players most affected</h4>
        {cond ? <span>{cond}</span> : null}
      </div>
      {inner}
    </section>
  );
}

/* ───────── Data's player × condition table ───────── */
export const BETTING_NOTE = "Effects are measured against each player’s own average, not against betting lines, and are associated with a condition, never caused by it. Not a betting edge.";
export const ROLE_NOTE = "This effect depends on the player’s team and role (who the next option is when a scorer sits), so it isn’t a portable trait.";

const fmtV = (v: number, o: string) => (o === "dev" ? sg(v, 2) : sg(v, 1));

export function StatusBadge({ status }: { status: CondStatus }) {
  return (
    <span className={`${styles.stBadge} ${styles[`st_${status.id}`]}`} title={status.copy}>
      {status.label}
    </span>
  );
}

function Reliability({ cell, o, seg }: { cell: PcCell; o: string; seg: string }) {
  const u = unitOfOutcome(o);
  const sc = scaleOf(o);
  const lm = cell.lm != null ? fmtV(cell.lm * sc, o) : null;
  return (
    <div className={styles.pmaStats}>
      {cell.rel != null ? (
        <p>
          <b>Reliability {Math.round(cell.rel * 100)}%</b>: about {Math.round(cell.rel * 100)}% of a player’s raw gap is signal, the rest is noise.
          {cell.tau != null ? ` Spread between players (tau) ${(cell.tau * sc).toFixed(o === "dev" ? 2 : 1)} ${u}` : ""}
          {lm ? `, league effect ${lm} ${u}.` : "."}
        </p>
      ) : null}
      {cell.tr[0] != null ? (
        <p>
          Across seasons: correlation {sg(cell.tr[0] as number, 2)} ({sg(cell.tr[1] as number, 2)} to {sg(cell.tr[2] as number, 2)}) over {fmtN(cell.tr[3] as number)} players
          {cell.slope != null ? `, calibration slope ${cell.slope.toFixed(2)} (1 = fully carries over, 0 = noise)` : ""}.
        </p>
      ) : seg === "all" || seg === "top100" || seg === "top50" ? (
        <p>Across seasons: not tested (too few players with 10+ games on both sides in two periods).</p>
      ) : null}
      {cell.expStrong != null ? (
        <p>
          <b>
            Flagged vs the league: {cell.strong} strong + {cell.watch} watch
          </b>
          , expected by chance {cell.expStrong.toFixed(2)} + {(cell.expWatch ?? 0).toFixed(2)}.
          {cell.fl[0] != null ? ` In the 2023-25 → 2025-26 test, ${cell.fl[0]} were flagged; significance repeated for ${cell.fl[1] ?? 0}${cell.fl[2] != null ? `, direction repeated for ${Math.round((cell.fl[2] as number) * 100)}%` : ""}.` : ""}
        </p>
      ) : null}
    </div>
  );
}

const ROLE_CONDS = new Set(["out_top1", "vac_star", "vac_large", "vac_any"]);

function ConditionResponders({ source }: { source: ConditionsSource }) {
  const [cond, setCond] = useState(source.conds[0]);
  const [out, setOut] = useState("dev");
  const [file, setFile] = useState<PcRowsFile | "err" | null>(null);
  const live = source.conds.includes(cond) ? cond : source.conds[0];
  const hidden = source.ts === "2026_27";
  const thinSeg = source.seg === "top25" || source.seg === "top10";
  useEffect(() => {
    if (hidden || thinSeg) return;
    let ok = true;
    setFile(null);
    loadCondRows(source.seg)
      .then((f) => ok && setFile(f))
      .catch(() => ok && setFile("err"));
    return () => {
      ok = false;
    };
  }, [source.seg, hidden, thinSeg]);

  const outcomes = PC_OUTCOMES.filter((o) => source.stats[`${live}|${o.id}`]);
  const o = outcomes.some((x) => x.id === out) ? out : (outcomes[0]?.id ?? "dev");
  const cell = source.stats[`${live}|${o}`];
  const status = cell ? statusOf(cell.verdict) : null;
  const label = source.labels[live] ?? live;
  const top = source.lead ? 10 : 3;

  let inner: React.ReactNode;
  if (hidden) {
    inner = <p className={styles.pmaNone}>Player rows are hidden for 2026-27: players have too few games on each side of any condition yet. Per-player rows use 3 seasons pooled.</p>;
  } else if (thinSeg) {
    inner = <p className={styles.pmaNone}>Top 25 and Top 10 are always too small for player rows. Counts only.</p>;
  } else if (!cell) {
    inner = <p className={styles.pmaNone}>This condition has no cell for the selected segment: too few players to test.</p>;
  } else if (file === "err") {
    inner = <p className={styles.pmaNone}>Couldn’t load per-player rows for this card.</p>;
  } else if (!file) {
    inner = <div className={styles.sk} style={{ height: 40 }} aria-busy="true" />;
  } else {
    const rows = file.cells[`${live}|${o}`];
    const set: ResponderSet = setFromCondRows(live, o, label, cell, rows, top);
    inner = (
      <>
        {status ? (
          <div className={styles.pmaStatus}>
            <StatusBadge status={status} />
            <span>{status.copy}</span>
          </div>
        ) : null}
        {set.positive.length || set.negative.length ? (
          <>
            {!cell.rankOk ? <p className={styles.pmaNote}>Ranking not meaningful for this cell: estimates sit at the league effect, so read the intervals, not the order.</p> : null}
            <Lists set={set} />
          </>
        ) : (
          <p className={styles.pmaNone}>Too few players for a ranked list in this cell.</p>
        )}
        <Reliability cell={cell} o={o} seg={source.seg} />
        <p className={styles.pmaNote}>{ROLE_CONDS.has(live) ? `${ROLE_NOTE} ` : ""}{BETTING_NOTE}</p>
      </>
    );
  }
  return (
    <section className={styles.pma} aria-label="Players most affected" data-pma="conditions">
      <div className={styles.pmaH}>
        <h4>Players most affected</h4>
        <span>3 seasons 2023–26 · vs his own average</span>
      </div>
      {source.conds.length > 1 ? (
        <div className={styles.pmaTabs} role="group" aria-label="Condition">
          {source.conds.map((c) => (
            <button key={c} type="button" aria-pressed={c === live} className={c === live ? styles.on : ""} onClick={() => setCond(c)}>
              {source.labels[c] ?? c}
            </button>
          ))}
        </div>
      ) : (
        <p className={styles.pmaCond}>{label}</p>
      )}
      {!hidden && !thinSeg && outcomes.length > 1 ? (
        <div className={styles.pmaTabs} role="group" aria-label="Outcome">
          {outcomes.map((x) => (
            <button key={x.id} type="button" aria-pressed={x.id === o} className={x.id === o ? styles.on : ""} onClick={() => setOut(x.id)}>
              {x.label}
            </button>
          ))}
        </div>
      ) : null}
      {inner}
    </section>
  );
}
