// Renders the Insights-redesign phone mocks. Usage: node design/insights-redesign/build.mjs
// Numbers come from the LIVE site's default cell (3 seasons 2023–26, All; through 2026-11-09)
// via mock-data.json (trimmed copy of the live `deep` payload) plus values quoted from the live page text.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire("/tmp/pw/");
const { chromium } = require("playwright-core");
const D = JSON.parse(fs.readFileSync(path.join(here, "mock-data.json"), "utf8"));
const repo = path.resolve(here, "../..");

const fontsCss = fs.readFileSync(path.join(repo, "src/app/fonts.css"), "utf8").replaceAll("url(/fonts/", `url(file://${repo}/public/fonts/`);
const globals = fs.readFileSync(path.join(repo, "src/app/globals.css"), "utf8");
const grain = globals.match(/background-image:([\s\S]*?);\n}/)[1];
const tokens = fs.readFileSync(path.join(here, "tokens.css"), "utf8");
const css = fs.readFileSync(path.join(here, "mock.css"), "utf8").replace("/*GRAIN*/", `background-image:${grain};`);

/* ───────── formatting ───────── */
const sg = (n, d = 2) => (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n).toFixed(d);
const ci = (a, b, d = 2) => `${sg(a, d)} to ${sg(b, d)}`;
const num = (n) => n.toLocaleString("en-US");
const kindOf = (lo, hi, base = 0) => (lo > base ? "up" : hi < base ? "down" : "flat");

