"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { PointsRow } from "@/lib/betting";
import type { PastGame } from "@/lib/teamGames";
import { useSlots } from "@/lib/useSlots";
import { SeasonChart, SeasonChartPending } from "./SeasonChart";
import { foldDiacritics, nameMatches } from "@/lib/normalize";
import {
  clientMonthKey,
  formatLocalDate,
  formatPlainDate,
  monthShort,
} from "@/lib/dates";
import styles from "./PointsFinder.module.css";

const MAX_RESULTS = 8;

function lastNameOf(full: string): string {
  const parts = foldDiacritics(full).split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(" ") : (parts[0] ?? "");
}

function rankMatches(rows: PointsRow[], query: string): PointsRow[] {
  const q = foldDiacritics(query.trim());
  if (!q) return [];
  const scored: { row: PointsRow; rank: number }[] = [];
  for (const row of rows) {
    if (!nameMatches(row.full_name, query)) continue;
    const full = foldDiacritics(row.full_name);
    const last = lastNameOf(row.full_name);
    const rank = last.startsWith(q) ? 0 : full.startsWith(q) ? 1 : 2;
    scored.push({ row, rank });
  }
  scored.sort(
    (a, b) => a.rank - b.rank || a.row.full_name.localeCompare(b.row.full_name),
  );
  return scored.slice(0, MAX_RESULTS).map((s) => s.row);
}

function gamesText(n: number): string {
  return n === 1 ? "1 game" : `${n} games`;
}

export function PointsFinder({ rows }: { rows: PointsRow[] }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [picked, setPicked] = useState<PointsRow | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastPointer = useRef<string>("mouse");
  const listId = useId();

  const results = useMemo(() => rankMatches(rows, query), [rows, query]);
  const showList = open && query.trim().length > 0;

  useEffect(() => {
    function onDown(e: PointerEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);

  function pick(row: PointsRow) {
    setPicked(row);
    setQuery(row.full_name);
    setOpen(false);
    setActive(-1);
    if (lastPointer.current === "touch") inputRef.current?.blur();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    lastPointer.current = "keyboard";
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!showList) setOpen(true);
      if (results.length === 0) return;
      const dir = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => {
        if (i < 0) return dir === 1 ? 0 : results.length - 1;
        return (i + dir + results.length) % results.length;
      });
    } else if (e.key === "Enter") {
      if (!showList || results.length === 0) return;
      e.preventDefault();
      pick(results[active >= 0 ? active : 0]!);
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (showList) {
        setOpen(false);
        setActive(-1);
      } else {
        setQuery("");
      }
    } else if (e.key === "Tab") {
      setOpen(false);
      setActive(-1);
    }
  }

  const activeId =
    showList && active >= 0 && results[active]
      ? `${listId}-opt-${active}`
      : undefined;

  return (
    <main>
      <section className={styles.intro}>
        <div>
          <h1 className={styles.title}>Player points</h1>
          <p className={styles.subtitle}>
            Season, month, 2025-26 and last 5 · points only
          </p>
        </div>
        <div className={styles.search} ref={wrapRef}>
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-label="Search a player"
            aria-autocomplete="list"
            aria-expanded={showList}
            aria-controls={listId}
            aria-activedescendant={activeId}
            placeholder="Search a player"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onPointerDown={(e) => {
              lastPointer.current = e.pointerType;
            }}
            onFocus={() => setOpen(true)}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
              setActive(0); // Hardwood: first result shows as active
            }}
            onKeyDown={onKeyDown}
          />
          {showList ? (
            <div className={styles.dropdown} role="listbox" id={listId}>
              {results.length === 0 ? (
                <div className={styles.noMatch} aria-disabled>
                  No players match “{query.trim()}”
                </div>
              ) : (
                results.map((row, i) => (
                  <button
                    key={row.player_id}
                    id={`${listId}-opt-${i}`}
                    className={styles.opt}
                    type="button"
                    role="option"
                    tabIndex={-1}
                    aria-selected={i === active}
                    onPointerDown={(e) => {
                      lastPointer.current = e.pointerType;
                      e.preventDefault();
                    }}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => pick(row)}
                  >
                    <span>{row.full_name}</span>
                    <span className={styles.optMeta}>
                      {[row.team_abbreviation ?? "Free agent", row.position]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </button>
                ))
              )}
            </div>
          ) : null}
        </div>
      </section>

      {picked ? (
        <PointsCard row={picked} />
      ) : (
        <section className={`${styles.court} ${styles.empty}`}>
          <div className={styles.half} aria-hidden />
          <div className={styles.circle} aria-hidden />
          <p>
            Search a player to see season avg, month avg, 2025-26 avg and last 5
            games
          </p>
        </section>
      )}
    </main>
  );
}

