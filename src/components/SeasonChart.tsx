import { tradeTicks, type TeamGame } from "@/lib/teamGames";
import { formatPlainDate } from "@/lib/dates";
import styles from "./SeasonChart.module.css";

const SCALE_MAX = 50;
/** Empty cells before the Cup · TBD pair. */
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
  const where = g.date
    ? `${formatPlainDate(g.date)}${g.opp ? ` ${g.homeAway === "home" ? "vs" : "at"} ${g.opp}` : ""}`
    : "TBD";
  if (g.status === "played")
    return `${where}: ${Math.round(g.pts ?? 0)} points`;
  if (g.status === "missed") return `${where}: out`;
  return "";
}

const isPast = (g: TeamGame | null): g is TeamGame =>
  !!g && (g.status === "played" || g.status === "missed");

type Cell = { ci: number; g: TeamGame | null; key: string };

/**
 * His whole regular season, one equal cell per slot on a fixed 0–50 scale.
 * Dated run first in date order (dated Cup group/knockout games sit in date
 * order like any game), then after a 2-cell gap the undated "Cup · TBD" pair.
 * The NBA Cup final is never a slot (the loader drops it). Flat key-orange
 * line at the season average over game 1 → newest; its value lives in the
 * header.
 *
 * `complete`: a finished past season — no newest highlight (numbers only over
 * 50), no future/tbd slots, sub-header "{n} games · {played} played".
 * `not_on_team` slots (before/after his stint) are empty cells with only a
 * faint court tick under the axis; they count toward the slot total, never
 * as missed. The average line spans first → last played slot; trade ticks
 * follow Data's `trade_marker` when present.
 */
