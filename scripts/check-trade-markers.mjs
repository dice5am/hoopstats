#!/usr/bin/env node
// Fixture-free check: synthetic players (built inline) through the real
// loader (toTeamGames) and the chart's tick placement (tradeTicks) and label
// layout (variant B lock), plus the /slots wire round-trip, plus the label
// wording of a few real players read from the tracked data files (skipped if
// absent). Exits 1 on any failure.
import assert from "node:assert/strict";
import { loadLib } from "./lib/load-ts.mjs";

const { toTeamGames, loadPlayerSlots, loadPointsRows, SOURCE_FIELD } = await loadLib("betting");
const { tradeTicks, chartCells, layoutTradeLabels, pickMerge, DEFAULT_SOURCE, encodePlayerSlots, decodePlayerSlots, MARKER_BAND_ROWS, exitReasonOf, joinReasonOf } =
  await loadLib("teamGames");

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
/** [slot (1-based drawn position), label] per tick. */
const tk = (games, explicit = true) => ticks(games, explicit).map((t) => [t.ci + 1, t.text]);
const J = (seq, raw, from, to, extra = {}) => ({ game_seq: seq, game_date: dateOf(raw, seq), from_team: from, to_team: to, ...extra });
const X = (seq, raw, team, reason) => ({ game_seq: seq, game_date: dateOf(raw, seq), team, reason });
const results = [];
function check(name, fn) {
  try {
    fn();
    results.push(`PASS ${name}`);
  } catch (e) {
    results.push(`FAIL ${name}: ${e.message}`);
  }
}

check("join, no reason (today's gated file) → 'Joined LAL'; MM-DD date", () => {
  const raw = player({ team: (s) => (s < 54 ? "ATL" : "LAL") });
  const md = dateOf(raw, 54).slice(5);
  const g = toTeamGames(raw, [{ game_seq: 54, game_date: md, from_team: "ATL", to_team: "LAL" }]);
  assert.deepEqual(tk(g), [[54, "Joined LAL"]]);
});

check("join reasons: trade / signed / null / unknown / case+space normalised", () => {
  const raw = player({ team: (s) => (s < 20 ? "ATL" : s < 40 ? "WAS" : s < 60 ? "DEN" : s < 70 ? "BOS" : "NYK") });
  const g = toTeamGames(raw, [
    J(20, raw, "ATL", "WAS", { reason: "trade" }),
    J(40, raw, "WAS", "DEN", { reason: " Signed " }),
    J(60, raw, "DEN", "BOS", { reason: null }),
    J(70, raw, "BOS", "NYK", { reason: "hardship_exception" }),
  ]);
  assert.deepEqual(tk(g), [[20, "Traded to WAS"], [40, "Signed with DEN"], [60, "Joined BOS"], [70, "Joined NYK"]]);
  assert.deepEqual(["TRADE", "signed", "Signed", null, undefined, "", "x"].map(joinReasonOf), ["trade", "signed", "signed", undefined, undefined, undefined, undefined]);
});

check("same-team rejoin (from_team === to_team) renders normally", () => {
  const raw = player({ team: () => "IND", status: (s) => (s >= 30 && s < 38 ? "not_on_team" : "played") });
  const g = toTeamGames(raw, [J(38, raw, "IND", "IND", { reason: "signed" })], [X(30, raw, "IND", "waived")]);
  assert.deepEqual(tk(g), [[30, "Waived by IND"], [38, "Signed with IND"]]);
});

check("exit reasons: waived / contract_end / contract_ended / 'contract ended' / ten_day_end / left / case", () => {
  const names = ["waived", "contract_end", "contract_ended", "contract ended", "ten_day_end", "LEFT", "Contract_Ended", "Ten Day End"];
  assert.deepEqual(names.map(exitReasonOf), ["waived", "left", "left", "left", "left", "left", "left", "left"]);
  assert.deepEqual([null, undefined, "", "retired", 3].map(exitReasonOf), [null, null, null, null, null]);
  const raw = player({ team: () => "IND", status: (s) => (s >= 10 && s % 10 === 0 ? "not_on_team" : "played") });
  const g = toTeamGames(raw, [], names.map((r, i) => X(10 * (i + 1), raw, "IND", r)));
  assert.deepEqual(tk(g).map((x) => x[1]), ["Waived by IND", "Left IND", "Left IND", "Left IND", "Left IND", "Left IND", "Left IND", "Left IND"]);
});

