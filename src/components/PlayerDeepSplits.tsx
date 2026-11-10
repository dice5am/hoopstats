"use client";

import { useEffect, useMemo, useState } from "react";
import type { DeepInsightsData, FlagRow, Outcome } from "@/lib/deepInsightsTypes";
import {
  SEGMENT_SWITCH_LABEL,
  TIMESPAN_SWITCH_LABEL,
  type SegmentKey,
  type TimespanKey,
} from "@/lib/timespans";
import { EffectBars, type BarRow } from "./EffectBars";
import { Header, Switch, Thin, f2, fmtN, pp, tickFmt } from "./DeepInsights";
import styles from "./DeepInsights.module.css";

type Row = [
  string, // player id
  number, // n_cond
  number, // n_ref
  number, // raw diff
  number, // shrunk diff
  number, // shrunk lo
  number, // shrunk hi
  number | null, // z
  number | null, // q
  string | null, // flag
  number, // credible vs league: 1 above, -1 below
  number, // segment bits: 1 top10, 2 top25, 4 top50, 8 top100
];

type PlayerFile = {
  timespan: string;
  floors: Record<string, [number, number]>;
  league: Record<string, Record<string, [number | null, number | null, number | null, number | null]>>;
  players: Record<string, [string, string, number]>;
  rows: Record<string, Record<string, Row[]>>;
};

const COND: [string, string, string][] = [
  ["worst5", "Worst 5", "against the 5 worst defences vs the rest"],
  ["worst10", "Worst 10", "against the 10 worst defences vs the rest"],
  ["home_vs_away", "Home/away", "at home vs away"],
  ["b2b_2nd_vs_rested", "B2B 2nd", "on the 2nd night of a back-to-back vs rested"],
];
const OUT_LABEL: Record<"dev" | "big10" | "x125", string> = {
  dev: "Points",
  big10: "Big night +10",
  x125: "×1.25 avg",
};

const cache = new Map<string, Promise<PlayerFile>>();
function loadFile(ts: string): Promise<PlayerFile> {
  let p = cache.get(ts);
  if (!p) {
    p = fetch(`/deep-players/${encodeURIComponent(ts)}.json`).then((r) => {
      if (!r.ok) throw new Error(String(r.status));
      return r.json() as Promise<PlayerFile>;
    });
    p.catch(() => cache.delete(ts));
    cache.set(ts, p);
  }
  return p;
}

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

function flagBadge(flag: string | null): { text: string; strong: boolean } | null {
  if (!flag) return null;
  const [dir, kind] = flag.split("_");
  return { text: `${dir} · ${kind}`, strong: kind === "strong" };
}

const SEG_BIT: Partial<Record<SegmentKey, number>> = { top100: 8, top50: 4 };
const PAGE = 10;

