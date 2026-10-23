import type { TeamGame } from "@/lib/teamGames";
import { formatPlainDate } from "@/lib/dates";
import styles from "./SeasonChart.module.css";

const SCALE_MAX = 50;
/** Empty cells before the Cup · TBD pair and before an undated Cup final. */
const GAP_CELLS = 2;

const pct = (n: number) => `${n.toFixed(4)}%`;
const frac = (pts: number) => (Math.min(pts, SCALE_MAX) / SCALE_MAX) * 100;

/** Ticks over the dated run only: 1, 20, 40, 60 and his last dated slot. */
function tickSlots(dated: number): number[] {
  if (dated <= 0) return [];
  return Array.from(
    new Set([...[1, 20, 40, 60].filter((t) => t < dated - 4), dated]),
  );
}

function slotLabel(g: TeamGame): string {
  const where =
    g.date && g.opp
      ? `${formatPlainDate(g.date)} ${g.homeAway === "home" ? "vs" : "at"} ${g.opp}`
      : g.date
        ? `${formatPlainDate(g.date)} Cup final`
        : "Cup final";
  if (g.status === "played")
    return `${where}: ${Math.round(g.pts ?? 0)} points`;
  if (g.status === "missed") return `${where}: out`;
  return "";
}

const isPast = (g: TeamGame | null): g is TeamGame =>
  !!g && (g.status === "played" || g.status === "missed");

type Cell = { ci: number; g: TeamGame | null; key: string };

/**
 * His whole season, one equal cell per slot on a fixed 0–50 scale. Dated run
 * first in date order (dated Cup games and a dated Cup final included), then
 * after a 2-cell gap the undated "Cup · TBD" pair, then (only if undated) the
 * Cup final after another 2-cell gap. Flat key-orange line at the season
 * average over game 1 → newest; its value lives in the header.
 */