check("exit with null / missing / unknown reason → no tick, no label; absent list → nothing", () => {
  const raw = player({ team: () => "IND", status: (s) => (s >= 31 ? "not_on_team" : "played") });
  const g = toTeamGames(raw, [], [X(31, raw, "IND", null), { game_seq: 40, game_date: dateOf(raw, 40), team: "IND" }, X(50, raw, "IND", "released?")]);
  assert.deepEqual(tk(g), []);
  assert.deepEqual(tk(toTeamGames(raw, [])), []);
  assert.ok(toTeamGames(raw, []).every((x) => !x.exits));
});

check("no dates in any label", () => {
  const raw = player({ team: (s) => (s < 50 ? "IND" : "ATL"), status: (s) => (s >= 40 && s < 50 ? "not_on_team" : "played") });
  const g = toTeamGames(raw, [J(50, raw, "IND", "ATL", { reason: "signed" })], [X(40, raw, "IND", "waived")]);
  assert.ok(tk(g).every(([, t]) => !/\d/.test(t)));
});

check("list-form: two trades, full date", () => {
  const raw = player({ team: (s) => (s < 30 ? "ATL" : s < 61 ? "WAS" : "DEN") });
  const g = toTeamGames(raw, [J(30, raw, "ATL", "WAS", { reason: "trade" }), J(61, raw, "WAS", "DEN", { reason: "trade" })]);
  assert.deepEqual(tk(g), [[30, "Traded to WAS"], [61, "Traded to DEN"]]);
});

check("list-form: label is to_team even on a Not on team slot of the new team", () => {
  const raw = player({
    team: (s) => (s < 51 ? "CHI" : "BOS"),
    status: (s) => (s === 51 || s === 52 ? "not_on_team" : "played"),
  });
  const g = toTeamGames(raw, [J(51, raw, "CHI", "BOS", { reason: "trade" })]);
  assert.deepEqual(tk(g), [[51, "Traded to BOS"]]);
});

check("list-form: empty list = never traded (no team-change inference)", () => {
  const raw = player({ team: (s) => (s < 40 ? "ATL" : "LAL") });
  assert.deepEqual(tk(toTeamGames(raw, [])), []);
});

check("list-form replaces old per-slot flags", () => {
  const raw = player({ team: (s) => (s < 40 ? "ATL" : "LAL"), extra: (s) => ({ trade_marker: s === 10 }) });
  assert.deepEqual(tk(toTeamGames(raw, [J(40, raw, "ATL", "LAL")])), [[40, "Joined LAL"]]);
});

check("list-form: Cup final dropped earlier — seq still names the right slot", () => {
  const raw = player({ n: 83, team: (s) => (s < 60 ? "NYK" : "SAS"), extra: (s) => ({ is_cup_final: s === 25 }) });
  const g = toTeamGames(raw, [J(60, raw, "NYK", "SAS", { reason: "trade" })]);
  assert.equal(g.length, 82);
  assert.deepEqual(tk(g), [[59, "Traded to SAS"]]); // slot 60 is the 59th drawn
});

check("list-form: seq/date disagree → date wins (joins and exits)", () => {
  const raw = player({ team: (s) => (s < 54 ? "ATL" : "LAL"), status: (s) => (s === 30 ? "not_on_team" : "played") });
  const g = toTeamGames(raw, [{ ...J(54, raw, "ATL", "LAL"), game_seq: 53 }], [{ ...X(30, raw, "ATL", "waived"), game_seq: 29 }]);
  assert.deepEqual(tk(g), [[30, "Waived by ATL"], [54, "Joined LAL"]]);
});

check("old per-slot boolean marker / team-change fallback → 'Joined'", () => {
  const raw = player({ team: (s) => (s < 51 ? "CHI" : "BOS"), extra: (s) => ({ trade_marker: s === 51 }) });
  assert.deepEqual(tk(toTeamGames(raw), false), [[51, "Joined BOS"]]);
  assert.deepEqual(tk(toTeamGames(player({ team: (s) => (s < 51 ? "CHI" : "BOS") })), false), [[51, "Joined BOS"]]);
});

