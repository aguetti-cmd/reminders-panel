import esbuild from "esbuild";
import { builtinModules } from "node:module";
import { readFileSync } from "node:fs";

const nodeBuiltins = [...builtinModules, ...builtinModules.map((m) => `node:${m}`)];

await esbuild.build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  format: "cjs",
  platform: "browser",
  target: "es2020",
  outfile: "main.js",
  external: ["obsidian", "electron", ...nodeBuiltins],
  sourcemap: false,
  minify: false,
  logLevel: "info",
});

// Mobile safety check. Node builtins may only be required inside functions.
// A require at column 0 (or a top level "var x = require(...)") would run at
// load time and crash the plugin on iPhone and iPad.
const out = readFileSync("main.js", "utf8");
const bad = [];
out.split("\n").forEach((line, i) => {
  const m = line.match(/require\(["']([^"']+)["']\)/g);
  if (!m) return;
  for (const call of m) {
    const name = call.slice(9, -2).replace(/^node:/, "");
    if (name === "obsidian") continue;
    const topLevel = !/^\s/.test(line);
    if (topLevel) bad.push(`line ${i + 1}: ${line.trim()}`);
  }
});
if (bad.length > 0) {
  console.error("Top level require of a non obsidian module found in main.js:");
  for (const b of bad) console.error("  " + b);
  process.exit(1);
}
console.log("Bundle check passed: no top level require of Node builtins or electron.");
