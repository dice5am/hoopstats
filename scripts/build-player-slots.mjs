#!/usr/bin/env node
// prebuild: write public/slots/<player_id>.json (both seasons' chart slots)
// from the same loaders the page uses (src/lib/betting.ts). Generated output,
// git-ignored. The page itself embeds only the search index, tiles and last 5.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { loadLib } from "./lib/load-ts.mjs";

const { loadPlayerSlots } = await loadLib("betting");
const { encodePlayerSlots } = await loadLib("teamGames");

const dir = path.join(process.cwd(), "public", "slots");
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });

const slots = loadPlayerSlots();
const sizes = [];
let withPrev = 0;
for (const [id, p] of slots) {
  if (!/^[\w-]+$/.test(id)) throw new Error(`unsafe player_id ${id}`);
  const body = JSON.stringify(encodePlayerSlots(p));
  fs.writeFileSync(path.join(dir, `${id}.json`), body);
  sizes.push({ raw: body.length, gz: zlib.gzipSync(body).length });
  if (p.prev !== null) withPrev++;
}
const sum = (k) => sizes.reduce((a, s) => a + s[k], 0);
const range = (k) =>
  sizes.length ? `${Math.min(...sizes.map((s) => s[k]))}–${Math.max(...sizes.map((s) => s[k]))}` : "0";
console.log(
  `slots: ${sizes.length} files in public/slots (2025-26 ${withPrev ? "included" : "absent"}) · ` +
    `raw ${range("raw")} B each, ${(sum("raw") / 1024).toFixed(0)} KB total · ` +
    `gzip ${range("gz")} B each, ${(sum("gz") / 1024).toFixed(0)} KB total`,
);