check("statuses: played/out/missed/not_on_team/offteam; played only from status", () => {
  const st = (s) => (s <= 5 ? "offteam" : s <= 10 ? "not_on_team" : s <= 15 ? "out" : s <= 20 ? "missed" : "played");
  const raw = player({ team: () => "IND", status: st, extra: (s) => (s === 12 ? { pts: 7, minutes: 0 } : {}) });
  const g = toTeamGames(raw, []);
  const c = (x) => g.filter((y) => y.status === x).length;
  assert.deepEqual([c("played"), c("missed"), c("not_on_team")], [62, 10, 10]);
  assert.ok(g.filter((y) => y.status !== "played").every((y) => y.pts === null));
});

check("all-Out entry keeps every slot (chart, not 'No 2025-26 games')", () => {
  const g = toTeamGames(player({ team: () => "IND", status: () => "out" }), []);
  assert.equal(g.length, 82);
  assert.ok(g.every((y) => y.status === "missed" && y.pts === null));
});

/** Bradley-like: waived IND before 37, signed IND 38, left IND 49, signed ATL 79. */
function bradleyLike() {
  const raw = player({
    team: (s) => (s < 79 ? "IND" : "ATL"),
    status: (s) => (s === 37 || (s >= 49 && s < 79) ? "not_on_team" : "played"),
  });
  return toTeamGames(
    raw,
    [J(38, raw, "IND", "IND", { reason: "signed" }), J(79, raw, "IND", "ATL", { reason: "signed" })],
    [X(37, raw, "IND", "waived"), X(49, raw, "IND", "contract_end")],
  );
}

check("wire round-trip keeps joins, reasons, exits and explicit flag", () => {
  const games = bradleyLike();
  const p = { cur: { games, slotTotal: 82, explicitTrades: true }, prev: null };
  const back = decodePlayerSlots(JSON.parse(JSON.stringify(encodePlayerSlots(p))));
  assert.deepEqual(back.cur.games, games);
  assert.equal(back.cur.explicitTrades, true);
  assert.deepEqual(tk(back.cur.games), tk(games));
});

check("row source: both seasons; default 'nba.com' (or missing) never on the wire, others round-trip as `c`; not drawn", () => {
  assert.equal(DEFAULT_SOURCE, "nba.com");
  const mk = (src) =>
    player({
      team: () => "ATL",
      status: (s) => (s === 12 || s === 13 ? "out" : s === 14 ? "not_on_team" : "played"),
      extra: (s) => ({
        ...src(s),
      }),
    });
  const tagged = (s) =>
    s === 12 ? { [SOURCE_FIELD]: "basketball-reference" }
    : s === 13 ? { [SOURCE_FIELD]: "  basketball-reference  " }
    : s === 14 ? { [SOURCE_FIELD]: "basketball-reference" }
    : s === 15 ? { [SOURCE_FIELD]: "   " }
    : s === 16 ? { [SOURCE_FIELD]: 7 }
    : s % 2 ? { [SOURCE_FIELD]: "nba.com" }
    : {};
  const games = toTeamGames(mk(tagged), []);
  assert.deepEqual(
    games.filter((g) => g.source !== DEFAULT_SOURCE).map((g) => [g.seq, g.status, g.source]),
    [[12, "missed", "basketball-reference"], [13, "missed", "basketball-reference"], [14, "not_on_team", "basketball-reference"]],
  );
  assert.ok(games.every((g) => typeof g.source === "string"), "missing/blank/non-string → default");
  const season = { games, slotTotal: 82, explicitTrades: true };
  const wire = encodePlayerSlots({ cur: season, prev: season }); // both seasons
  for (const s of [wire.a, wire.b]) {
    assert.deepEqual(s.g.flatMap((w, i) => ("c" in w ? [[i + 1, w.c]] : [])), [[12, "basketball-reference"], [13, "basketball-reference"], [14, "basketball-reference"]]);
  }
  const back = decodePlayerSlots(JSON.parse(JSON.stringify(wire)));
  assert.deepEqual(back.cur.games, games);
  assert.deepEqual(back.prev.games, games);
  // All-default / no-source rows encode byte-for-byte as before the field existed.
  const omit = (o, k) => Object.fromEntries(Object.entries(o).filter(([key]) => key !== k));
  const plain = mk(() => ({}));
  const allDefault = toTeamGames(mk(() => ({ [SOURCE_FIELD]: "nba.com" })), []);
  const none = toTeamGames(plain, []);
  const legacy = none.map((g) => omit(g, "source")); // pre-source TeamGame
  const enc = (gs) => JSON.stringify(encodePlayerSlots({ cur: { games: gs, slotTotal: 82, explicitTrades: true }, prev: null }));
  assert.equal(enc(allDefault), enc(legacy));
  assert.equal(enc(none), enc(legacy));
  assert.ok(!enc(allDefault).includes('"c"'));
  // Data-only: the chart's cells and ticks are the same with or without it.
  const bare = toTeamGames(mk(tagged).map((r) => omit(r, SOURCE_FIELD)), []);
  assert.deepEqual(tk(back.cur.games), tk(bare));
  assert.deepEqual(
    chartCells(dated(back.cur.games), 82, true).dated.map((g) => [g.slotKey, g.status, g.pts]),
    chartCells(dated(bare), 82, true).dated.map((g) => [g.slotKey, g.status, g.pts]),
  );
});

