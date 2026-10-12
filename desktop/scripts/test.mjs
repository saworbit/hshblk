/**
 * The page's unit tests. Fails when the glob names no file, which node --test passes as a run of
 * no tests. The glob reaches node as an argument, not through a shell, so cmd.exe's quoting on
 * Windows cannot change it.
 *
 *   node scripts/test.mjs
 */
import { spawnSync } from "node:child_process";
import { globSync } from "node:fs";
import { fileURLToPath } from "node:url";

const tests = "src/**/*.test.ts";
const root = fileURLToPath(new URL("..", import.meta.url));

if (globSync(tests, { cwd: root }).length === 0) {
  console.error(`No file matches ${tests}, so no test ran.`);
  process.exit(1);
}
const run = spawnSync(process.execPath, ["--test", tests], { cwd: root, stdio: "inherit" });
if (run.error) console.error(run.error.message);
process.exitCode = run.status ?? 1;
