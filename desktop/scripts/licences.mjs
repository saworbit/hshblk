/**
 * docs/hld.md §10, for what is bundled into the webview: every package the app depends on at
 * run time is under a licence on the list. cargo deny checks the Rust side.
 *
 *   node scripts/licences.mjs
 *
 * Reads package-lock.json, so it checks what npm ci installs.
 */
import { readFileSync } from "node:fs";

const ALLOWED = new Set([
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "Zlib",
  "Unicode-3.0",
  "MPL-2.0",
]);

/** Fonts bundled with the app may be OFL-1.1, and only fonts. */
const FONTS = /^@fontsource(-variable)?\//;

/**
 * Packages taken by name, each read by hand, as deny.toml's exceptions are: what its licence is,
 * where its package.json says nothing true of it, and why it may ship. Both come with mermaid
 * (#221).
 */
const EXCEPTIONS = new Map([
  // Its package.json names no licence. Its license file is MIT.
  ["khroma", "MIT"],
  // The Unlicense dedicates it to the public domain, which asks less than any licence on the
  // list. It is d3's Delaunay triangulation's arithmetic.
  ["robust-predicates", "Unlicense"],
]);

/** Whether an SPDX expression is satisfied: any alternative of OR, every term of AND. */
function satisfied(expression, allowed) {
  return expression
    .replace(/[()]/g, "")
    .split(/\s+OR\s+/)
    .some((choice) => choice.split(/\s+AND\s+/).every((term) => allowed.has(term.trim())));
}

const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
const refused = [];
let checked = 0;
for (const [path, entry] of Object.entries(lock.packages)) {
  if (path === "" || entry.dev) continue;
  const name = path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
  const excepted = EXCEPTIONS.get(name);
  const allowed = new Set([...ALLOWED, ...(FONTS.test(name) ? ["OFL-1.1"] : [])]);
  if (excepted) allowed.add(excepted);
  const license = entry.license ?? excepted;
  checked += 1;
  if (!license || !satisfied(license, allowed)) {
    refused.push(`${name}@${entry.version}: ${license ?? "no licence given"}`);
  }
}

if (refused.length > 0) {
  console.error(`Not on the list in docs/hld.md §10:\n  ${refused.join("\n  ")}`);
  process.exit(1);
}
console.log(`${checked} run-time packages, all on the list.`);
