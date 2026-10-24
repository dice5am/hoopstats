#!/usr/bin/env node
// Fixture-free check: synthetic players (built inline) through the real
// loader (toTeamGames) and the chart's tick placement (tradeTicks), plus the
// /slots wire round-trip. Exits 1 on any failure.
import assert from "node:assert/strict";
import { loadLib } from "./lib/load-ts.mjs";

const { toTeamGames } = await loadLib("betting");
const { tradeTicks, layoutTradeLabels, encodePlayerSlots, decodePlayerSlots } = await loadLib("teamGames");

/** 82 dated slots; team by seq; status by seq (default played, 10 pts). */
function player({ n = 82, team, status = () => "played", extra = () => ({}) }) {
  const start = Date.UTC(2025, 9, 21);
  return Array.from({ length: n }, (_, i) => {
    const seq = i + 1;
    const d = new Date(start + i * 2 * 864e5).toISOString().slice(0, 10);
    const st = status(seq);
    return {
      game_seq: seq,
      slot_key: `G${seq}`,
      game_id: `G${seq}`,
      game_date: d,
      opponent_abbreviation: "OPP",
      home_away: seq % 2 ? "home" : "away",
      team_abbreviation: team(seq),
      status: st,
      pts: st === "played" ? 10 : 0,
      minutes: st === "played" ? 30 : 0,
      is_cup_final: false,
      ...extra(seq),
    };
  });
}
const dateOf = (rows, seq) => rows.find((r) => r.game_seq === seq).game_date;
const dated = (games) =>
  games
    .filter((g) => g.date)
    .sort((a, b) => a.date.localeCompare(b.date) || a.seq - b.seq);
const ticks = (games, explicit) => tradeTicks(dated(games), true, explicit);
const results = [];
function check(name, fn) {
  try {
    fn();
    results.push(`PASS ${name}`);
  } catch (e) {
    results.push(`FAIL ${name}: ${e.message}`);
  }
}

check("list-form: one trade, MM-DD date → tick before slot 54, 'Traded to LAL'", () => {
  const raw = player({ team: (s) => (s < 54 ? "ATL" : "LAL") });
  const md = dateOf(raw, 54).slice(5);
  const g = toTeamGames(raw, [{ game_seq: 54, game_date: md, from_team: "ATL", to_team: "LAL" }]);
  assert.deepEqual(ticks(g, true), [{ ci: 53, team: "LAL" }]);
});

check("list-form: full date, two trades", () => {
  const raw = player({ team: (s) => (s < 30 ? "ATL" : s < 61 ? "WAS" : "DEN") });
  const g = toTeamGames(raw, [
    { game_seq: 30, game_date: dateOf(raw, 30), from_team: "ATL", to_team: "WAS" },
    { game_seq: 61, game_date: dateOf(raw, 61), from_team: "WAS", to_team: "DEN" },
  ]);
  assert.deepEqual(ticks(g, true), [
    { ci: 29, team: "WAS" },
    { ci: 60, team: "DEN" },
  ]);
});

check("list-form: label is to_team even on a Not on team slot of the new team", () => {
  const raw = player({
    team: (s) => (s < 51 ? "CHI" : "BOS"),
    status: (s) => (s === 51 || s === 52 ? "not_on_team" : "played"),
  });
  const g = toTeamGames(raw, [{ game_seq: 51, game_date: dateOf(raw, 51), from_team: "CHI", to_team: "BOS" }]);
  assert.deepEqual(ticks(g, true), [{ ci: 50, team: "BOS" }]);
});

check("list-form: empty list = never traded (no team-change inference)", () => {
  const raw = player({ team: (s) => (s < 40 ? "ATL" : "LAL") });
  assert.deepEqual(ticks(toTeamGames(raw, []), true), []);
});

check("list-form replaces old per-slot flags", () => {
  const raw = player({ team: (s) => (s < 40 ? "ATL" : "LAL"), extra: (s) => ({ trade_marker: s === 10 }) });
  const g = toTeamGames(raw, [{ game_seq: 40, game_date: dateOf(raw, 40), from_team: "ATL", to_team: "LAL" }]);
  assert.deepEqual(ticks(g, true), [{ ci: 39, team: "LAL" }]);
});

check("list-form: Cup final dropped earlier — seq still names the right slot", () => {
  const raw = player({ n: 83, team: (s) => (s < 60 ? "NYK" : "SAS"), extra: (s) => ({ is_cup_final: s === 25 }) });
  const g = toTeamGames(raw, [{ game_seq: 60, game_date: dateOf(raw, 60), from_team: "NYK", to_team: "SAS" }]);
  assert.equal(g.length, 82);
  assert.deepEqual(ticks(g, true), [{ ci: 58, team: "SAS" }]); // slot 60 is the 59th drawn
});

