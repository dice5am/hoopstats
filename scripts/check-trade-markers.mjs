#!/usr/bin/env node
// Fixture-free check: synthetic players (built inline) through the real
// loader (toTeamGames) and the chart's tick placement (tradeTicks), plus the
// /slots wire round-trip. Exits 1 on any failure.
import assert from "node:assert/strict";
import { loadLib } from "./lib/load-ts.mjs";

const { toTeamGames } = await loadLib("betting");
const { tradeTicks, layoutTradeLabels, encodePlayerSlots, decodePlayerSlots, MARKER_BAND_ROWS, exitReasonOf, joinReasonOf } =
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

// Pixel metrics: 390 (296px plot, 6px gap) and 1440 (998px plot, 8px gap, 12px type).
const M390 = { plotPx: 296, gapPx: 6, widthPx: (t) => t.length * 6.4 };
const M1440 = { plotPx: 998, gapPx: 8, widthPx: (t) => t.length * 7.3 };
const noOverlap = (labels, C, m) => {
  const box = (l) => {
    const x = (l.ci / C) * m.plotPx;
    const w = m.widthPx(l.text);
    const a = l.align === "left" ? x + 4 : x - 4 - w;
    return [a, a + w];
  };
  return labels.every((l, i) =>
    labels.every((o, j) => {
      if (j <= i || o.row !== l.row) return true;
      const [a, b] = box(l);
      const [c, d] = box(o);
      return a >= d + m.gapPx || c >= b + m.gapPx;
    }),
  );
};

check("4-marker Bradley-like stack: lowest free row, 3 rows at 390, no overlap, inside the plot", () => {
  const t = ticks(bradleyLike(), true);
  assert.deepEqual(t.map((x) => [x.ci + 1, x.text]), [[37, "Waived by IND"], [38, "Signed with IND"], [49, "Left IND"], [79, "Signed with ATL"]]);
  for (const [m, rows] of [[M390, 3], [M1440, 2]]) {
    const L = layoutTradeLabels(t, 82, m);
    assert.equal(L.rows, rows);
    assert.ok(L.rows <= MARKER_BAND_ROWS && !L.overflow);
    assert.ok(noOverlap(L.labels, 82, m));
    for (const l of L.labels) {
      const x = (l.ci / 82) * m.plotPx, w = m.widthPx(l.text);
      assert.ok(l.align === "left" ? x + 4 + w <= m.plotPx : x - 4 - w >= 0, `${l.text} inside plot`);
    }
  }
  assert.deepEqual(layoutTradeLabels(t, 82, M390).labels.map((l) => [l.text, l.row, l.align]), [
    ["Waived by IND", 0, "right"],
    ["Signed with IND", 1, "right"],
    ["Left IND", 2, "right"],
    ["Signed with ATL", 0, "right"],
  ]);
});

check("Kyle-style two close labels stack — second one row up, both end at their ticks", () => {
  const L = layoutTradeLabels([{ ci: 51, team: "MEM", text: "Traded to MEM" }, { ci: 62, team: "MIN", text: "Traded to MIN" }], 83, M390);
  assert.deepEqual(L.labels.map((l) => [l.row, l.align]), [[0, "right"], [1, "right"]]);
});

check("far labels share row 0; lone label near the right edge flips left of its tick", () => {
  const far = layoutTradeLabels([{ ci: 10, team: "PHI" }, { ci: 50, team: "BOS" }], 82, M390);
  assert.deepEqual(far.labels.map((l) => [l.row, l.align]), [[0, "left"], [0, "left"]]);
  assert.equal(far.rows, 1);
  const lone = layoutTradeLabels([{ ci: 78, team: "ATL" }], 82, M390);
  assert.deepEqual(lone.labels.map((l) => [l.row, l.align]), [[0, "right"]]);
});

check("more than 3 rows needed → flagged overflow, clamped to the top band row (no 4th row)", () => {
  const t = [40, 41, 42, 43, 44].map((ci) => ({ ci, team: "IND", text: "Signed with IND" }));
  const L = layoutTradeLabels(t, 82, M390);
  assert.equal(L.rows, 5);
  assert.equal(L.overflow, true);
  assert.ok(L.labels.every((l) => l.row <= MARKER_BAND_ROWS - 1));
});

console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
