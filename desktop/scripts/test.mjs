/**
 * The page's unit tests, and those of the scripts CI runs. Fails when a glob names no file, which
 * node --test passes as a run of no tests. The globs reach node as arguments, not through a shell,
 * so cmd.exe's quoting on Windows cannot change them.
 *
 *   node scripts/test.mjs
 */
import { spawnSync } from "node:child_process";
import { globSync } from "node:fs";
import { fileURLToPath } from "node:url";

const tests = ["src/**/*.test.ts", "scripts/**/*.test.mjs"];
const root = fileURLToPath(new URL("..", import.meta.url));

const empty = tests.filter((glob) => globSync(glob, { cwd: root }).length === 0);
if (empty.length > 0) {
  console.error(`No file matches ${empty.join(" or ")}, so its tests did not run.`);
  process.exit(1);
}
const run = spawnSync(process.execPath, ["--test", ...tests], { cwd: root, stdio: "inherit" });
if (run.error) console.error(run.error.message);
process.exitCode = run.status ?? 1;
