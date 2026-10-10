/**
 * docs/hld.md §8, item 3: how long each file takes from the app's launch to first paint, and
 * to a whole parse, which CodeMirror does lazily. Linux only: the launch time comes from /proc.
 *
 *   node test/timing.mjs <app binary> <file>...
 *
 * Prints a markdown report. Three runs a file, so a slow start shows as one.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import { launch, startDriver } from "./webdriver.mjs";

const RUNS = 3;

const [app, ...files] = process.argv.slice(2);
if (!app || files.length === 0) throw new Error("usage: timing.mjs <app binary> <file>...");

/** When the newest process running the app started, on the epoch clock, to 10 ms. */
function launchedAt() {
  const pid = execFileSync("pgrep", ["-n", "-x", basename(app).slice(0, 15)], {
    encoding: "utf8",
  }).trim();
  const now = Date.now();
  const uptime = Number(readFileSync("/proc/uptime", "utf8").split(" ")[0]);
  // The 22nd field of stat is the start time in clock ticks since boot, 100 a second.
  const ticks = Number(readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1].split(" ")[19]);
  return now - (uptime - ticks / 100) * 1000;
}

function marks() {
  const at = (name) => performance.getEntriesByName(name)[0]?.startTime;
  const painted = at("first-contentful-paint");
  const parsed = at("page-parsed");
  return (
    painted !== undefined &&
    parsed !== undefined && {
      origin: performance.timeOrigin,
      opened: at("document-opened"),
      painted,
      parsed,
    }
  );
}

const stop = await startDriver();
const rows = [];
try {
  for (const file of files) {
    for (let run = 1; run <= RUNS; run += 1) {
      const page = await launch(app, [file]);
      try {
        const start = launchedAt();
        const seen = await page.until(marks);
        const since = (time) => Math.round(seen.origin + time - start);
        rows.push([
          basename(file),
          statSync(file).size,
          run,
          since(0),
          since(seen.opened),
          since(seen.painted),
          since(seen.parsed),
        ]);
      } finally {
        await page.close();
      }
    }
  }
} finally {
  stop();
}

console.log("Milliseconds after the process started.\n");
console.log("| File | Bytes | Run | Page loads | Document arrives | First paint | Whole parse |");
console.log("|---|---|---|---|---|---|---|");
for (const row of rows) console.log(`| ${row.join(" | ")} |`);
