import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  chartCells,
  LABEL_METRICS_390,
  layoutTradeLabels,
  MARKER_BAND_ROWS,
  mergedText,
  tradeTicks,
  TICK_PAD_PX,
  SOURCE_NOTE_TEXT,
  type LabelMetrics,
  type SourceNote,
  type ChartCell,
  type TeamGame,
} from "@/lib/teamGames";
import { formatPlainDate } from "@/lib/dates";
import styles from "./SeasonChart.module.css";

const SCALE_MAX = 50;

/** Each stacked label row adds 15px above the 16px marker row. */
const ROW_PX = 15;
/** Fixed band: any drawn tick reserves MARKER_BAND_ROWS rows; none keeps the plain row. */
const markerBandStyle = (hasMarkers: boolean) =>
  hasMarkers
    ? ({
        "--band-rows": MARKER_BAND_ROWS - 1,
      } as React.CSSProperties)
    : undefined;

const useIsoLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Same split as the band height and the 6px/8px gap: <1000px is the narrow (390) chart. */
const WIDE_QUERY = "(min-width: 1000px)";

type Measured = {
  plotPx: number;
  gapPx: number;
  narrow: boolean;
  padPx: number;
  widths: Record<string, number>;
};

/**
 * Every string a label can show on this chart: full and short wording, and
 * each exit merged with the join right after it (narrow overflow). All are
 * measured, so the layout can pick wording and merges on real widths.
 */
function labelCandidates(
  trades: { kind: "join" | "exit"; text: string; short: string }[],
): string[] {
  const out = new Set<string>();
  trades.forEach((t, i) => {
    out.add(t.text);
    out.add(t.short);
    const next = trades[i + 1];
    if (t.kind === "exit" && next?.kind === "join") {
      out.add(mergedText(t.short, next.short));
    }
  });
  return [...out];
}

/**
 * Real label metrics for the stacking rule: the marker band's width, the
 * breakpoint (6px/8px gap, short wording below 1000px), the maple pad and
 * each candidate label's text width (hidden measuring spans with the label
 * CSS). Measured before paint (and on resize), so the first visible frame is
 * already laid out; the band height is fixed, so re-layout never shifts the
 * page.
 */