/* ───────── chart ───────── */
const INK = "#2b1d12", UP = "#e4572e", DOWN = "#5c4128", FLAT = "#c89a62", GRID = "rgba(106,76,46,.22)", LINE = "#fff8ee";
function scaler(min, max, W, log) {
  const f = log ? Math.log : (x) => x;
  return (v) => ((f(v) - f(min)) / (f(max) - f(min))) * W;
}
function rowSvg(r, o) {
  const { W, H = 30, x, ticks, base } = o;
  const k = r.thin ? "thin" : kindOf(r.lo, r.hi, base);
  let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${r.label}">`;
  if (r.thin) s += `<defs><pattern id="h${o.uid}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="rgba(106,76,46,.5)" stroke-width="1.4"/></pattern></defs>`;
  for (const t of ticks) s += `<line x1="${x(t)}" x2="${x(t)}" y1="0" y2="${H}" stroke="${GRID}" stroke-width="1"/>`;
  const cy = H / 2;
  if (r.band) s += `<rect x="${x(r.band[0])}" y="${cy - 9}" width="${x(r.band[1]) - x(r.band[0])}" height="18" fill="rgba(200,154,98,.38)"/>`;
  if (r.thin) {
    s += `<rect x="1" y="${cy - 7}" width="${W - 2}" height="14" fill="url(#h${o.uid})" stroke="rgba(106,76,46,.55)" stroke-width="1"/>`;
  } else {
    const fill = k === "up" ? UP : k === "down" ? DOWN : FLAT;
    if (o.mark === "dot") {
      s += `<line x1="${x(r.lo)}" x2="${x(r.hi)}" y1="${cy}" y2="${cy}" stroke="${INK}" stroke-width="2"/>`;
      s += `<line x1="${x(r.lo)}" x2="${x(r.lo)}" y1="${cy - 5}" y2="${cy + 5}" stroke="${INK}" stroke-width="2"/><line x1="${x(r.hi)}" x2="${x(r.hi)}" y1="${cy - 5}" y2="${cy + 5}" stroke="${INK}" stroke-width="2"/>`;
      if (r.ring) s += `<circle cx="${x(r.est)}" cy="${cy}" r="6.5" fill="${LINE}" stroke="${UP}" stroke-width="3.2"/>`;
      else s += `<circle cx="${x(r.est)}" cy="${cy}" r="6.5" fill="${k === "flat" ? LINE : fill}" stroke="${INK}" stroke-width="2"/>`;
    } else {
      const x0 = x(base), x1 = x(r.est);
      s += `<rect x="${Math.min(x0, x1)}" y="${cy - 7}" width="${Math.max(Math.abs(x1 - x0), 1.5)}" height="14" fill="${fill}" ${k === "flat" ? 'fill-opacity=".8" stroke="#7a5630" stroke-width="1.5"' : ""}/>`;
      s += `<line x1="${x(r.lo)}" x2="${x(r.hi)}" y1="${cy}" y2="${cy}" stroke="${INK}" stroke-width="2"/>`;
      s += `<line x1="${x(r.lo)}" x2="${x(r.lo)}" y1="${cy - 5}" y2="${cy + 5}" stroke="${INK}" stroke-width="2"/><line x1="${x(r.hi)}" x2="${x(r.hi)}" y1="${cy - 5}" y2="${cy + 5}" stroke="${INK}" stroke-width="2"/>`;
    }
  }
  s += `<line x1="${x(base)}" x2="${x(base)}" y1="0" y2="${H}" stroke="rgba(43,29,18,.75)" stroke-width="1.6" stroke-dasharray="2 3"/>`;
  return s + "</svg>";
}
let UID = 0;
/** variant detail: label/value line, full-width plot, CI + n line. compact: label | plot | value. */
function chart({ rows, min, max, ticks, base = 0, log = false, variant = "detail", mark = "bar", axisTitle, endL, endR, tickFmt, W = 324, valFmt }) {
  const uid = ++UID;
  const cw = variant === "detail" ? W : W - 92 - 62 - 16;
  const x = scaler(min, max, cw, log);
  const tf = tickFmt ?? ((t) => (t === base ? (base === 0 ? "0" : "1") : sg(t, Math.abs(t) < 1 && t !== 0 ? 1 : 0)));
  let h = `<div class="chart">`;
  for (const r of rows) {
    const k = r.thin ? "thin" : kindOf(r.lo, r.hi, base);
    const val = r.thin ? (r.thinVal ?? "n/a") : (valFmt ?? ((v) => sg(v)))(r.est);
    const svg = rowSvg(r, { W: cw, H: variant === "detail" ? 26 : 36, x, ticks, base, uid: uid + "_" + rows.indexOf(r), mark });
    if (variant === "detail") {
      h += `<div class="row"><div class="r1"><div class="nm">${r.label}${r.sub ? `<i> ${r.sub}</i>` : ""}</div><div class="v" ${r.thin && r.thinVal ? 'style="color:var(--hw-dim)"' : ""}>${val}${r.unit ? `<small>${r.unit}</small>` : ""}</div></div>${svg}<div class="r3"><span>${r.thin ? r.thinTxt ?? "too few games to read" : ci(r.lo, r.hi, r.d ?? 2)}</span><span>${r.n ?? ""}</span></div></div>`;
    } else {
      h += `<div class="crow"><div class="nm">${r.label}${r.sub ? `<i>${r.sub}</i>` : ""}</div>${svg}<div class="v">${val}</div></div>`;
    }
  }
  // axis
  const off = variant === "detail" ? 0 : 92 + 8;
  let ax = `<svg class="axis" width="${cw}" height="18" viewBox="0 0 ${cw} 18" style="margin-left:${off}px">`;
  for (const t of ticks) {
    const anchor = x(t) < 14 ? "start" : x(t) > cw - 14 ? "end" : "middle";
    ax += `<text x="${x(t)}" y="13" text-anchor="${anchor}" font-family="Inter" font-size="12" font-weight="${t === base ? 800 : 500}" fill="${INK}">${tf(t)}</text>`;
  }
  ax += `</svg>`;
  h += ax;
  if (axisTitle) h += `<div class="axt" style="margin-left:${off}px;width:${cw}px"><span>${endL ?? ""}</span><b>${axisTitle}</b><span>${endR ?? ""}</span></div>`;
  return h + `</div>`;
}
const LG = {
  up: `<span><i class="sw up"></i>Above</span>`,
  down: `<span><i class="sw down"></i>Below</span>`,
  flat: `<span><i class="sw flat"></i>Can’t tell</span>`,
  thin: `<span><i class="sw thin"></i>Too few games</span>`,
  whk: `<span><i class="whk"></i>95% CI</span>`,
  bl: `<span><i class="bl"></i>Baseline</span>`,
  ring: `<span><i class="sw ring"></i>Lead only</span>`,
  noise: `<span><i class="sw noise"></i>By chance</span>`,
  obs: `<span><i class="sw" style="background:var(--hw-ink)"></i>Flagged</span>`,
};
const legend = (...k) => `<div class="legend">${k.map((x) => LG[x]).join("")}</div>`;

