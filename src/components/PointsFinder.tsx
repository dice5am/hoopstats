"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { PointsRow } from "@/lib/betting";
import { foldDiacritics, nameMatches } from "@/lib/normalize";
import { getTeamColors } from "@/lib/teamColors";
import { TeamMarkPip } from "@/components/TeamMarkPip";
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
  return parts.length > 1 ? parts.slice(1).join(" ") : parts[0] ?? "";
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
    (a, b) =>
      a.rank - b.rank || a.row.full_name.localeCompare(b.row.full_name),
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
    <main className={styles.wrap}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Player points</h1>
          <p className={styles.subtitle}>
            Season, month and last 5 · points only
          </p>
        </div>
        <div className={styles.searchWrap} ref={wrapRef}>
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
              setActive(-1);
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
                    <span className={styles.optName}>{row.full_name}</span>
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
      </header>

      {picked ? (
        <PointsCard row={picked} />
      ) : (
        <section className={`${styles.panel} ${styles.empty}`}>
          Search a player to see his points: season avg, month avg and last 5
          games.
        </section>
      )}
    </main>
  );
}

function Na() {
  return <span className={`${styles.val} ${styles.na}`}>n/a</span>;
}

function AvgTile({
  label,
  avg,
  sub,
}: {
  label: string;
  avg: number | null;
  sub: string;
}) {
  return (
    <div className={styles.metricCard}>
      <span className={styles.metricLabel}>{label}</span>
      {avg === null ? (
        <Na />
      ) : (
        <span className={styles.val}>{avg.toFixed(1)}</span>
      )}
      <span className={styles.games}>{sub}</span>
    </div>
  );
}

function PointsCard({ row }: { row: PointsRow }) {
  const [monthKey, setMonthKey] = useState<string | null>(null);
  useEffect(() => {
    setMonthKey(clientMonthKey());
  }, []);
  const clientMonth = monthKey ?? row.month_key;
  const color = getTeamColors(row.team_abbreviation)?.chartPrimary ?? null;

  const played = row.has_season_games;
  const seasonAvg = played ? row.pts_season_avg : null;
  const seasonSub =
    played && row.gp_season ? gamesText(row.gp_season) : "No games yet";

  const sameMonth = clientMonth === row.month_key;
  const monthAvg = played && sameMonth ? row.pts_month_avg : null;
  const monthSub = !played
    ? "No games yet"
    : sameMonth && row.gp_month
      ? gamesText(row.gp_month)
      : "0 games";

  const games = played ? row.last : [];
  const teamLine = [row.team_abbreviation ?? "Free agent", row.position]
    .filter(Boolean)
    .join(" · ");

  return (
    <section className={styles.panel} aria-live="polite">
      <h2 className={`${styles.title} ${styles.titleWithPip}`}>
        <TeamMarkPip color={color} size={8} />
        {row.full_name}
      </h2>
      <p className={styles.meta}>
        {teamLine}
        {row.team_changed_vs_last_game && row.last_game_team_abbreviation ? (
          <span className={styles.traded}>
            {" "}
            · last game with {row.last_game_team_abbreviation}
          </span>
        ) : null}
      </p>

      <div className={styles.grid}>
        <div className={styles.avgs}>
          <AvgTile label="Season avg" avg={seasonAvg} sub={seasonSub} />
          <AvgTile
            label={`${monthShort(clientMonth)} avg`}
            avg={monthAvg}
            sub={monthSub}
          />
        </div>

        <div>
          <p className={styles.recentLabel}>
            {games.length > 0 ? `Last ${games.length}` : "Last games"}
          </p>
          <ul className={styles.games_list}>
            {games.length === 0 ? (
              <li className={`${styles.gameRow} ${styles.noGames}`}>
                No games yet this season
              </li>
            ) : (
              games.map((g) => (
                <li key={`${g.date}-${g.opp}`} className={styles.gameRow}>
                  <span className={styles.gameDate}>
                    {formatPlainDate(g.date)}
                  </span>
                  <span
                    className={styles.gameOpp}
                    aria-label={
                      g.homeAway === "home"
                        ? `home vs ${g.opp}`
                        : `away at ${g.opp}`
                    }
                  >
                    {g.homeAway === "home" ? "vs" : "@"} {g.opp}
                  </span>
                  <span className={styles.gamePts}>
                    {Math.round(g.pts)}
                    <span className={styles.ptsUnit}> pts</span>
                  </span>
                </li>
              ))
            )}
          </ul>
        </div>
      </div>

      <p className={styles.updated}>
        Updated {row.pulled_at_utc ? formatLocalDate(row.pulled_at_utc) : "n/a"}
        {" · games through "}
        {row.data_as_of_game_date
          ? formatPlainDate(row.data_as_of_game_date)
          : "n/a"}
      </p>
    </section>
  );
}
