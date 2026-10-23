import type { TeamGame } from "@/lib/teamGames";
import { formatPlainDate } from "@/lib/dates";
import styles from "./SeasonChart.module.css";

const SCALE_MAX = 50;

function pct(n: number): string {
  return `${(n * 100).toFixed(4)}%`;
}

/** Axis ticks: 1, 20, 41, 62 and his last slot (scaled when the total isn't 82). */
function tickSlots(total: number): number[] {
  if (total <= 0) return [];
  const base = [1, 20, 41, 62].map((t) =>
    total === 82 ? t : Math.max(1, Math.round((t / 82) * total)),
  );
  return Array.from(new Set([...base.filter((t) => t < total), total]));
}

function slotLabel(g: TeamGame): string {
  const where =
    g.date && g.opp
      ? `${formatPlainDate(g.date)} ${g.homeAway === "home" ? "vs" : "at"} ${g.opp}`
      : null;
  if (g.status === "played")
    return `${where}: ${Math.round(g.pts ?? 0)} points`;
  if (g.status === "missed") return `${where}: out`;
  return "";
}

/**
 * Every slot of his season, left to right: played bars on a fixed 0–50 scale,
 * real 0 as a baseline marker, missed as a dash under the axis ("Out"),
 * scheduled and tbd as faint court ticks. Flat key-orange line at the season
 * average across the played range only. Cup final is one extra column after a gap.
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
  const regular = games.filter((g) => !g.isCupFinal);
  const cupFinal = games.find((g) => g.isCupFinal) ?? null;
  const total = Math.max(regular.length, slotTotal - (cupFinal ? 1 : 0));
  if (total === 0) return null;

  const slots: (TeamGame | null)[] = Array.from(
    { length: total },
    (_, i) => regular[i] ?? null,
  );
  const past = (g: TeamGame | null) =>
    !!g && (g.status === "played" || g.status === "missed");
  const lastPastIdx = slots.reduce((acc, g, i) => (past(g) ? i : acc), -1);
  const cupPast = past(cupFinal);
  const newestIsCup = cupPast;
  const pastCount = slots.filter(past).length + (cupPast ? 1 : 0);
  const playedCount =
    slots.filter((g) => g?.status === "played").length +
    (cupFinal?.status === "played" ? 1 : 0);
  const missedCount = pastCount - playedCount;

  const showLine = seasonAvg !== null && playedCount > 0 && lastPastIdx >= 0;
  const lineBottom = showLine ? Math.min(seasonAvg!, SCALE_MAX) / SCALE_MAX : 0;
  const lineWidth = (lastPastIdx + 1) / total;

  const summary = [
    `Season so far: ${playedCount} played, ${missedCount} out, ${total + (cupFinal ? 1 : 0) - pastCount} to come.`,
    showLine ? `Season average ${seasonAvg!.toFixed(1)}.` : "",
    [...slots, cupFinal]
      .filter(past)
      .map((g) => slotLabel(g!))
      .join("; "),
  ]
    .filter(Boolean)
    .join(" ");

  const column = (g: TeamGame | null, i: number, newest: boolean) => {
    const k = g?.slotKey ?? `empty-${i}`;
    if (!g || g.status === "scheduled" || g.status === "tbd") {
      return <div key={k} className={`${styles.col} ${styles.future}`} />;
    }
    if (g.status === "missed") {
      return (
        <div
          key={k}
          className={`${styles.col} ${styles.missed}${newest ? ` ${styles.newest}` : ""}`}
        />
      );
    }
    const pts = Math.round(g.pts ?? 0);
    const label = newest || pts > SCALE_MAX;
    const nw = newest ? ` ${styles.newest}` : "";
    return (
      <div key={k} className={styles.col}>
        {pts === 0 ? (
          <div className={`${styles.zero}${nw}`}>
            {label ? <span className={styles.pts}>0</span> : null}
          </div>
        ) : (
          <div
            className={`${styles.bar}${nw}`}
            style={{ height: pct(Math.min(pts, SCALE_MAX) / SCALE_MAX) }}
          >
            {label ? <span className={styles.pts}>{pts}</span> : null}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={styles.season}>
      <span className={styles.lab}>
        Season · {pastCount} of {total + (cupFinal ? 1 : 0)}
      </span>
      <div className={styles.frame} role="img" aria-label={summary}>
        <div className={styles.main}>
          <div
            className={styles.plot}
            style={{ gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }}
          >
            {slots.map((g, i) =>
              column(g, i, !newestIsCup && i === lastPastIdx),
            )}
            {showLine ? (
              <div
                className={styles.avg}
                style={{ bottom: pct(lineBottom), width: pct(lineWidth) }}
              >
                <span className={styles.avgLab}>
                  {seasonAvg!.toFixed(1)} avg
                </span>
              </div>
            ) : null}
          </div>
          <div className={styles.baseline} />
          <div
            className={styles.outs}
            style={{ gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }}
          >
            {slots.map((g, i) => (
              <span
                key={g?.slotKey ?? `empty-${i}`}
                className={g?.status === "missed" ? styles.outDash : undefined}
              />
            ))}
          </div>
          <div className={styles.ticks}>
            {tickSlots(total).map((t) => (
              <span
                key={t}
                className={styles.tick}
                style={{ left: pct((t - 0.5) / total) }}
              >
                {t}
              </span>
            ))}
          </div>
        </div>
        {cupFinal ? (
          <div className={styles.cup}>
            <div className={styles.plot}>
              {column(cupFinal, -1, newestIsCup)}
            </div>
            <div className={styles.baseline} />
            <div className={styles.outs}>
              <span
                className={
                  cupFinal.status === "missed" ? styles.outDash : undefined
                }
              />
            </div>
            <span className={styles.cupLab}>Cup final</span>
          </div>
        ) : null}
      </div>
      {missedCount > 0 ? (
        <p className={styles.key}>
          <span className={styles.keyDash} aria-hidden /> Out
        </p>
      ) : null}
    </div>
  );
}