/* ───────── card ───────── */
const BADGE = {
  up: `<span class="badge up">▲ Clear</span>`, down: `<span class="badge down">▼ Clear</span>`, flat: `<span class="badge flat">○ Not clear</span>`,
  thin: `<span class="badge thin">Too few games</span>`, pend: `<span class="badge pend">Study incoming</span>`, info: `<span class="badge info">Overview</span>`,
};
function card(c) {
  let h = `<article class="card" id="${c.id ?? ""}">`;
  h += `<div class="eb"><span class="t">${c.topic} · ${c.i} of ${c.n}</span>${BADGE[c.v]}</div>`;
  h += `<h2 class="ctitle">${c.title}</h2>`;
  if (c.headline) h += `<p class="hl">${c.headline}</p>`;
  if (c.scope) h += `<p class="scope">${c.scope}</p>`;
  if (c.how) h += `<div class="how"><b>How to read</b><span>${c.how}</span></div>`;
  if (c.views) h += `<div class="views">${c.views.map((v, i) => `<span class="${i === (c.viewOn ?? 0) ? "on" : ""}">${v}</span>`).join("")}</div>`;
  if (c.body) h += c.body;
  if (c.legend) h += c.legend;
  if (c.foot !== false) {
    h += `<div class="cfoot"><div class="disc"><span>Caveats &amp; sample<em>${c.sample ?? ""}</em></span><i class="chev ${c.open ? "up" : ""}"></i></div>${c.open ? `<div class="cav">${c.cav}</div>` : ""}</div>`;
  }
  return h + `</article>`;
}

/* ───────── chrome ───────── */
const TOPICS = [["Overview", null], ["Venue & rest", 5], ["Matchups", 5], ["Big nights", 4], ["Players", 6], ["Drivers", 3]];
const rail = (on, shift = 0) => `<div class="rail" style="padding-left:${16 - shift}px">${TOPICS.map(([n, c]) => `<span class="chip ${n === on ? "on" : ""}">${n}${c ? `<span class="ct">${c}</span>` : ""}</span>`).join("")}</div>`;
const fbar = ({ ts = "3 seasons 2023–26", seg = "All", mod = false, loc }) =>
  `<div class="fbar"><div class="pill ts ${mod ? "" : ""}"><span class="pl">Timespan</span><span class="pv">${ts}</span><i class="caret"></i></div><div class="pill sg ${mod ? "mod" : ""}"><span class="pl">Segment</span><span class="pv">${seg}</span><i class="caret"></i></div>${mod ? `<div class="reset" aria-label="Reset filters">↺</div>` : loc ? `<div class="loc">${loc[0]}<b>${loc[1]}</b></div>` : ""}</div>`;
const nav = `<div class="nav"><div class="brand"><span class="ball"></span>hoopstats</div><div class="links"><span class="link on">Insights</span><span class="link">Players</span></div></div>`;
const thead = (t, n, q, scanOn = false) => `<header class="thead"><div class="trow"><h1>${t}</h1><div class="seg"><span class="${scanOn ? "" : "on"}">Full</span><span class="${scanOn ? "on" : ""}">Scan</span></div></div><div class="cnt">${n} findings</div><p>${q}</p></header>`;

const screens = {};
const shell = ({ stack, body, top = 0, extra = "", flow = false }) =>
  `<div class="screen">${flow ? `<div class="content" style="top:${top}px">${nav}${`<div class="stack flow">${stack}</div>`}${body}</div>` : `<div class="stack">${stack}</div><div class="content" style="top:${100 - top}px">${body}</div>`}${extra}</div>`;
/* note: in non-flow screens the content starts under the 100px sticky stack; `top` = how far the page is scrolled (px) */

/* ───────── data builders ───────── */
function defRows(cell, big = false) {
  const m = [["opp_defence_nested:worst5", "Worst 5", "vs other 25"], ["opp_defence_nested:worst10", "Worst 10", "vs other 20"], ["opp_defence_nested:best10", "Best 10", "vs other 20"], ["opp_defence_nested:best5", "Best 5", "vs other 25"]];
  return m.map(([k, label, sub]) => { const e = cell.eff[k].dev; return { label, sub, est: e.d, lo: e.lo, hi: e.hi, n: `${num(e.nl)} vs ${num(e.nr)} games`, thin: e.sup }; });
}
const ALL = D.cells.pooled_2023_26.all, T50 = D.cells.pooled_2023_26.top50;
const defAxis = { min: -1, max: 1, ticks: [-1, -0.5, 0, 0.5, 1], tickFmt: (t) => (t === 0 ? "0" : sg(t, Math.abs(t) === 1 ? 0 : 1)) };
const matchChart = (cell, ax = defAxis) => chart({ rows: defRows(cell), ...ax, mark: "bar", axisTitle: "Points vs his prior average (pts)", endL: "← fewer", endR: "more →" });

