/**
 * docs/hld.md §8, item 3: how long each file takes from the app's launch to first paint, and
 * to a whole parse, which CodeMirror does lazily. Linux and Windows.
 *
 *   node test/timing.mjs <app binary> <file>...
 *
 * Prints a markdown report. Three runs a file, so a slow start shows as one. On Windows the runs
 * share one WebView2 profile of their own, which the first run makes.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import * as devtools from "./devtools.mjs";
import { launch, startDriver } from "./webdriver.mjs";

const RUNS = 3;

const [binary, ...files] = process.argv.slice(2);
if (!binary || files.length === 0) throw new Error("usage: timing.mjs <app binary> <file>...");
const app = resolve(binary);
const windows = process.platform === "win32";

/** When the newest process running the app started, on the epoch clock, to 10 ms. Linux. */
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

/** When a process started, on the epoch clock. Windows keeps it to 100 ns. */
function startedAt(pid) {
  const start = `(Get-Process -Id ${pid}).StartTime`;
  const script = `[DateTimeOffset]::new(${start}).ToUnixTimeMilliseconds()`;
  return Number(
    execFileSync("powershell", ["-NoProfile", "-Command", script], { encoding: "utf8" }),
  );
}

/** WebView2's profile for the runs on Windows: one for them all, so only the first makes it. */
const profile = windows ? mkdtempSync(join(tmpdir(), "hshblk-timing-")) : null;

/**
 * Windows: msedgedriver passes a WebView2 app's arguments as switches, so the app would never
 * see its file. So it starts as a double-click starts it, and its page is read over the DevTools
 * protocol, as test/webview2.mjs reads it (#305).
 */
async function launchOnWindows(file) {
  const page = await devtools.launch(app, file, profile);
  return { ...page, started: startedAt(page.pid) };
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

const stop = windows ? () => {} : await startDriver();
const rows = [];
try {
  for (const file of files) {
    for (let run = 1; run <= RUNS; run += 1) {
      const page = windows ? await launchOnWindows(file) : await launch(app, [file]);
      try {
        const start = windows ? page.started : launchedAt();
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
  if (profile) rmSync(profile, { recursive: true, force: true, maxRetries: 10 });
}

console.log("Milliseconds after the process started.\n");
console.log("| File | Bytes | Run | Page loads | Document arrives | First paint | Whole parse |");
console.log("|---|---|---|---|---|---|---|");
for (const row of rows) console.log(`| ${row.join(" | ")} |`);