function Num({ value }: { value: number | null }) {
  return value === null ? (
    <span className={`${styles.num} ${styles.na}`}>n/a</span>
  ) : (
    <span className={styles.num}>{value.toFixed(1)}</span>
  );
}

const SCALE_MAX = 50;

function oppLabel(g: PastGame): string {
  return `${g.homeAway === "home" ? "vs" : "@"} ${g.opp}`;
}

/**
 * Team's last 5 games while he was on the roster: fixed 0–50, oldest left →
 * newest right, 5 slots from the left. Missed = dashed "Out" slot (never 0).
 */
function LastGamesChart({ games }: { games: PastGame[] }) {
  if (games.length === 0) {
    return (
      <div className={styles.chart}>
        <span className={`${styles.lab} ${styles.chartLab}`}>Last games</span>
        <p className={styles.noGames}>No games yet</p>
      </div>
    );
  }
  const ordered = games.slice(-5); // data is oldest first
  const slots: (PastGame | null)[] = Array.from(
    { length: 5 },
    (_, i) => ordered[i] ?? null,
  );
  const newestIdx = ordered.length - 1;
  const summary = ordered
    .map((g) => {
      const where = `${formatPlainDate(g.date)} ${g.homeAway === "home" ? "vs" : "at"} ${g.opp}`;
      return g.status === "missed" || g.pts === null
        ? `${where}: out`
        : `${where}: ${Math.round(g.pts)} points`;
    })
    .join("; ");

  return (
    <div className={styles.chart}>
      <span className={`${styles.lab} ${styles.chartLab}`}>
        Last {ordered.length} team {ordered.length === 1 ? "game" : "games"}
      </span>
      <div className={styles.plot} role="img" aria-label={summary}>
        {slots.map((g, i) => {
          if (!g) return <div key={`empty-${i}`} className={styles.slot} />;
          const nw = i === newestIdx ? ` ${styles.newest}` : "";
          const key = g.slotKey;
          if (g.status === "missed" || g.pts === null) {
            return (
              <div key={key} className={styles.slot}>
                <div className={`${styles.out}${nw}`}>
                  <span className={styles.outLab}>Out</span>
                </div>
              </div>
            );
          }
          const pts = Math.round(g.pts);
          return (
            <div key={key} className={styles.slot}>
              {pts === 0 ? (
                <div className={`${styles.zero}${nw}`}>
                  <span className={styles.pts}>0</span>
                </div>
              ) : (
                <div
                  className={`${styles.bar}${nw}`}
                  style={{
                    height: `${(Math.min(pts, SCALE_MAX) / SCALE_MAX) * 100}%`,
                  }}
                >
                  <span className={styles.pts}>{pts}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className={styles.baseline} aria-hidden />
      <ul className={styles.caps} aria-hidden>
        {slots.map((g, i) =>
          g ? (
            <li
              key={g.slotKey}
              className={`${styles.cap}${g.status === "missed" ? ` ${styles.capOut}` : ""}`}
            >
              <b>{oppLabel(g)}</b>
              <span>{formatPlainDate(g.date)}</span>
            </li>
          ) : (
            <li key={`empty-${i}`} className={styles.cap} />
          ),
        )}
      </ul>
    </div>
  );
}

/** A season he has no games in: header and one line, no chart. */
function NoSeasonChart({ title }: { title: string }) {
  return (
    <div className={styles.noSeason}>
      <span className={styles.noSeasonLab}>{title}</span>
      <p className={styles.noSeasonText}>No 2025-26 games</p>
    </div>
  );
}

function PointsCard({ row }: { row: PointsRow }) {
  const [monthKey, setMonthKey] = useState<string | null>(null);
  useEffect(() => {
    setMonthKey(clientMonthKey());
  }, []);
  const clientMonth = monthKey ?? row.month_key;

  const played = row.has_season_games;
  const seasonAvg = played ? row.pts_season_avg : null;
  const slots = useSlots(row.player_id);
  // Team has played but he hasn't: "n/a · 0 games"; team hasn't played: "No games yet".
  const teamPlayed = row.teamPlayed;
  const noGames = teamPlayed ? "0 games" : "No games yet";
  const seasonSub =
    played && row.gp_season ? gamesText(row.gp_season) : noGames;

  const sameMonth = clientMonth === row.month_key;
  const monthAvg = played && sameMonth ? row.pts_month_avg : null;
  const monthSub = !played
    ? noGames
    : sameMonth && row.gp_month
      ? gamesText(row.gp_month)
      : "0 games";

  // 2025-26: same pattern as the 2026-27 tile — slot_total > 0 but no
  // played game reads "n/a · 0 games" (never 0.0); slot_total 0 (or no
  // 2025-26 games at all) reads "No 2025-26 games".
  const lastGp = row.last_season_gp ?? 0;
  const lastAvg = lastGp > 0 ? row.last_season_pts_avg : null;
  const lastSub =
    lastAvg !== null
      ? gamesText(lastGp)
      : (row.slotTotal2526 ?? 0) > 0
        ? "0 games"
        : "No 2025-26 games";
  const curTitle = "2026-27 season · team games";
  const prevTitle = "2025-26 season · team games";

  const teamLine = [row.team_abbreviation ?? "Free agent", row.position]
    .filter(Boolean)
    .join(" · ");

  return (
    <section className={styles.court} aria-live="polite">
      <div className={styles.circle} aria-hidden />
      <div className={styles.who}>
        <h2 className={styles.name}>{row.full_name}</h2>
        <p className={styles.meta}>
          {teamLine}
          {row.team_changed_vs_last_game && row.last_game_team_abbreviation
            ? ` · last game with ${row.last_game_team_abbreviation}`
            : null}
        </p>
      </div>

      <div className={styles.zones}>
        <div className={`${styles.zone} ${styles.key}`}>
          <span className={styles.lab}>Season avg</span>
          <Num value={seasonAvg} />
          <span className={styles.sub}>{seasonSub}</span>
        </div>
        <div className={`${styles.zone} ${styles.elbow}`}>
          <span className={styles.lab}>{monthShort(clientMonth)} avg</span>
          <Num value={monthAvg} />
          <span className={styles.sub}>{monthSub}</span>
        </div>
        <div className={`${styles.zone} ${styles.wing}`}>
          <span className={styles.lab}>2025-26 avg</span>
          <Num value={lastAvg} />
          <span className={styles.sub}>{lastSub}</span>
        </div>
      </div>

      <LastGamesChart games={row.last5} />
      <div className={styles.seasonArea}>
        {!teamPlayed ? null : slots.status === "ready" ? (
          <SeasonChart
            title={curTitle}
            games={slots.slots.cur.games}
            slotTotal={slots.slots.cur.slotTotal}
            explicitTrades={slots.slots.cur.explicitTrades}
            seasonAvg={seasonAvg}
          />
        ) : (
          <SeasonChartPending
            title={curTitle}
            failed={slots.status === "failed"}
            onRetry={slots.status === "failed" ? slots.retry : undefined}
            avgKey={seasonAvg !== null && row.shape.cur.played}
            notOn={row.shape.cur.notOn}
            played={row.shape.cur.played}
            hasMarkers={row.shape.cur.hasMarkers}
          />
        )}
        {row.slotTotal2526 === null ? null : row.slotTotal2526 === 0 ? (
          <NoSeasonChart title={prevTitle} />
        ) : slots.status === "ready" && slots.slots.prev ? (
          <SeasonChart
            complete
            title={prevTitle}
            games={slots.slots.prev.games}
            slotTotal={slots.slots.prev.slotTotal}
            explicitTrades={slots.slots.prev.explicitTrades}
            seasonAvg={lastAvg}
            sourceNote={row.shape.prev?.sourceNote}
          />
        ) : (
          <SeasonChartPending
            complete
            title={prevTitle}
            failed={slots.status !== "loading"}
            onRetry={slots.status === "failed" ? slots.retry : undefined}
            avgKey
            notOn={row.shape.prev?.notOn ?? false}
            played={row.shape.prev?.played ?? false}
            hasMarkers={row.shape.prev?.hasMarkers ?? false}
            sourceNote={row.shape.prev?.sourceNote}
          />
        )}
      </div>

      <p className={styles.stamp}>
        Updated {row.pulled_at_utc ? formatLocalDate(row.pulled_at_utc) : "n/a"}
        {" · games through "}
        {row.data_as_of_game_date
          ? formatPlainDate(row.data_as_of_game_date)
          : "n/a"}
      </p>
    </section>
  );
}