/* ── 01 overview ── */
{
  const dots = (a) => a.map((v) => `<i class="dot ${v}"></i>`).join("");
  const tiles = [
    ["Venue &amp; rest", 5, "Do home, back-to-backs, rest move scoring?", ["flat", "up", "flat", "down", "up"]],
    ["Matchups", 5, "Who scores more against weak defences?", ["up", "up", "up", "flat", "up"]],
    ["Big nights", 4, "What makes a +10 or ×1.25 night more likely?", ["up", "up", "flat", "pend"]],
    ["Players", 6, "Are named players real, or noise?", ["flat", "flat", "info", "flat", "flat", "flat"]],
    ["Drivers", 3, "Which box-score measures go with points?", ["up", "flat", "flat"]],
  ];
  const body = `<header class="thead" style="padding:8px 0 10px;gap:6px"><div class="trow"><h1>Insights</h1></div><div class="cnt">5 topics · 23 findings · through 2026-11-09</div></header>` +
    tiles.map(([t, n, q, d]) => `<div class="tile"><h3>${t}</h3><div class="n">${n}</div><div class="q">${q}</div><div class="dots">${dots(d)}<span class="go">Open →</span></div></div>`).join("") +
    `<div class="legend" style="padding:2px 2px 0"><span><i class="dot up" style="width:12px;height:12px;margin:0"></i>Clear ▲</span><span><i class="dot down" style="width:12px;height:12px;margin:0"></i>Clear ▼</span><span><i class="dot flat" style="width:12px;height:12px;margin:0"></i>Not clear</span><span><i class="dot info" style="width:12px;height:12px;margin:0"></i>Descriptive</span><span><i class="dot pend" style="width:12px;height:12px;margin:0"></i>Incoming</span></div>`;
  screens["01-topic-index"] = shell({ flow: true, stack: rail("Overview") + fbar({}), body });
}

/* ── 02 matchups with filter bar (Top 50 applied) ── */
{
  const e = T50.eff, w5 = e["opp_defence_nested:worst5"].dev, b10 = e["opp_defence_nested:best10"].dev;
  const c = card({
    topic: "Matchups", i: 1, n: 5, v: "up", title: "Defence tiers", id: "defence-tiers",
    headline: `Top‑50 scorers get ${w5.d.toFixed(1)} more points than usual against the 5 worst defences, and ${Math.abs(b10.d).toFixed(1)} fewer against the 10 best.`,
    scope: `3 seasons 2023–26 · Top 50 · PPG 19.5–32.2 · 50 players, ${num(T50.n_games)} games`,
    how: "Each bar: points above his own average vs that group of defences.",
    views: ["Points", "Big night +10", "×1.25"], body: matchChart(T50, { min: -2, max: 2, ticks: [-2, -1, 0, 1, 2], tickFmt: (t) => (t === 0 ? "0" : sg(t, 0)) }), legend: legend("up", "down", "flat", "whk"), sample: `n = ${num(T50.n_games)} games`,
  });
  const peek = `<article class="card" style="height:90px;overflow:hidden"><div class="eb"><span class="t">Matchups · 2 of 5</span><span class="badge up">▲ Clear</span></div><h2 class="ctitle">Opponent tiers</h2></article>`;
  screens["02-topic-with-filter-bar"] = shell({ top: 94, stack: rail("Matchups") + fbar({ seg: "Top 50", mod: true }), body: thead("Matchups", 5, "Do players score more against weak defences, less against strong ones, and for whom?") + c + peek });
}

/* ── shared sample card: Defence tiers default (anatomy + expanded) ── */
const DT = (open) => card({
  topic: "Matchups", i: 1, n: 5, v: "up", title: "Defence tiers", id: "defence-tiers", open,
  headline: "Players score about 0.6 more points against the 5 worst defences and about 0.6 fewer against the 10 best.",
  scope: `3 seasons 2023–26 · All · 668 players, ${num(ALL.n_games)} games`,
  how: "Each bar: points above his own average vs that group of defences.",
  views: ["Points", "Big night +10", "×1.25"], body: matchChart(ALL), legend: legend("up", "down", "flat", "whk"), sample: "n = 65,085 games",
  cav: `<div class="facts"><div class="fact"><b>668</b><span>Players</span></div><div class="fact"><b>65,085</b><span>Games</span></div><div class="fact"><b>≥ 30</b><span>Games per side</span></div></div>
<div><h4>Caveats</h4><ul><li>Associations only, not causes.</li><li>Defences are ranked on their season-to-date rating <b>before tip-off</b>, so it is all known pregame.</li><li>A contrast with fewer than 30 games on either side is blanked, not drawn.</li><li>Each group is compared with all other defences, so the groups overlap (Worst 5 sits inside Worst 10).</li></ul></div>
<div><h4>Method</h4><ul><li>Points above his own prior season-to-date average; 95% interval by player-clustered bootstrap. Data through 2026-11-09.</li></ul></div>
<div class="cact"><span class="btn pri">Copy link to card</span><span class="btn ghost">Method</span></div>`,
});