check("short wording (390 only): Traded / Signed / Joined / Waived / Left + team, no dates", () => {
  const raw = player({
    team: (s) => (s < 20 ? "ATL" : s < 40 ? "WAS" : s < 60 ? "DEN" : "BOS"),
    status: (s) => (s === 30 || s === 50 ? "not_on_team" : "played"),
  });
  const g = toTeamGames(
    raw,
    [J(20, raw, "ATL", "WAS", { reason: "trade" }), J(40, raw, "WAS", "DEN", { reason: "signed" }), J(60, raw, "DEN", "BOS")],
    [X(30, raw, "WAS", "waived"), X(50, raw, "DEN", "contract_end")],
  );
  assert.deepEqual(ticks(g, true).map((t) => [t.text, t.short]), [
    ["Traded to WAS", "Traded WAS"],
    ["Waived by WAS", "Waived WAS"],
    ["Signed with DEN", "Signed DEN"],
    ["Left DEN", "Left DEN"],
    ["Joined BOS", "Joined BOS"],
  ]);
});

// Pixel metrics: 390 (296px plot, 6px gap, 2px pad, narrow) and 1440 (998px
// plot, 8px gap, 3px pad, 12px type). Widths are estimates; the browser uses
// measured ones.
const M390 = { plotPx: 296, gapPx: 6, narrow: true, padPx: 2, widthPx: (t) => t.length * 6.4 };
const M1440 = { plotPx: 998, gapPx: 8, narrow: false, padPx: 3, widthPx: (t) => t.length * 7.3 };
const noOverlap = (labels, m) =>
  labels.every((l, i) =>
    labels.every((o, j) => j <= i || o.row !== l.row || l.x0 >= o.x1 + m.gapPx || o.x0 >= l.x1 + m.gapPx),
  );
const inside = (labels, m) => labels.every((l) => l.x0 >= 0 && l.x1 <= m.plotPx);
const sideRow = (L) => L.labels.map((l) => [l.text, l.side, l.row]);

check("4-marker Bradley-like stack: short at 390, full at 1440, right-then-left lowest row, no overlap, inside the plot", () => {
  const t = ticks(bradleyLike(), true);
  assert.deepEqual(t.map((x) => [x.ci + 1, x.text]), [[37, "Waived by IND"], [38, "Signed with IND"], [49, "Left IND"], [79, "Signed with ATL"]]);
  for (const [m, rows] of [[M390, 3], [M1440, 2]]) {
    const L = layoutTradeLabels(t, 82, m);
    assert.equal(L.rows, rows);
    assert.ok(!L.overflow && !L.merged);
    assert.ok(noOverlap(L.labels, m) && inside(L.labels, m));
  }
  // Rule as written: "Left IND" stays in row 3 (index 2) at 390.
  assert.deepEqual(sideRow(layoutTradeLabels(t, 82, M390)), [
    ["Waived IND", "right", 0],
    ["Signed IND", "right", 1],
    ["Left IND", "right", 2],
    ["Signed ATL", "left", 0],
  ]);
  assert.deepEqual(sideRow(layoutTradeLabels(t, 82, M1440)), [
    ["Waived by IND", "right", 0],
    ["Signed with IND", "right", 1],
    ["Left IND", "right", 0],
    ["Signed with ATL", "left", 0],
  ]);
});

