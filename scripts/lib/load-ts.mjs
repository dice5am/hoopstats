// Load src/lib/*.ts from a plain Node script (Node 20 has no type stripping):
// transpile with the project's TypeScript into node_modules/.cache and import.
// Keeps the loaders single-source in src/lib.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const OUT = path.join(ROOT, "node_modules", ".cache", "hoopstats-lib");

/** Transpile src/lib/<name>.ts (and its relative imports) and import it. */
export async function loadLib(name) {
  fs.mkdirSync(OUT, { recursive: true });
  const seen = new Set();
  const build = (n) => {
    if (seen.has(n)) return;
    seen.add(n);
    const src = fs.readFileSync(path.join(ROOT, "src", "lib", `${n}.ts`), "utf8");
    let js = ts.transpileModule(src, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        verbatimModuleSyntax: false,
      },
      fileName: `${n}.ts`,
    }).outputText;
    js = js.replace(/from "\.\/([\w-]+)"/g, (_, dep) => {
      build(dep);
      return `from "./${dep}.mjs"`;
    });
    fs.writeFileSync(path.join(OUT, `${n}.mjs`), js);
  };
  build(name);
  return import(pathToFileURL(path.join(OUT, `${name}.mjs`)).href + `?t=${Date.now()}`);
}