/* ── 03 anatomy ── */
const meta = {};
{
  const key = `<div class="key"><div><span><b>1</b>Topic · place · verdict</span><span><b>2</b>Card title</span><span><b>3</b>One-sentence finding</span><span><b>4</b>Scope: span · segment · n</span><span><b>5</b>How to read (≤2 lines)</span><span><b>6</b>View switch (≤4)</span><span><b>7</b>Chart, shared axis + unit</span><span><b>8</b>Legend: see next screen</span><span><b>9</b>Caveats: next screen</span></div></div>`;
  screens["03-insight-card-collapsed"] = shell({ top: 0, stack: rail("Matchups") + fbar({ loc: ["Matchups", "1/5"] }), body: DT(false), extra: key });
  meta["03-insight-card-collapsed"] = { anchor: ["#defence-tiers", 108], card: true, co: [[1, ".eb"], [2, ".ctitle"], [3, ".hl"], [4, ".scope"], [5, ".how"], [6, ".views"], [7, ".chart"], [8, ".legend"], [9, ".disc"]] };
}

/* ── 04 expanded caveats ── */
screens["04-card-expanded-caveats"] = shell({ top: 560, stack: rail("Matchups") + fbar({ loc: ["Matchups", "1/5"] }), body: DT(true) });
meta["04-card-expanded-caveats"] = { anchor: [".chart .row:nth-child(4)", 112], co: [[8, ".legend"], [9, ".disc"]] };

/* ── 05 chart legibility (stability) ── */
{
  const per = [["2023_24", "2023-24"], ["2024_25", "2024-25"], ["2025_26", "2025-26"]].map(([k, l]) => { const m = D.cells[k].top50.eff["opp_defence_nested:worst5"].dev; return { label: l, est: m.d, lo: m.lo, hi: m.hi, n: `${num(m.nl)} vs ${num(m.nr)} games` }; });
  per.push({ label: "2026-27", thin: true, thinTxt: "too few games to read · early sample", n: "237 games", est: 0, lo: 0, hi: 0 });
  const c = card({
    topic: "Matchups", i: 4, n: 5, v: "flat", title: "Stable season to season?", id: "stability",
    headline: "For the top 50 the lift against the 5 worst defences shrank every year: +2.10, +1.13, then +0.52, which can’t be told from zero.",
    scope: "Top 50 · worst 5 vs other 25 · each season on its own",
    body: chart({ rows: per, min: -2, max: 4, ticks: [-2, 0, 2, 4], mark: "bar", axisTitle: "Points vs his prior average (pts)", endL: "← fewer", endR: "more →", tickFmt: (t) => (t === 0 ? "0" : sg(t, 0)) }),
    legend: legend("up", "flat", "thin", "whk", "bl"), foot: false,
  });
  const key = `<div class="key"><div style="grid-template-columns:1fr"><span><b>1</b><strong>Whisker = 95% CI.</strong> The range the true value likely sits in. If it touches the dotted line, we can’t tell it from no change.</span><span><b>2</b><strong>Dotted line = baseline</strong>, labelled “0” (“1” for odds ratios), on every chart.</span><span><b>3</b><strong>Orange ▲ / brown ▼ = clear</strong> (interval clears the baseline). <strong>Tan = can’t tell.</strong></span><span><b>4</b><strong>Hatched = too few games:</strong> no bar drawn, only the reason and n.</span></div></div>`;
  screens["05-chart-legibility"] = shell({ top: 0, stack: rail("Matchups") + fbar({ loc: ["Matchups", "4/5"] }), body: c, extra: key });
  meta["05-chart-legibility"] = { anchor: ["#stability", 112], co: [[1, ".chart .row:nth-child(1) svg", 284, 2, "abs"], [2, ".chart .row:nth-child(1) svg", 98, -26, "abs"], [3, ".chart .row:nth-child(3)", -10, 28, "card"], [4, ".chart .row:nth-child(4)", -10, 28, "card"]] };
}