export function PlayerDeepSplits({
  data,
  timespan,
  segment,
}: {
  data: DeepInsightsData;
  timespan: TimespanKey;
  segment: SegmentKey;
}) {
  const [cond, setCond] = useState("worst5");
  const [out, setOut] = useState<"dev" | "big10" | "x125">("big10");
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [state, setState] = useState<{ ts: string; file?: PlayerFile; err?: boolean }>({ ts: "" });

  const cell = data.cells[timespan]?.[segment];
  const provisional = timespan === "2026_27";
  const gated = provisional || !cell || cell.thin;

  useEffect(() => {
    if (gated) return;
    let live = true;
    loadFile(timespan)
      .then((file) => live && setState({ ts: timespan, file }))
      .catch(() => live && setState({ ts: timespan, err: true }));
    return () => {
      live = false;
    };
  }, [timespan, gated]);

  const file = state.ts === timespan ? state.file : undefined;
  const failed = state.ts === timespan && state.err;
  const condMeta = COND.find((c) => c[0] === cond)!;

  const list = useMemo(() => {
    if (!file) return [];
    const bit = SEG_BIT[segment];
    const q = norm(query.trim());
    const all = (file.rows[cond]?.[out] ?? []).filter((r) => {
      if (bit && !(r[11] & bit)) return false;
      if (q && !norm(file.players[r[0]]?.[0] ?? "").includes(q)) return false;
      return true;
    });
    const rank = (r: Row) => (r[9]?.endsWith("strong") ? 0 : r[9] ? 1 : 2);
    return all.sort((a, b) => rank(a) - rank(b) || Math.abs(b[7] ?? 0) - Math.abs(a[7] ?? 0));
  }, [file, cond, out, segment, query]);

  const summary: FlagRow | undefined = (data.flags[timespan] ?? []).find(
    (r) => r.condition === cond && r.outcome === out,
  );
  const lg = file?.league[cond]?.[out];
  const floors = file?.floors[cond];
  const isDev = out === "dev";
  const sc = isDev ? 1 : 100;
  const t = (n: number) => (isDev ? f2(n) : pp(n));
  const unit = isDev ? "PTS" : "percentage points";

  const rows: BarRow[] = file
    ? list.slice(0, shown).map((r) => {
        const name = file.players[r[0]]?.[0] ?? r[0];
        const pos = file.players[r[0]]?.[1];
        const b = flagBadge(r[9]);
        const diff = r[10] === 1 ? " · above the league effect" : r[10] === -1 ? " · below the league effect" : "";
        return {
          key: r[0],
          label: name,
          sub: `${pos ? `${pos} · ` : ""}${r[1]} vs ${r[2]} games`,
          est: r[4] * sc,
          lo: r[5] * sc,
          hi: r[6] * sc,
          text: t(r[4]),
          ciText: `${t(r[5])} to ${t(r[6])}`,
          extra: `raw gap ${t(r[3])}${r[7] != null ? ` · z ${f2(r[7])}` : ""}${r[8] != null ? ` · q ${r[8].toFixed(2)}` : ""}${diff}`,
          badge: b?.text,
          badgeStrong: b?.strong,
          href: `/players?player=${encodeURIComponent(r[0])}`,
        };
      })
    : [];

  const nStrong = list.filter((r) => r[9]?.endsWith("strong")).length;
  const nWatch = list.filter((r) => r[9]?.endsWith("watch")).length;
  const none = !!summary && summary.n_above_league === 0 && summary.n_below_league === 0;
  const word = isDev ? "points effect" : "big-night effect";

  return (
    <section className={styles.section} aria-labelledby="ps-h">
      <Header id="ps-h" title="Player matchup & big-night splits">
        <p className={styles.story}>
          Each player&apos;s own gap for the chosen condition, <em>shrunk</em>{" "}
          toward the league-wide gap so a few games can&apos;t set the picture.
          The bar is his shrunk estimate with a 95% interval; the tan band is
          the league-wide estimate. Associations, not causes.
        </p>
      </Header>
      {gated ? (
        provisional ? (
          <div className={styles.thin} role="status">
            <p className={styles.thinH}>Not enough games yet</p>
            <p className={styles.thinP}>
              2026-27 is provisional: players have too few games on each side of
              a split so far for a per-player estimate. Pick a completed season
              or a pooled timespan.
            </p>
          </div>
        ) : (
          <Thin cell={cell} timespan={timespan} segment={segment} />
        )
      ) : (
        <>
          <Switch
            label="Condition"
            value={cond}
            onChange={(k) => {
              setCond(k);
              setShown(PAGE);
            }}
            options={COND.map(([k, l]) => ({ key: k, label: l }))}
          />
          <Switch
            label="Outcome"
            value={out}
            onChange={(k) => {
              setOut(k as Outcome as "dev" | "big10" | "x125");
              setShown(PAGE);
            }}
            options={(["dev", "big10", "x125"] as const).map((k) => ({ key: k, label: OUT_LABEL[k] }))}
          />
          <p className={styles.cellNote}>
            {TIMESPAN_SWITCH_LABEL[timespan]} · {SEGMENT_SWITCH_LABEL[segment]} · {condMeta[2]}
            {floors ? ` · needs ${floors[0]}+ games under the condition and ${floors[1]}+ outside it` : ""}
          </p>

          {failed ? (
            <p className={styles.note}>Couldn&apos;t load the per-player file. Reload to try again.</p>
          ) : !file ? (
            <p className={styles.note}>Loading players…</p>
          ) : (
            <>
              <div className={styles.callout}>
                <p>
                  <strong>
                    {none
                      ? `No player has a credible ${word} of his own here.`
                      : summary
                        ? `${summary.n_above_league + summary.n_below_league} player estimates sit clear of the league effect here; treat each as a lead.`
                        : "No league summary for this condition."}
                  </strong>{" "}
                  {summary ? (
                    <>
                      {none && summary.tau === 0
                        ? "The spread between players is estimated at zero, so every shrunk estimate is the league-wide figure"
                        : summary.tau != null
                          ? `Estimated spread between players: ${isDev ? summary.tau.toFixed(2) : (summary.tau * 100).toFixed(1)} ${isDev ? "PTS" : "pp"}. League-wide figure`
                          : "League-wide figure"}
                      {lg && lg[0] != null && lg[1] != null && lg[2] != null
                        ? ` ${t(lg[0])} (95% CI ${t(lg[1])} to ${t(lg[2])}${isDev ? " PTS" : " pp"})`
                        : ""}
                      . Across {fmtN(summary.n_players)} players the data give {summary.n_flag_watch_z25} watch
                      flags against about {summary.expected_watch_by_chance.toFixed(1)} expected by chance and{" "}
                      {summary.n_flag_strong_q10} strong.
                    </>
                  ) : null}
                </p>
              </div>

              <label className={styles.search}>
                <span className={styles.searchLab}>Find a player</span>
                <input
                  type="search"
                  value={query}
                  placeholder="Name"
                  className={styles.searchIn}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setShown(PAGE);
                  }}
                />
              </label>
              <p className={styles.cellNote}>
                {fmtN(list.length)} {list.length === 1 ? "player" : "players"}
                {query ? " match" : ` in ${SEGMENT_SWITCH_LABEL[segment]}`} · {nStrong} strong, {nWatch} watch · strong
                first, then watch, then largest |z|
              </p>

              {rows.length === 0 ? (
                <p className={styles.note}>No players match.</p>
              ) : (
                <>
                  <EffectBars
                    rows={rows}
                    tickFmt={tickFmt}
                    label={`Player shrunk effects, ${unit}`}
                    band={lg && lg[1] != null && lg[2] != null ? [lg[1] * sc, lg[2] * sc] : undefined}
                  />
                  <p className={styles.axisNote}>
                    {unit} · bar = shrunk estimate · whiskers = 95% interval · tan band = league-wide 95% CI
                  </p>
                  {list.length > shown ? (
                    <button type="button" className={styles.more} onClick={() => setShown(shown + PAGE)}>
                      Show {Math.min(PAGE, list.length - shown)} more
                    </button>
                  ) : null}
                </>
              )}
              <p className={styles.note}>
                <strong>Flags, exactly as the data labels them.</strong> <em>Watch</em> = the player&apos;s raw gap is
                at least 2.5 standard errors out but does not pass the multiple-testing correction.{" "}
                <em>Strong</em> = it does (q &lt; 0.10). &quot;higher&quot; / &quot;lower&quot; is the direction of his raw gap. A
                flag is not a player-specific effect: the shrunk estimate stays close to the league figure.
              </p>
              <Provisional2 timespan={timespan} />
            </>
          )}
        </>
      )}
    </section>
  );
}

function Provisional2({ timespan }: { timespan: TimespanKey }) {
  return timespan === "pooled_2023_27" ? (
    <p className={styles.caveat}>
      This pooled window includes early 2026-27 games; the per-player floors
      are applied to the pooled totals.
    </p>
  ) : null;
}
