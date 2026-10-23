import type { TeamGame } from "@/lib/teamGames";
import { formatPlainDate } from "@/lib/dates";
import styles from "./SeasonChart.module.css";

const SCALE_MAX = 50;
const GAP = "10px";

function pct(n: number): string {
  return `${(n * 100).toFixed(4)}%`;
}

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
      : "Cup final";
  if (g.status === "played")
    return `${where}: ${Math.round(g.pts ?? 0)} points`;
  if (g.status === "missed") return `${where}: out`;
  return "";
}

const isPast = (g: TeamGame | null) =>
  !!g && (g.status === "played" || g.status === "missed");

/**
 * His whole season, one column per slot on a fixed 0–50 scale. Dated run
 * first (played bar, real-0 marker, missed = dash under the axis, scheduled =
 * faint court tick), then after a gap the undated Cup pair ("Cup · TBD"),
 * then the Cup final column if his team reaches it. Flat key-orange line at
 * the season average over the played range; its label lives in the header.
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
  const cupFinal = games.find((g) => g.isCupFinal) ?? null;
  // Only games with no date sit in the Cup · TBD pair; any game with a date
  // takes its place in date order on the dated run.
  const tbd = games.filter((g) => !g.isCupFinal && !g.date);
  const dated: (TeamGame | null)[] = games
    .filter((g) => !g.isCupFinal && !!g.date)
    .sort(
      (a, b) =>
        (a.date as string).localeCompare(b.date as string) || a.seq - b.seq,
    );
  // Never draw fewer than Data's slot_total (pads only if the file is short).
  const shortBy = slotTotal - dated.length - tbd.length - (cupFinal ? 1 : 0);
  for (let k = 0; k < shortBy; k++) dated.push(null);
  const D = dated.length;
  const T = tbd.length;
  if (D + T + (cupFinal ? 1 : 0) === 0) return null;

  // Grid tracks: dated run | gap | TBD pair | gap | Cup final.
  const tracks = [`repeat(${D}, minmax(0, 1fr))`];
  const tbdStart = D + 2; // 1-based grid line after the gap track
  if (T > 0) tracks.push(GAP, `repeat(${T}, minmax(0, 1fr))`);
  const cupCol = D + (T > 0 ? T + 1 : 0) + 2;
  if (cupFinal) tracks.push(GAP, "minmax(0, 1fr)");
  const template = { gridTemplateColumns: tracks.join(" ") };

  const lastPastIdx = dated.reduce((acc, g, i) => (isPast(g) ? i : acc), -1);
  // Newest = latest-dated past game (the Cup final can sit mid-season by date).
  const newestKey =
    games
      .filter((g) => isPast(g) && g.date)
      .reduce<TeamGame | null>(
        (a, g) => (!a || (g.date as string) >= (a.date as string) ? g : a),
        null,
      )?.slotKey ?? null;
  const all = [...dated, ...tbd, cupFinal];
  const pastCount = all.filter(isPast).length;
  const playedCount = all.filter((g) => g?.status === "played").length;
  const missedCount = pastCount - playedCount;
  const slotCount = D + T + (cupFinal ? 1 : 0);

  // Team hasn't played yet: no season chart, the last-5 block says "No games yet".
  if (pastCount === 0) return null;

  const showAvg = seasonAvg !== null && playedCount > 0;
  const showLine = showAvg && lastPastIdx >= 0;
  const avgFrac = showLine ? Math.min(seasonAvg!, SCALE_MAX) / SCALE_MAX : null;

  const summary = [
    `Season so far: ${playedCount} played, ${missedCount} out, ${slotCount - pastCount} to come.`,
    showAvg ? `Season average ${seasonAvg!.toFixed(1)}.` : "",
    all
      .filter(isPast)
      .map((g) => slotLabel(g!))
      .join("; "),
  ]
    .filter(Boolean)
    .join(" ");

  const column = (
    g: TeamGame | null,
    col: number,
    newest: boolean,
    key: string,
  ) => {
    const place = { gridColumn: `${col}`, gridRow: "1" };
    if (!g || g.status === "scheduled" || g.status === "tbd") {
      return (
        <div
          key={key}
          className={`${styles.col} ${styles.future}`}
          style={place}
        />
      );
    }
    const nw = newest ? ` ${styles.newest}` : "";
    if (g.status === "missed") {
      return (
        <div
          key={key}
          className={`${styles.col} ${styles.missed}${nw}`}
          style={place}
        />
      );
    }
    const pts = Math.round(g.pts ?? 0);
    const label = newest || pts > SCALE_MAX;
    const barFrac = Math.min(pts, SCALE_MAX) / SCALE_MAX;
    // Newest number sits above its bar, or above the avg line when the bar is below it.
    const lift =
      newest && avgFrac !== null && barFrac < avgFrac ? avgFrac : barFrac;
    return (
      <div key={key} className={styles.col} style={place}>
        {pts === 0 ? (
          <div className={`${styles.zero}${nw}`} />
        ) : (
          <div
            className={`${styles.bar}${nw}`}
            style={{ height: pct(barFrac) }}
          />
        )}
        {label ? (
          <span
            className={styles.pts}
            style={{
              bottom: `calc(${pct(lift)} + ${lift > barFrac ? 7 : 3}px)`,
            }}
          >
            {pts}
          </span>
        ) : null}
      </div>
    );
  };

  const keyOf = (g: TeamGame | null, i: number) => g?.slotKey ?? `pad-${i}`;
  const outDash = (g: TeamGame | null, col: number, key: string) =>
    g?.status === "missed" ? (
      <span
        key={key}
        className={styles.outDash}
        style={{ gridColumn: `${col}` }}
      />
    ) : null;

  return (
    <div className={styles.season}>
      <div className={styles.head}>
        <span className={styles.lab}>
          Season · {pastCount} of {slotCount}
        </span>
        {showAvg ? (
          <span className={styles.avgKey}>
            <span className={styles.avgRule} aria-hidden />
            {seasonAvg!.toFixed(1)} avg
          </span>
        ) : null}
      </div>
      <div className={styles.frame} role="img" aria-label={summary}>
        <div className={styles.plot} style={template}>
          {dated.map((g, i) =>
            column(g, i + 1, !!g && g.slotKey === newestKey, keyOf(g, i)),
          )}
          {tbd.map((g, i) => column(g, tbdStart + i, false, g.slotKey))}
          {cupFinal
            ? column(
                cupFinal,
                cupCol,
                cupFinal.slotKey === newestKey,
                cupFinal.slotKey,
              )
            : null}
          {showLine ? (
            <div
              className={styles.avgSpan}
              style={{ gridColumn: `1 / ${lastPastIdx + 2}`, gridRow: "1" }}
            >
              <div
                className={styles.avg}
                style={{
                  bottom: pct(Math.min(seasonAvg!, SCALE_MAX) / SCALE_MAX),
                }}
              />
            </div>
          ) : null}
        </div>
        <div className={styles.baselines} style={template}>
          <span style={{ gridColumn: `1 / ${D + 1}` }} />
          {T > 0 ? (
            <span style={{ gridColumn: `${tbdStart} / ${tbdStart + T}` }} />
          ) : null}
          {cupFinal ? <span style={{ gridColumn: `${cupCol}` }} /> : null}
        </div>
        <div className={styles.outs} style={template}>
          {dated.map((g, i) => outDash(g, i + 1, keyOf(g, i)))}
          {cupFinal ? outDash(cupFinal, cupCol, cupFinal.slotKey) : null}
        </div>
        <div className={styles.ticks} style={template}>
          {tickSlots(D).map((t) => (
            <span
              key={t}
              className={styles.tick}
              style={{ gridColumn: `${t}`, gridRow: "1" }}
            >
              {t}
            </span>
          ))}
          {T > 0 ? (
            <span
              className={styles.group}
              style={{
                gridColumn: `${tbdStart} / ${tbdStart + T}`,
                gridRow: "2",
              }}
            >
              Cup · TBD
            </span>
          ) : null}
          {cupFinal ? (
            <span
              className={styles.group}
              style={{ gridColumn: `${cupCol}`, gridRow: T > 0 ? "3" : "2" }}
            >
              Cup final
            </span>
          ) : null}
        </div>
      </div>
      {missedCount > 0 ? (
        <p className={styles.key}>
          <span className={styles.keyDash} aria-hidden /> Out
        </p>
      ) : null}
    </div>
  );
}