/* ── 06 filter sheet ── */
{
  const tsOpts = [["4 seasons pooled", "2023-24 → 2026-27", 0], ["3 seasons 2023–26", "complete seasons", 1], ["2023-24", "full season", 0], ["2024-25", "full season", 0], ["2025-26", "full season", 0], ["2026-27", "to 2026-11-09", 0, "early"]];
  const sgOpts = [["All", "every ranked player", 1], ["Top 100", "PPG ≥ 14.8", 0], ["Top 50", "PPG ≥ 19.5", 0], ["Top 25", "PPG ≥ 22.9", 0, "thin"], ["Top 10", "PPG ≥ 26.3", 0, "thin"]];
  const o = (n, s, on, tag) => `<div class="opt ${on ? "on" : ""} ${tag === "thin" ? "thinopt" : ""}"><b>${n}</b><i>${s}</i>${tag ? `<span class="tag">${tag}</span>` : ""}</div>`;
  const sheet = `<div class="scrim"></div><div class="sheet"><div class="grab"></div><h2>Filters</h2><div class="cnt" style="text-transform:none;letter-spacing:0;font:var(--t-small)">Applies to every card in Matchups. Data through 2026-11-09.</div>
<div class="glab"><span>Timespan</span></div><div class="opts">${tsOpts.map((x) => o(...x)).join("")}</div>
<div class="glab"><span>Segment (top scorers by PPG)</span><span style="text-transform:none;letter-spacing:0;font:var(--t-small)">hatched = too few games</span></div><div class="opts three">${sgOpts.slice(0, 3).map((x) => o(...x)).join("")}</div><div class="opts" style="margin-top:8px">${sgOpts.slice(3).map((x) => o(...x)).join("")}</div>
<div class="note"><b>Role &amp; position</b> uses timespan only; it shows a “segment n/a” chip. Rankings and flags are timespan-only too.</div>
<div class="sfoot"><span class="btn ghost">Reset</span><span class="btn pri">Show 5 findings</span></div></div>`;
  const c = card({ topic: "Matchups", i: 1, n: 5, v: "up", title: "Defence tiers", headline: "Players score about 0.6 more points against the 5 worst defences and about 0.6 fewer against the 10 best.", scope: "3 seasons 2023–26 · All", foot: false });
  screens["06-filter-sheet-open"] = shell({ top: 80, stack: rail("Matchups") + fbar({ loc: ["Matchups", "1/5"] }), body: thead("Matchups", 5, "Do players score more against weak defences, less against strong ones, and for whom?") + c, extra: sheet });
}

/* ── 07 big nights placeholder ── */
{
  const ghost = ["Bounce-back", "Matchup", "Pace", "Rest", "Teammates out"].map((f) => `<div class="crow" style="opacity:.85;grid-template-columns:118px 1fr 40px"><div class="nm">${f}</div><div class="hatch" style="height:14px;border:1.5px solid rgba(106,76,46,.5)"></div><div class="v" style="color:var(--hw-dim)">n/a</div></div>`).join("");
  const study = `<article class="card" id="big-night-study" style="border-style:dashed;border-color:rgba(106,76,46,.6);background:rgba(255,248,238,.4)">
  <div class="eb"><span class="t">Big nights · 4 of 4</span>${BADGE.pend}</div><h2 class="ctitle">Why big nights happen</h2>
  <div class="empty"><h5>No study yet</h5><p>This card holds the place for the big-nights study and shows no numbers until it ships.</p></div>
  <div class="how"><b>Will show</b><span>How much each factor changes the odds of a big night, as odds ratios (1 = no change), same colours and whiskers.</span></div>
  <div style="display:flex;gap:10px;flex-wrap:wrap"><div><div class="glab" style="margin:0 0 4px"><span>Outcome</span></div><div class="views" style="opacity:.55"><span class="on">×1.25</span><span>×1.5</span><span>×2</span></div></div><div><div class="glab" style="margin:0 0 4px"><span>Lens</span></div><div class="views" style="opacity:.55"><span class="on">Pregame</span><span>Same game</span></div></div></div>
  <div class="glab" style="margin:0"><span>Factors (planned)</span><span style="text-transform:none;letter-spacing:0;font:var(--t-small)">layout preview, no data</span></div>
  <div class="chart" style="margin-bottom:12px">${ghost}</div></article>`;
  const topic = thead("Big nights", 4, "What makes a +10 or ×1.25 night more likely?");
  screens["07-big-nights-placeholder"] = shell({ top: 0, stack: rail("Big nights") + fbar({ loc: ["Big nights", "4/4"] }), body: topic + study });
  meta["07-big-nights-placeholder"] = { anchor: ["#big-night-study", 118] };
}