export function SeasonChart({
  title,
  games,
  slotTotal,
  seasonAvg,
  complete = false,
  explicitTrades = false,
}: {
  title: string;
  games: TeamGame[];
  slotTotal: number;
  seasonAvg: number | null;
  complete?: boolean;
  /** Data shipped a per-player trade list: draw only those markers. */
  explicitTrades?: boolean;
}) {
  // A completed season has nothing still to come: drop any future/tbd rows.
  const rows = complete
    ? games.filter((g) => g.status !== "scheduled" && g.status !== "tbd")
    : games;
  const tbd = rows.filter((g) => !g.date);
  const dated: (TeamGame | null)[] = rows
    .filter((g) => !!g.date)
    .sort(
      (a, b) =>
        (a.date as string).localeCompare(b.date as string) || a.seq - b.seq,
    );
  // Never draw fewer than Data's slot_total (pads only if the file is short).
  const shortBy = slotTotal - dated.length - tbd.length;
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
  const C = c;
  if (C === 0) return null;

  const slotCount = cells.length;
  const all = cells.map((x) => x.g);
  const pastCount = all.filter(isPast).length;
  const playedCount = all.filter((g) => g?.status === "played").length;
  const missedCount = pastCount - playedCount;
  const notOnCount = all.filter((g) => g?.status === "not_on_team").length;

  // Team hasn't played yet: no season chart, the last-5 block says "No games yet".
  if (pastCount === 0) return null;

  const pos = (ci: number) => (ci * 100) / C;
  const w = 100 / C;

  const lastPastIdx = dated.reduce((acc, g, i) => (isPast(g) ? i : acc), -1);
  // Complete season: the line spans his played range only (first → last
  // played slot), so Not on team stretches before/after stay bare.
  const playedIdx = dated
    .map((g, i) => (g?.status === "played" ? i : -1))
    .filter((i) => i >= 0);
  const avgFrom = complete ? (playedIdx[0] ?? 0) : 0;
  const avgTo = complete ? (playedIdx.at(-1) ?? -1) + 1 : lastPastIdx + 1;
  const newestCi = !complete && lastPastIdx >= 0 ? lastPastIdx : null;

  const showAvg = seasonAvg !== null && playedCount > 0;
  const avgPct = showAvg ? frac(seasonAvg!) : null;

  // Traded ticks: Data's trade markers (list-form or per-slot) when the
  // file has them; otherwise a team change between consecutive dated slots.
  const trades = tradeTicks(dated, complete, explicitTrades);
  // A finished season with an entry but no played game: every slot Out, no
  // line, and the key reads a dim n/a (never 0.0).
  const allOut = complete && playedCount === 0;

  const notOnText = notOnCount > 0 ? `, ${notOnCount} not on team` : "";
  const summary = [
    complete
      ? `Season: ${slotCount} games, ${playedCount} played, ${missedCount} out${notOnText}.`
      : `Season so far: ${playedCount} played, ${missedCount} out${notOnText}, ${slotCount - pastCount - notOnCount} to come.`,
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
    // Not on team (or a pad in a completed season): empty cell; its faint
    // court tick is drawn under the axis.
    if (g?.status === "not_on_team" || (!g && complete)) {
      return <div key={key} className={styles.col} style={place} />;
    }
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

  const sub = complete
    ? `${slotCount} games · ${playedCount} played`
    : `Game ${pastCount} of ${slotCount}` +
      (playedCount !== pastCount ? ` · ${playedCount} played` : "");

  return (
    <div
      className={`${styles.season}${complete ? ` ${styles.complete}` : ""}`}
    >
      <div className={styles.head}>
        <span className={styles.lab}>{title}</span>
        {showAvg ? (
          <span className={styles.avgKey}>
            <i className={styles.avgRule} aria-hidden />
            {seasonAvg!.toFixed(1)} avg
          </span>
        ) : allOut ? (
          <span className={styles.avgKey}>
            <span className={styles.avgNa}>n/a</span> avg
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
          {avgPct !== null && avgTo > avgFrom ? (
            <div
              className={styles.avg}
              style={{
                bottom: pct(avgPct),
                left: pct(pos(avgFrom)),
                width: pct(pos(avgTo) - pos(avgFrom)),
              }}
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
          {cells
            .filter(
              (x) =>
                x.g?.status === "not_on_team" || (complete && x.g === null),
            )
            .map((x) => (
              <span
                key={x.key}
                className={styles.notOn}
                style={{ left: pct(pos(x.ci)), width: pct(w) }}
              />
            ))}
        </div>
        <div className={styles.ticks} aria-hidden>
          {tickSlots(D).map((t) => {
            const edge =
              t === 1
                ? ` ${styles.tickL}`
                : t === D && pairStart === null
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
        {complete ? null : (
          <span>
            <i className={styles.lgNew} />
            Newest
          </span>
        )}
        {allOut ? null : (
          <span>
            <i className={styles.lgZero} />0 pts
          </span>
        )}
        <span>
          <i className={styles.lgOut} />
          Out
        </span>
        {notOnCount > 0 ? (
          <span>
            <i className={styles.lgNotOn} />
            Not on team
          </span>
        ) : null}
        {complete ? null : (
          <span>
            <i className={styles.lgFut} />
            Not played yet
          </span>
        )}
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

/**
 * A season chart whose slots are still loading (or failed to load): same
 * box as the drawn chart so nothing shifts when it lands. Title, an empty
 * maple plot, the axis line and only the "1" tick; the sub-line, avg key
 * and legend hold their space invisibly. Loading: the axis line pulses
 * (after ~150ms, none under reduced motion). Failed: one line in the plot
 * with a Retry button.
 */
export function SeasonChartPending({
  title,
  complete = false,
  failed = false,
  onRetry,
  avgKey,
  notOn,
  played,
}: {
  title: string;
  complete?: boolean;
  failed?: boolean;
  onRetry?: () => void;
  /** The drawn chart will have an avg key in its header. */
  avgKey: boolean;
  /** The drawn chart's legend will have "Not on team". */
  notOn: boolean;
  /** He has a played game (legend keeps "0 pts" / "Season avg"). */
  played: boolean;
}) {
  const allOut = complete && !played;
  return (
    <div
      className={`${styles.season} ${styles.pending}${complete ? ` ${styles.complete}` : ""}${failed ? ` ${styles.failed}` : ""}`}
      aria-busy={!failed}
    >
      <div className={styles.head}>
        <span className={styles.lab}>{title}</span>
        {avgKey ? (
          <span className={`${styles.avgKey} ${styles.hold}`} aria-hidden>
            <i className={styles.avgRule} />
            00.0 avg
          </span>
        ) : null}
      </div>
      <small className={`${styles.sub} ${styles.hold}`} aria-hidden>
        82 games · 0 played
      </small>
      <div className={styles.frame}>
        <div className={styles.markers} aria-hidden />
        <div className={styles.plot}>
          {failed ? (
            <p className={styles.failMsg} role="status">
              Couldn&rsquo;t load games ·{" "}
              <button
                type="button"
                className={styles.retry}
                onClick={onRetry}
                disabled={!onRetry}
              >
                Retry
              </button>
            </p>
          ) : (
            <span className={styles.srOnly} role="status">
              Loading games
            </span>
          )}
        </div>
        <div className={`${styles.baseline} ${styles.pulse}`} aria-hidden />
        <div className={styles.under} aria-hidden />
        <div className={styles.ticks} aria-hidden>
          <span className={styles.tickL} style={{ left: "0.6%" }}>
            1
          </span>
        </div>
      </div>
      <div className={`${styles.legend} ${styles.hold}`} aria-hidden>
        <span>
          <i className={styles.lgPlayed} />
          Played
        </span>
        {complete ? null : (
          <span>
            <i className={styles.lgNew} />
            Newest
          </span>
        )}
        {allOut ? null : (
          <span>
            <i className={styles.lgZero} />0 pts
          </span>
        )}
        <span>
          <i className={styles.lgOut} />
          Out
        </span>
        {notOn ? (
          <span>
            <i className={styles.lgNotOn} />
            Not on team
          </span>
        ) : null}
        {complete ? null : (
          <span>
            <i className={styles.lgFut} />
            Not played yet
          </span>
        )}
        {played && avgKey ? (
          <span>
            <i className={styles.lgAvg} />
            Season avg
          </span>
        ) : null}
      </div>
    </div>
  );
}