check("text starts 4px right of its tick (right side) / ends 4px left of it (left side); pads 2px/3px", () => {
  const [r] = layoutTradeLabels([{ ci: 10, team: "PHI" }], 82, M390).labels;
  const x = (10 / 82) * 296;
  assert.equal(r.side, "right");
  assert.ok(Math.abs(r.x0 - (x + 2)) < 1e-9 && Math.abs(r.x1 - (x + 2 + M390.widthPx("Joined PHI") + 4)) < 1e-9);
  const [l] = layoutTradeLabels([{ ci: 80, team: "PHI" }], 82, M1440).labels;
  const x2 = (80 / 82) * 998;
  assert.equal(l.side, "left");
  assert.ok(Math.abs(l.x1 - (x2 - 1)) < 1e-9);
});

check("right first, then left, lowest row; up a row only if neither side fits", () => {
  // The second's right side runs past the plot: its left side, same row 0.
  const a = layoutTradeLabels([{ ci: 10, team: "MEM", text: "Traded to MEM", short: "Traded MEM" }, { ci: 79, team: "MIN", text: "Signed with MIN", short: "Signed MIN" }], 82, M390);
  assert.deepEqual(a.labels.map((l) => [l.side, l.row]), [["right", 0], ["left", 0]]);
  // Right side out of the plot and left side taken in row 0 → left side, row 1.
  const b = layoutTradeLabels([{ ci: 60, team: "MEM", text: "Traded to MEM", short: "Traded MEM" }, { ci: 79, team: "MIN", text: "Signed with MIN", short: "Signed MIN" }], 82, M390);
  assert.deepEqual(b.labels.map((l) => [l.side, l.row]), [["right", 0], ["left", 1]]);
  // Kyle-like: second tick just past the first's label start, neither side free in row 0.
  const k = layoutTradeLabels([{ ci: 51, team: "MEM", text: "Traded to MEM", short: "Traded MEM" }, { ci: 53, team: "MIN", text: "Signed with MIN", short: "Signed MIN" }], 83, M390);
  assert.deepEqual(k.labels.map((l) => [l.side, l.row]), [["right", 0], ["right", 1]]);
  // Near the right edge only the left side is inside the plot.
  const lone = layoutTradeLabels([{ ci: 78, team: "ATL" }], 82, M390);
  assert.deepEqual(lone.labels.map((l) => [l.side, l.row]), [["left", 0]]);
  const far = layoutTradeLabels([{ ci: 10, team: "PHI" }, { ci: 50, team: "BOS" }], 82, M390);
  assert.deepEqual(far.labels.map((l) => [l.side, l.row]), [["right", 0], ["right", 0]]);
  assert.equal(far.rows, 1);
});

/** RayJ-like synthetic: two exit→join pairs crowding one spot. */
const crowd = [
  { ci: 20, team: "IND", kind: "exit", text: "Waived by IND", short: "Waived IND" },
  { ci: 22, team: "LAC", kind: "join", text: "Signed with LAC", short: "Signed LAC" },
  { ci: 24, team: "LAC", kind: "exit", text: "Waived by LAC", short: "Waived LAC" },
  { ci: 27, team: "ATL", kind: "join", text: "Signed with ATL", short: "Signed ATL" },
];