/* ── 08 scan mode (Venue & rest) ── */
{
  const rows = [
    ["up", "B2B 2nd night", "Players score more on the second night because they play more minutes, not because they score faster.", "+0.28", "pts"],
    ["down", "Rest days", "With 3+ days off players score less than usual, compared with one day off.", "−0.33", "pts"],
    ["flat", "Home vs away", "No clear change at home: about the same, within noise.", "+0.09", "pts"],
    ["flat", "B2B 1st night", "No clear change on the first night of a back-to-back.", "+0.05", "pts"],
    ["up", "Swing", "Game-to-game spread is the same at home and on a first night, slightly wider on a second night.", "1.02×", "2nd night"],
  ];
  const body = thead("Venue &amp; rest", 5, "Do home, back-to-backs and rest days move scoring?", true) +
    rows.map(([v, t, h, val, u], i) => `<div class="scan"><i class="dot ${v}"></i><div><div class="st">${i + 1} of 5 · ${t}</div><div class="sh">${h}</div></div><div class="sv">${val}<small>${u}</small></div></div>`).join("") +
    `<div class="note" style="margin:0 2px">Tap a row to open its card. Scan keeps headlines and verdicts; Full adds chart, how to read and caveats.</div>`;
  screens["08-topic-scan-mode"] = shell({ top: 80, stack: rail("Venue & rest") + fbar({ loc: ["Venue & rest", "1/5"] }), body });
}

/* ── 09 players: rankings with leads and thin ── */
{
  const R = [["Zyon Pullin", 4.6, -6.908, 16.108, 5, 3, "thin"], ["Elijah Harkless", 4.364, 0.457, 8.27, 14, 22, "ring"], ["Ace Bailey", 3.82, 0.267, 7.374, 37, 35, "ring"], ["Cedric Coward", 3.643, 0.855, 6.431, 32, 28, "ring"], ["Brandon Ingram", 3.4, 1.031, 5.769, 79, 80, "ring"]];
  const rows = R.map(([nm, e, lo, hi, a, b, f]) => ({ label: nm, est: e, lo, hi, n: `${a} home · ${b} away games`, ring: f === "ring", thin: f === "thin", thinTxt: ci(lo, hi), thinVal: sg(e) }));
  const ch = chart({ rows, min: -8, max: 18, ticks: [-8, 0, 8, 16], mark: "dot", axisTitle: "Home minus away (pts)", endL: "← better away", endR: "better home →", tickFmt: (t) => (t === 0 ? "0" : sg(t, 0)) });
  const rk = card({
    topic: "Players", i: 2, n: 6, v: "flat", title: "Rankings: biggest home gaps", id: "rankings",
    headline: "The biggest home-away gaps belong to players with few games, and no player passes the correction for testing hundreds of people.",
    scope: "3 seasons 2023–26 · 443 ranked · highest 25, top 5 shown", how: "Each dot is one player’s home-minus-away points. A ring is a lead to check, not a proven gap.",
    views: ["Home/away", "B2B 2nd", "B2B 1st"], body: ch, legend: legend("flat", "ring", "thin", "whk"), sample: "0 strong flags", foot: true, open: false,
  });
  screens["09-players-topic"] = shell({ top: 0, stack: rail("Players") + fbar({ loc: ["Players", "2/6"] }), body: rk });
  meta["09-players-topic"] = { anchor: ["#rankings", 108] };
}

/* ── 11 players: flags vs chance ── */
{
  const T = [["Home vs away", 549, 6, 6.8], ["B2B 2nd night", 532, 4, 6.6], ["Worst-5 defences", 520, 6, 6.5], ["Worst-10 defences", 530, 1, 6.6]];
  const bar = (v, c) => `<div style="height:12px;width:${(v / 8) * 100}%;background:${c}"></div>`;
  const fl = `<div class="chart">` + T.map(([n, p, w, ch]) => `<div class="row"><div class="r1"><div class="nm">${n}<i> n=${p}</i></div><div class="v">${w}<small>vs ${ch}</small></div></div><div style="display:flex;flex-direction:column;gap:3px;margin:5px 0 2px">${bar(w, "var(--hw-ink)")}${bar(ch, "var(--d-noise)")}</div></div>`).join("") + `<div class="axt"><b>Players flagged (watch) per test</b><span>vs expected by chance · strong: 0</span></div></div>`;
  const fcard = card({
    topic: "Players", i: 1, n: 6, v: "flat", title: "Flags vs chance", id: "flags",
    headline: "17 players are flagged across four tests; chance alone would flag about 27, and none survive the correction.",
    scope: "3 seasons 2023–26 · Points · timespan only (segment n/a)", how: "Black = players flagged. Tan = how many pure noise would flag.", views: ["Points", "Big night +10", "×1.25"],
    body: fl, legend: legend("obs", "noise"), sample: "0 strong", open: false,
  });
  screens["11-players-flags-vs-chance"] = shell({ top: 0, stack: rail("Players") + fbar({ loc: ["Players", "1/6"] }), body: fcard + `<div class="chip" style="display:none"></div>` });
  meta["11-players-flags-vs-chance"] = { anchor: ["#flags", 108] };
}