function useLabelMetrics(
  band: React.RefObject<HTMLDivElement | null>,
  active: boolean,
  dep: string,
): LabelMetrics {
  const [m, setM] = useState<Measured | null>(null);
  useIsoLayoutEffect(() => {
    const el = band.current;
    if (!active || !el) return;
    const measure = () => {
      const widths: Record<string, number> = {};
      let padPx = 0;
      el.querySelectorAll<HTMLElement>("span[data-measure]").forEach((sp) => {
        padPx = parseFloat(getComputedStyle(sp).paddingLeft) || 0;
        widths[sp.textContent ?? ""] = sp.getBoundingClientRect().width - 2 * padPx;
      });
      const wide = window.matchMedia(WIDE_QUERY).matches;
      const next: Measured = {
        plotPx: el.getBoundingClientRect().width,
        gapPx: wide ? 8 : 6,
        narrow: !wide,
        padPx,
        widths,
      };
      setM((prev) =>
        prev &&
        Math.abs(prev.plotPx - next.plotPx) < 0.5 &&
        prev.gapPx === next.gapPx &&
        prev.narrow === next.narrow &&
        prev.padPx === next.padPx &&
        Object.keys(next.widths).every(
          (k) => Math.abs((prev.widths[k] ?? -1) - next.widths[k]) < 0.5,
        )
          ? prev
          : next,
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [active, dep]);
  return useMemo(
    () =>
      m
        ? {
            plotPx: m.plotPx,
            gapPx: m.gapPx,
            narrow: m.narrow,
            padPx: m.padPx,
            widthPx: (t: string) => m.widths[t] ?? LABEL_METRICS_390.widthPx(t),
          }
        : LABEL_METRICS_390,
    [m],
  );
}

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

type Cell = ChartCell;

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
  sourceNote,
}: {
  title: string;
  games: TeamGame[];
  slotTotal: number;
  seasonAvg: number | null;
  complete?: boolean;
  /** Data shipped a per-player trade list: draw only those markers. */
  explicitTrades?: boolean;
  /** 2025-26 source footnote from the page index (`shape.prev.sourceNote`). */
  sourceNote?: SourceNote;
}) {
  const { dated, cells, D, T, pairStart, C } = chartCells(
    games,
    slotTotal,
    complete,
  );
  // Stint ticks: joins from Data's trade markers (list-form or per-slot),
  // else a team change; exits from Data's exit_marker (known reasons only).
  // Joins and exits share one label-row stack.
  const trades = tradeTicks(dated, complete, explicitTrades);
  const hasMarkers = trades.length > 0;
  const candidates = labelCandidates(trades);
  const bandRef = useRef<HTMLDivElement>(null);
  const metrics = useLabelMetrics(bandRef, hasMarkers, candidates.join("|"));
  const { labels, ticks: markerTicks } = layoutTradeLabels(trades, C, metrics);
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
          <span className={`${styles.avgKey} ${styles.avgNa}`}>n/a</span>
        ) : null}
      </div>
      <small className={styles.sub}>{sub}</small>
      <div className={styles.frame} role="img" aria-label={summary}>
        <div
          ref={bandRef}
          className={`${styles.markers}${hasMarkers ? ` ${styles.band}` : ""}`}
          style={markerBandStyle(hasMarkers)}
          aria-hidden
        >
          {labels.map((t, i) => {
            const x = pos(t.ci);
            // Text starts (right side) or ends (left side) TICK_PAD_PX from
            // its tick; the maple pad's negative margins keep it there.
            const at =
              t.pin === "end"
                ? { right: "var(--label-pad)" }
                : t.pin === "start"
                  ? { left: "var(--label-pad)" }
                  : t.side === "right"
                    ? { left: `calc(${pct(x)} + ${TICK_PAD_PX}px)` }
                    : { right: `calc(${pct(100 - x)} + ${TICK_PAD_PX}px)` };
            return (
              <span
                key={`tr-${t.kind}-${t.ci}-${i}`}
                data-stint={t.kind}
                data-merged={t.merged ? "" : undefined}
                style={{
                  ...at,
                  ...(t.row ? { bottom: `${2 + t.row * ROW_PX}px` } : {}),
                }}
              >
                {t.text}
              </span>
            );
          })}
          {hasMarkers
            ? candidates.map((c) => (
                <span key={`m-${c}`} data-stint="measure" data-measure="">
                  {c}
                </span>
              ))
            : null}
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
          {markerTicks.map((t, i) => (
            <div
              key={`tl-${t.kind}-${t.ci}-${i}`}
              className={styles.trade}
              data-row={t.row ?? undefined}
              style={{
                left: pct(pos(t.ci)),
                // Labelled: 1px into its label's maple pad (under the
                // knockout), so no gap at either width; the pad's bottom edge
                // sits (2px - pad-y) above the row baseline. A join merged
                // into its exit's label keeps a short tick with no label.
                top:
                  t.row === null
                    ? "calc(var(--plot-gap) / -2)"
                    : `calc(-1 * (var(--plot-gap) + ${3 + t.row * ROW_PX}px - var(--label-pad-y)))`,
              }}
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
      <Legend
        complete={complete}
        allOut={allOut}
        notOn={notOnCount > 0}
        showAvg={showAvg}
      />
      <SourceFootnote note={sourceNote} />
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
  hasMarkers = false,
  sourceNote,
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
  /** The drawn chart has stint ticks (page index `hasMarkers`) → reserve the band. */
  hasMarkers?: boolean;
  /** The drawn chart has a source footnote → hold its line (loading and failed). */
  sourceNote?: SourceNote;
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
        <div
          className={`${styles.markers}${hasMarkers ? ` ${styles.band}` : ""}`}
          style={markerBandStyle(hasMarkers)}
          aria-hidden
        />
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
      <Legend
        hold
        complete={complete}
        allOut={allOut}
        notOn={notOn}
        showAvg={played && avgKey}
      />
      <SourceFootnote hold note={sourceNote} />
    </div>
  );
}

/**
 * One line under the 2025-26 legend naming a non-default row source. Text
 * lives in SOURCE_NOTE_TEXT, style in `.sourceNote`. `hold`: the pending
 * frame keeps the line's box, invisible, so nothing shifts when it lands.
 */
function SourceFootnote({
  note,
  hold = false,
}: {
  note?: SourceNote;
  hold?: boolean;
}) {
  if (!note) return null;
  return (
    <p
      className={`${styles.sourceNote}${hold ? ` ${styles.hold}` : ""}`}
      data-source-note={note}
      aria-hidden={hold || undefined}
    >
      {SOURCE_NOTE_TEXT[note]}
    </p>
  );
}

/** Legend. A finished season with no played game shows only "Out". */
function Legend({
  complete,
  allOut,
  notOn,
  showAvg,
  hold = false,
}: {
  complete: boolean;
  allOut: boolean;
  notOn: boolean;
  showAvg: boolean;
  hold?: boolean;
}) {
  const out = (
    <span>
      <i className={styles.lgOut} />
      Out
    </span>
  );
  return (
    <div
      className={`${styles.legend}${hold ? ` ${styles.hold}` : ""}`}
      aria-hidden
    >
      {allOut ? (
        <>
          {out}
          {notOn ? (
            <span>
              <i className={styles.lgNotOn} />
              Not on team
            </span>
          ) : null}
        </>
      ) : (
        <>
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
          <span>
            <i className={styles.lgZero} />0 pts
          </span>
          {out}
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
          {showAvg ? (
            <span>
              <i className={styles.lgAvg} />
              Season avg
            </span>
          ) : null}
        </>
      )}
    </div>
  );
}
