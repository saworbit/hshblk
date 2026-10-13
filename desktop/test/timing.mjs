/**
 * docs/hld.md §8, item 3: how long each file takes from the app's launch to first paint, and
 * to a whole parse, which CodeMirror does lazily. Linux and Windows.
 *
 *   node test/timing.mjs <app binary> <file>...
 *
 * Prints a markdown report. Three runs a file, so a slow start shows as one.
 */
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { launch, startDriver } from "./webdriver.mjs";

const RUNS = 3;

/** The DevTools port WebView2 opens for the app on Windows. */
const PORT = 9333;

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

/** Tries `fn` every 100 ms until it gives something, for 10 seconds. */
async function poll(fn) {
  for (let tries = 0; tries < 100; tries += 1) {
    const value = await fn().catch(() => null);
    if (value) return value;
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${fn}`);
}

/**
 * Windows: msedgedriver passes a WebView2 app's arguments as switches, `--c:\...`, so the app
 * would never see its file. So the app starts as a double-click starts it, with the file on its
 * command line, and the page is read over the DevTools protocol. WebView2 opens its port when
 * the environment asks, beside the flags wry gives it.
 */
async function launchOnWindows(file) {
  const flags = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection";
  const browser = `${flags} --remote-debugging-port=${PORT}`;
  const child = spawn(app, [file], {
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: browser },
    stdio: "ignore",
  });
  const exited = once(child, "exit");
  const started = startedAt(child.pid);
  const list = () =>
    fetch(`http://127.0.0.1:${PORT}/json/list`).then((response) => response.json());
  const target = await poll(async () => (await list()).find((page) => page.type === "page"));
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await once(socket, "open");
  const answers = new Map();
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    answers.get(message.id)?.(message.result?.result?.value);
    answers.delete(message.id);
  });
  let id = 0;
  const evaluate = (fn) =>
    new Promise((answer) => {
      id += 1;
      answers.set(id, answer);
      const params = { expression: `(${fn})()`, returnByValue: true };
      socket.send(JSON.stringify({ id, method: "Runtime.evaluate", params }));
    });
  return {
    started,
    until: (fn) => poll(() => evaluate(fn)),
    async close() {
      socket.close();
      child.kill();
      await exited;
      // A second launch while the first is still going hands its file over, and its port.
      await poll(() => list().then(() => null, () => true));
    },
  };
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
}

console.log("Milliseconds after the process started.\n");
console.log("| File | Bytes | Run | Page loads | Document arrives | First paint | Whole parse |");
console.log("|---|---|---|---|---|---|---|");
for (const row of rows) console.log(`| ${row.join(" | ")} |`);