/* ── 10 card states ── */
{
  const loading = `<article class="card" id="st-load" aria-busy="true"><div class="eb"><span class="t">Matchups · 3 of 5</span><span class="sk" style="width:70px;height:22px"></span></div><h2 class="ctitle">Stars vs everyone</h2><div class="sk" style="width:100%"></div><div class="chart">${[0].map(() => `<div class="crow" style="grid-template-columns:70px 1fr 40px"><div class="sk" style="height:10px"></div><div class="sk" style="height:14px"></div><div class="sk" style="height:10px"></div></div>`).join("")}</div><div style="height:4px"></div></article>`;
  const thinC = `<article class="card" id="st-thin"><div class="eb"><span class="t">Matchups · 1 of 5</span>${BADGE.thin}</div><h2 class="ctitle">Defence tiers</h2><p class="scope">2026-27 to date · Top 50 · early sample</p><div class="empty"><h5>Too few games to read</h5><p>237 player-games for the top 50 this season. Nothing is drawn; we won’t guess.</p><div class="cact"><span class="btn pri">Show All</span><span class="btn ghost">Show 2025-26</span></div></div><div style="height:2px"></div></article>`;
  const err = `<article class="card" id="st-err"><div class="eb"><span class="t">Matchups · 5 of 5</span><span class="badge info">Error</span></div><h2 class="ctitle">Role &amp; position</h2><div class="empty" style="border-style:solid;border-color:var(--hw-ink)"><h5>Couldn’t load this card</h5><div class="cact"><span class="btn pri">Try again</span></div></div><div style="height:2px"></div></article>`;
  const lab = (t) => `<div class="cnt" style="margin:0 0 6px">${t}</div>`;
  screens["10-card-states"] = shell({ top: 0, stack: rail("Matchups") + fbar({ ts: "2026-27", seg: "Top 50", mod: true }), body: lab("1 · Loading: skeleton in the final layout") + loading + lab("2 · Empty / too few games") + thinC + lab("3 · Error") + err });
  meta["10-card-states"] = { anchor: ["#st-load", 128] };
}

/* ───────── render ───────── */
const html = (inner) => `<!doctype html><html><head><meta charset="utf-8"><style>${fontsCss}\n${tokens}\n${css}</style></head><body>${inner}</body></html>`;
fs.mkdirSync(path.join(here, "src"), { recursive: true });
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
for (const [name, inner] of Object.entries(screens)) {
  const f = path.join(here, "src", name + ".html");
  fs.writeFileSync(f, html(inner));
  await page.goto("file://" + f);
  await page.evaluate(() => document.fonts.ready);
  const m = meta[name] ?? {};
  await page.evaluate(({ m }) => {
    const c = document.querySelector(".content");
    if (m.anchor) {
      const el = document.querySelector(m.anchor[0]);
      const top = parseFloat(c.style.top || "0") + (m.anchor[1] - el.getBoundingClientRect().top);
      c.style.top = top + "px";
    }
    const scr = document.querySelector(".screen");
    for (const [n, sel, dx, dy, mode] of m.co ?? []) {
      const el = document.querySelector(sel);
      const r = el.getBoundingClientRect();
      const card = (el.closest(".card") ?? el).getBoundingClientRect();
      const d = document.createElement("i"); d.className = "co"; d.textContent = n;
      if (mode === "abs") { d.style.left = r.left + dx + "px"; d.style.top = r.top + dy + "px"; }
      else if (mode === "card") { d.style.left = card.left + dx + "px"; d.style.top = r.top + dy + "px"; }
      else { d.style.left = card.left - 11 + "px"; d.style.top = r.top + 2 + "px"; }
      scr.appendChild(d);
    }
  }, { m });
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(here, name + ".png"), clip: { x: 0, y: 0, width: 390, height: 844 } });
  console.log("rendered", name);
}
await browser.close();