check("4th row at 390 → merge exit + following join on the exit tick, join tick kept unlabelled, ≤3 rows", () => {
  const plain = layoutTradeLabels(crowd, 80, { ...M390, narrow: false, gapPx: 6, plotPx: 296, widthPx: M390.widthPx });
  assert.ok(plain.rows > 3, "the crowd needs a 4th row unmerged");
  const L = layoutTradeLabels(crowd, 80, M390);
  assert.equal(L.merged, true);
  assert.ok(L.rows <= MARKER_BAND_ROWS && !L.overflow);
  assert.ok(noOverlap(L.labels, M390) && inside(L.labels, M390));
  const m = L.labels.filter((l) => l.merged);
  assert.equal(m.length, 1);
  assert.match(m[0].text, /^(Waived IND · Signed LAC|Waived LAC · Signed ATL)$/);
  assert.equal(m[0].kind, "exit");
  // Every tick keeps its hairline; exactly the merged join has none.
  assert.equal(L.ticks.length, 4);
  assert.equal(L.ticks.filter((t) => t.row === null).length, 1);
  assert.equal(L.ticks.find((t) => t.row === null).kind, "join");
});

check("1440 never merges (full wording, even when crowded)", () => {
  const L = layoutTradeLabels(crowd, 80, { ...M1440, plotPx: 296 });
  assert.equal(L.merged, false);
  assert.ok(L.labels.every((l) => !l.merged && !l.text.includes("·")));
});

check("merge tie-break: closest exit→join ticks, then nearest the overflowing label, then left to right", () => {
  const ci = (i) => [20, 22, 30, 33, 50, 53][i];
  const A = [{ exit: 0, join: 1 }]; // gap 2
  const B = [{ exit: 2, join: 3 }]; // gap 3
  const C = [{ exit: 4, join: 5 }]; // gap 3
  assert.equal(pickMerge([B, A], ci, 33), A); // closest wins over nearest-to-overflow
  assert.equal(pickMerge([C, B], ci, 33), B); // tie on gap → nearest the overflowing label
  assert.equal(pickMerge([C, B], ci, 41.5), B); // full tie → left to right
});

check("more than 3 rows with nothing to merge → flagged overflow, clamped to the top band row (no 4th row)", () => {
  const t = [40, 41, 42, 43, 44].map((ci) => ({ ci, team: "IND", text: "Signed with IND", short: "Signed IND" }));
  const L = layoutTradeLabels(t, 82, M390);
  assert.equal(L.rows, 5);
  assert.equal(L.overflow, true);
  assert.equal(L.merged, false);
  assert.ok(L.labels.every((l) => l.row <= MARKER_BAND_ROWS - 1));
});

// Real players (tracked data files): wording at 1440 (full) and 390 (short).
const slots = loadPlayerSlots();
if (slots.size) {
  const byName = new Map(loadPointsRows().map((r) => [r.full_name, r.player_id]));
  const real = (name) => {
    const s = slots.get(byName.get(name))?.prev;
    assert.ok(s, `${name}: no 2025-26 slots`);
    const { dated } = chartCells(s.games, s.slotTotal, true);
    return tradeTicks(dated, true, s.explicitTrades);
  };
  const expect = {
    "Georges Niang": [["Traded to MEM", "Traded MEM"], ["Waived by MEM", "Waived MEM"]],
    "Tony Bradley": [["Waived by IND", "Waived IND"], ["Signed with IND", "Signed IND"], ["Left IND", "Left IND"], ["Signed with ATL", "Signed ATL"]],
    "Kyle Anderson": [["Traded to MEM", "Traded MEM"], ["Waived by MEM", "Waived MEM"], ["Signed with MIN", "Signed MIN"]],
    "Luke Kennard": [["Traded to LAL", "Traded LAL"]],
    "Tyus Jones": [["Traded to CHA", "Traded CHA"], ["Traded to DAL", "Traded DAL"], ["Waived by DAL", "Waived DAL"], ["Signed with DEN", "Signed DEN"]],
    "RayJ Dennis": [["Waived by IND", "Waived IND"], ["Signed with LAC", "Signed LAC"], ["Waived by LAC", "Waived LAC"], ["Signed with ATL", "Signed ATL"]],
  };
  for (const [name, want] of Object.entries(expect)) {
    check(`real: ${name} labels (1440 full / 390 short)`, () => {
      assert.deepEqual(real(name).map((t) => [t.text, t.short]), want);
    });
  }
} else {
  results.push("SKIP real-player wording (no data files)");
}

console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
const ran = results.filter((r) => !r.startsWith("SKIP")).length;
console.log(`${ran - failed}/${ran} passed`);
process.exit(failed ? 1 : 0);