check("list-form: seq/date disagree → date wins", () => {
  const raw = player({ team: (s) => (s < 54 ? "ATL" : "LAL") });
  const g = toTeamGames(raw, [{ game_seq: 53, game_date: dateOf(raw, 54), from_team: "ATL", to_team: "LAL" }]);
  assert.deepEqual(ticks(g, true), [{ ci: 53, team: "LAL" }]);
});

check("old per-slot boolean marker still works (no list)", () => {
  const raw = player({ team: (s) => (s < 51 ? "CHI" : "BOS"), extra: (s) => ({ trade_marker: s === 51 }) });
  assert.deepEqual(ticks(toTeamGames(raw), false), [{ ci: 50, team: "BOS" }]);
});

check("team-change fallback (no list, no flags)", () => {
  const raw = player({ team: (s) => (s < 51 ? "CHI" : "BOS") });
  assert.deepEqual(ticks(toTeamGames(raw), false), [{ ci: 50, team: "BOS" }]);
});

check("statuses: played/out/missed/not_on_team/offteam; played only from status", () => {
  const st = (s) => (s <= 5 ? "offteam" : s <= 10 ? "not_on_team" : s <= 15 ? "out" : s <= 20 ? "missed" : "played");
  // 0-minute rows with pts on an out slot must not count as played.
  const raw = player({ team: () => "IND", status: st, extra: (s) => (s === 12 ? { pts: 7, minutes: 0 } : {}) });
  const g = toTeamGames(raw, []);
  const c = (x) => g.filter((y) => y.status === x).length;
  assert.deepEqual([c("played"), c("missed"), c("not_on_team")], [62, 10, 10]);
  assert.equal(c("played") + c("missed") + c("not_on_team"), 82);
  assert.ok(g.filter((y) => y.status !== "played").every((y) => y.pts === null));
});

check("all-Out entry keeps every slot (chart, not 'No 2025-26 games')", () => {
  const g = toTeamGames(player({ team: () => "IND", status: () => "out" }), []);
  assert.equal(g.length, 82);
  assert.ok(g.every((y) => y.status === "missed" && y.pts === null));
});

check("wire round-trip keeps markers, to_team and explicit flag", () => {
  const raw = player({ team: (s) => (s < 54 ? "ATL" : "LAL") });
  const games = toTeamGames(raw, [{ game_seq: 54, game_date: dateOf(raw, 54), from_team: "ATL", to_team: "LAL" }]);
  const p = { cur: { games, slotTotal: 82, explicitTrades: true }, prev: null };
  const back = decodePlayerSlots(JSON.parse(JSON.stringify(encodePlayerSlots(p))));
  assert.deepEqual(back.cur.games, games);
  assert.equal(back.cur.explicitTrades, true);
  assert.deepEqual(ticks(back.cur.games, true), [{ ci: 53, team: "LAL" }]);
});

check("labels: two close trades stack — second one row up, both end at their ticks", () => {
  // Kyle Anderson shape: 83 slots, UTA → MEM before slot 52, → MIN before slot 63.
  const raw = player({ n: 83, team: (s) => (s < 52 ? "UTA" : s < 63 ? "MEM" : "MIN") });
  const g = toTeamGames(raw, [
    { game_seq: 52, game_date: dateOf(raw, 52), from_team: "UTA", to_team: "MEM" },
    { game_seq: 63, game_date: dateOf(raw, 63), from_team: "MEM", to_team: "MIN" },
  ]);
  const t = ticks(g, true);
  assert.deepEqual(t.map((x) => x.ci + 1), [52, 63]);
  const { labels, rows } = layoutTradeLabels(t, 83);
  assert.equal(rows, 2);
  assert.deepEqual(labels.map((l) => [l.text, l.row, l.align]), [
    ["Traded to MEM", 0, "right"],
    ["Traded to MIN", 1, "right"],
  ]);
});

check("labels: three close trades take three rows; far trades stay on row 0", () => {
  const close3 = layoutTradeLabels([{ ci: 49, team: "CHA" }, { ci: 50, team: "DAL" }, { ci: 60, team: "DEN" }], 80);
  assert.deepEqual(close3.labels.map((l) => l.row), [0, 1, 2]);
  const far = layoutTradeLabels([{ ci: 10, team: "PHI" }, { ci: 50, team: "BOS" }], 82);
  assert.deepEqual(far.labels.map((l) => [l.row, l.align]), [[0, "left"], [0, "left"]]);
  assert.equal(far.rows, 1);
  const lone = layoutTradeLabels([{ ci: 70, team: "BOS" }], 82);
  assert.deepEqual(lone.labels.map((l) => [l.row, l.align]), [[0, "right"]]);
});

console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