export function SeasonChart({
  games,
  slotTotal,
  seasonAvg,
}: {
  games: TeamGame[];
  slotTotal: number;
  seasonAvg: number | null;
}) {
  const undatedFinal = games.find((g) => g.isCupFinal && !g.date) ?? null;
  const tbd = games.filter((g) => !g.isCupFinal && !g.date);
  const dated: (TeamGame | null)[] = games
    .filter((g) => !!g.date)
    .sort(
      (a, b) =>
        (a.date as string).localeCompare(b.date as string) || a.seq - b.seq,
    );
  // Never draw fewer than Data's slot_total (pads only if the file is short).
  const shortBy =
    slotTotal - dated.length - tbd.length - (undatedFinal ? 1 : 0);
  for (let k = 0; k < shortBy; k++) dated.push(null);
  const D = dated.length;
  const T = tbd.length;

  const cells: Cell[] = dated.map((g, i) => ({
    ci: i,
    g,
    key: g?.slotKey ?? `pad-${i}`,
  }));
  let c = D;
  const pairStart = T > 0 ? c + GAP_CELLS : null;
  if (pairStart !== null) {
    tbd.forEach((g, i) => cells.push({ ci: pairStart + i, g, key: g.slotKey }));
    c = pairStart + T;
  }
  const finalCell = undatedFinal ? c + GAP_CELLS : null;
  if (finalCell !== null) {
    cells.push({ ci: finalCell, g: undatedFinal, key: undatedFinal!.slotKey });
    c = finalCell + 1;
  }
  const C = c;
  if (C === 0) return null;

  const slotCount = cells.length;
  const all = cells.map((x) => x.g);
  const pastCount = all.filter(isPast).length;
  const playedCount = all.filter((g) => g?.status === "played").length;
  const missedCount = pastCount - playedCount;

  // Team hasn't played yet: no season chart, the last-5 block says "No games yet".
  if (pastCount === 0) return null;

  const pos = (ci: number) => (ci * 100) / C;
  const w = 100 / C;

  const lastPastIdx = dated.reduce((acc, g, i) => (isPast(g) ? i : acc), -1);
  const newestCi = lastPastIdx >= 0 ? lastPastIdx : null;

  const showAvg = seasonAvg !== null && playedCount > 0;
  const avgPct = showAvg ? frac(seasonAvg!) : null;

  // Traded tick: a team change between consecutive dated games.
  const trades: { ci: number; team: string }[] = [];
  let prevTeam: string | null = null;
  dated.forEach((g, i) => {
    if (!g?.team) return;
    if (prevTeam && g.team !== prevTeam) trades.push({ ci: i, team: g.team });
    prevTeam = g.team;
  });

  const datedFinals = cells.filter((x) => x.g?.isCupFinal && x.g.date);

  const summary = [
    `Season so far: ${playedCount} played, ${missedCount} out, ${slotCount - pastCount} to come.`,
    showAvg ? `Season average ${seasonAvg!.toFixed(1)}.` : "",
    all
      .filter(isPast)
      .map((g) => slotLabel(g))
      .join("; "),
  ]
    .filter(Boolean)
    .join(" ");

  const playedPct = (ci: number) => {
    const g = cells.find((x) => x.ci === ci)?.g;
    return g?.status === "played" ? frac(g.pts ?? 0) : null;
  };

  const column = ({ ci, g, key }: Cell) => {
    const place = { left: pct(pos(ci)), width: pct(w) };
    if (!g || g.status === "scheduled" || g.status === "tbd") {
      return (
        <div key={key} className={styles.col} style={place}>
          <div className={styles.future} />
        </div>
      );
    }
    const newest = ci === newestCi;
    const nw = newest ? ` ${styles.newest}` : "";
    if (g.status === "missed") {
      return (
        <div key={key} className={styles.col} style={place}>
          <div className={`${styles.outBox}${nw}`} />
        </div>
      );
    }
    const pts = Math.round(g.pts ?? 0);
    let label: React.ReactNode = null;
    if (newest || pts > SCALE_MAX) {
      // The number is wider than a column: its bottom clears the tallest
      // played bar within 2 cells either side by 4px. If that is below the
      // average or within var(--avg-clear) of the line, it sits above the line: line top edge (centre + 3px) plus
      // var(--avg-clear) (6px at 390, 8px at 1440).
      let top = 0;
      for (let j = ci - 2; j <= ci + 2; j++) {
        const h = playedPct(j);
        if (h !== null) top = Math.max(top, h);
      }
      const p = pos(ci);
      const align = p < 4 ? ` ${styles.ptsL}` : p > 95 ? ` ${styles.ptsR}` : "";
      // The newest number never sits closer to the line than --avg-clear,
      // including when its bar ties or barely tops the average.
      const bottom =
        newest && avgPct !== null
          ? `max(calc(${pct(top)} + 4px), calc(${pct(avgPct)} + 3px + var(--avg-clear)))`
          : `calc(${pct(top)} + 4px)`;
      label = (
        <span className={`${styles.pts}${align}`} style={{ bottom }}>
          {pts}
        </span>
      );
    }
    return (
      <div key={key} className={styles.col} style={place}>
        {pts === 0 ? (
          <div className={`${styles.zero}${nw}`} />
        ) : (
          <div
            className={`${styles.bar}${nw}`}
            style={{ height: pct(frac(pts)) }}
          />
        )}
        {label}
      </div>
    );
  };

  const sub =
    `Game ${pastCount} of ${slotCount}` +
    (playedCount !== pastCount ? ` · ${playedCount} played` : "");

  return (
    <div className={styles.season}>
      <div className={styles.head}>
        <span className={styles.lab}>2026-27 season · team games</span>
        {showAvg ? (
          <span className={styles.avgKey}>
            <i className={styles.avgRule} aria-hidden />
            {seasonAvg!.toFixed(1)} avg
          </span>
        ) : null}
      </div>
      <small className={styles.sub}>{sub}</small>
      <div className={styles.frame} role="img" aria-label={summary}>
        <div className={styles.markers} aria-hidden>
          {trades.map((t) => {
            const x = pos(t.ci);
            return (
              <span
                key={`tr-${t.ci}`}
                style={
                  x < 70
                    ? { left: `calc(${pct(x)} + 4px)` }
                    : { right: `calc(${pct(100 - x)} + 4px)` }
                }
              >
                Traded to {t.team}
              </span>
            );
          })}
          {datedFinals.map((x) => (
            <span key={`cf-${x.key}`} style={{ left: pct(pos(x.ci)) }}>
              Cup final
            </span>
          ))}
          {finalCell !== null ? (
            <span style={{ right: 0 }}>Cup final</span>
          ) : null}
          {pairStart !== null ? (
            <span style={{ right: pct(100 - pos(pairStart + T)) }}>
              Cup · TBD
            </span>
          ) : null}
        </div>
        <div className={styles.plot}>
          {[25, 50].map((v) => (
            <div
              key={`g${v}`}
              className={styles.gridline}
              style={{ bottom: `${v * 2}%` }}
            />
          ))}
          {[0, 25, 50].map((v) => (
            <span
              key={`a${v}`}
              className={styles.axis}
              style={{ bottom: `${v * 2}%` }}
              aria-hidden
            >
              {v}
            </span>
          ))}
          {cells.map(column)}
          {avgPct !== null && lastPastIdx >= 0 ? (
            <div
              className={styles.avg}
              style={{ bottom: pct(avgPct), width: pct(pos(lastPastIdx + 1)) }}
            />
          ) : null}
          {trades.map((t) => (
            <div
              key={`tl-${t.ci}`}
              className={styles.trade}
              style={{ left: pct(pos(t.ci)) }}
            />
          ))}
        </div>
        <div className={styles.baseline} />
        <div className={styles.under}>
          {cells
            .filter((x) => x.g?.status === "missed")
            .map((x) => (
              <i key={x.key} style={{ left: pct(pos(x.ci)), width: pct(w) }} />
            ))}
        </div>
        <div className={styles.ticks} aria-hidden>
          {tickSlots(D).map((t) => {
            const edge =
              t === 1
                ? ` ${styles.tickL}`
                : t === D && pairStart === null && finalCell === null
                  ? ` ${styles.tickR}`
                  : "";
            return (
              <span
                key={t}
                className={edge.trim() ? edge.trim() : undefined}
                style={{ left: pct(pos(t - 1) + w / 2) }}
              >
                {t}
              </span>
            );
          })}
        </div>
      </div>
      <div className={styles.legend} aria-hidden>
        <span>
          <i className={styles.lgPlayed} />
          Played
        </span>
        <span>
          <i className={styles.lgNew} />
          Newest
        </span>
        <span>
          <i className={styles.lgZero} />0 pts
        </span>
        <span>
          <i className={styles.lgOut} />
          Out
        </span>
        <span>
          <i className={styles.lgFut} />
          Not played yet
        </span>
        {showAvg ? (
          <span>
            <i className={styles.lgAvg} />
            Season avg
          </span>
        ) : null}
      </div>
    </div>
  );
}
