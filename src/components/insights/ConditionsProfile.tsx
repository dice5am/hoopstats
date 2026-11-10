"use client";

import { useEffect, useState } from "react";
import { PC_OUTCOMES, condShort, loadProfiles, profileRows, statusOf, unitOfOutcome, type ProfileRow } from "@/lib/insights/responders";
import type { PcProfilesFile } from "@/lib/playerConditionsTypes";
import { fmtN, sg } from "@/lib/insights/util";
import { BETTING_NOTE, PerPlayerEmpty, ROLE_NOTE, StatusBadge } from "./PlayersMostAffected";
import styles from "./insights.module.css";

const PROFILE_OUTCOMES = ["dev", "x150", "p10"];
const ROLE_CONDS = new Set(["out_top1", "vac_star", "vac_large", "vac_any"]);
const f = (v: number, o: string) => sg(v, o === "dev" ? 2 : 1);

function Row({ r, label, star }: { r: ProfileRow; label: string; star: boolean }) {
  const u = unitOfOutcome(r.outcome);
  const st = statusOf(r.verdict);
  return (
    <li className={styles.pmaRow}>
      <span className={styles.pmaName} style={{ textDecoration: "none" }}>
        {label}
      </span>
      <span className={styles.pmaVal}>
        {star ? f(r.league, r.outcome) : f(r.est, r.outcome)}
        <small>{u}</small>
      </span>
      <span className={styles.pmaMeta}>
        {star ? (
          <span>league effect (the whole league, not this player)</span>
        ) : (
          <>
            <span>vs league {f(r.vsLeague, r.outcome)}</span>
            <span>
              95% CI {f(r.lo, r.outcome)} to {f(r.hi, r.outcome)}
            </span>
            <span>
              n = {fmtN(Math.min(r.nCond, r.nRef))} (min side · {r.nCond} vs {r.nRef} games)
            </span>
            <span className={`${styles.mini} ${r.flag === "strong" ? styles.hot : ""}`}>{r.flag ?? "no flag"}</span>
            <span className={styles.mini}>held-out: {r.heldOut == null ? "not tested" : r.heldOut ? "yes" : "no"}</span>
          </>
        )}
        <StatusBadge status={st} />
      </span>
    </li>
  );
}

/** Player-page section: where this player is most and least affected (Data's player × condition table). */
export function ConditionsProfile({ playerId }: { playerId: string }) {
  const [file, setFile] = useState<PcProfilesFile | "err" | null>(null);
  const [out, setOut] = useState("dev");
  useEffect(() => {
    let ok = true;
    loadProfiles()
      .then((x) => ok && setFile(x))
      .catch(() => ok && setFile("err"));
    return () => {
      ok = false;
    };
  }, []);

  let inner: React.ReactNode;
  if (file === "err") inner = <p className={styles.pmaNone}>Couldn’t load the conditions profile.</p>;
  else if (!file) inner = <div className={styles.sk} style={{ height: 48 }} aria-busy="true" />;
  else {
    const p = file.players[playerId];
    if (!p) {
      inner = (
        <div className={styles.empty} role="status">
          <h5>Not enough games yet</h5>
          <p>A profile needs 15+ games on each side of a condition over 3 seasons at a prior average of 8+ PPG. 2026-27 rows are hidden: too few games per player so far.</p>
        </div>
      );
    } else {
      const all = profileRows(p.rows).filter((r) => r.outcome === out);
      const pos = all.filter((r) => r.side === "pos").sort((a, b) => a.rank - b.rank);
      const neg = all.filter((r) => r.side === "neg").sort((a, b) => a.rank - b.rank);
      const lab = (c: string) => condShort(file.conditions[c]?.label ?? c);
      const anyRole = all.some((r) => ROLE_CONDS.has(r.cond));
      inner = (
        <>
          <div className={styles.pmaTabs} role="group" aria-label="Outcome">
            {PC_OUTCOMES.filter((o) => PROFILE_OUTCOMES.includes(o.id)).map((o) => (
              <button key={o.id} type="button" aria-pressed={o.id === out} className={o.id === out ? styles.on : ""} onClick={() => setOut(o.id)}>
                {o.label}
              </button>
            ))}
          </div>
          {p.star ? (
            <div className={styles.empty} role="note">
              <h5>No player-specific pattern for stars</h5>
              <p>Among the top 100 scorers no condition shows a player-specific effect that holds in a later season, so we show league-level effects only. His own estimates are not shown as a trait.</p>
            </div>
          ) : null}
          {all.length === 0 ? (
            <p className={styles.pmaNone}>No condition has enough games on both sides for this outcome.</p>
          ) : (
            <div className={styles.pmaCols}>
              <div className={styles.pmaCol}>
                <h5>{p.star ? "Conditions furthest above the league" : "Most affected (above the league)"}</h5>
                <ul className={styles.pmaList}>{pos.map((r) => <Row key={`${r.cond}-p`} r={r} label={lab(r.cond)} star={p.star} />)}</ul>
              </div>
              <div className={styles.pmaCol}>
                <h5>{p.star ? "Conditions furthest below the league" : "Least affected (below the league)"}</h5>
                <ul className={styles.pmaList}>{neg.map((r) => <Row key={`${r.cond}-n`} r={r} label={lab(r.cond)} star={p.star} />)}</ul>
              </div>
            </div>
          )}
          <p className={styles.pmaNote}>
            Shrunk toward the league, 3 seasons 2023–26, {p.avail} conditions with 15+ games per side. Badges are the condition’s own verdict across all players, not a verdict on this player. {anyRole ? `${ROLE_NOTE} ` : ""}{BETTING_NOTE}
          </p>
        </>
      );
    }
  }
  return (
    <section className={styles.slot} aria-labelledby="cond-profile-h">
      <h3 id="cond-profile-h">Conditions profile</h3>
      {inner}
    </section>
  );
}

export { PerPlayerEmpty };
