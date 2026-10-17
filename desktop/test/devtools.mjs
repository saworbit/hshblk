/**
 * The app on Windows, driven over WebView2's DevTools port, for test/webview2.mjs and
 * test/timing.mjs, which launch, connect, and close it the same way (#305).
 *
 * WebDriver cannot open a file on Windows: msedgedriver passes the app's arguments as switches
 * (#27). So the app starts with its file on the command line, as a double-click starts it, and
 * each window's page is a DevTools page target.
 */
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const state = fileURLToPath(new URL("webview2-state.ps1", import.meta.url));

/** Tries `fn` every 100 ms until it gives something, for `seconds`, and says what it last met. */
export async function poll(fn, what, seconds = 15) {
  const end = Date.now() + seconds * 1000;
  let met = "nothing";
  while (Date.now() < end) {
    try {
      const value = await fn();
      if (value) return value;
      met = JSON.stringify(value);
    } catch (error) {
      met = error.message;
    }
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${what}, after ${met}`);
}

/** What WebView2 lists on its DevTools port. */
const list = (port) => fetch(`http://127.0.0.1:${port}/json/list`).then((answer) => answer.json());

/** How long WebView2 may take to start: its first start on a fresh runner makes its profile. */
export const START = 90;

/**
 * Whether this runs elevated, as CI's runners run it. Git's own whoami is another program. Asked
 * at launch, so a script that only imports this on Linux runs no Windows program.
 */
function isElevated() {
  const whoami = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "whoami.exe");
  return /S-1-16-(12288|16384)\b/.test(execFileSync(whoami, ["/groups"], { encoding: "utf8" }));
}

/** Where WebView2 takes its arguments from, elevated, in place of the environment. */
const POLICY = String.raw`HKLM\SOFTWARE\Policies\Microsoft\Edge\WebView2\AdditionalBrowserArguments`;

/** What the app and WebView2 were doing, for a launch that failed. On CI, with the screen. */
function report(pid, profile) {
  const args = ["-ProcessId", String(pid), "-WebViewProfile", profile];
  const screen = join(process.env.RUNNER_TEMP ?? tmpdir(), "webview2.png");
  if (process.env.CI) args.push("-Screen", screen);
  try {
    return execFileSync(
      "powershell",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", state, ...args],
      { encoding: "utf8", timeout: 60_000 },
    ).trim();
  } catch (error) {
    return `No report: ${error.message}`;
  }
}

/** A page target's DevTools session: a method sent, and a function run in the page. */
export async function attach(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await once(socket, "open");
  const answers = new Map();
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    answers.get(message.id)?.(message);
    answers.delete(message.id);
  });
  let id = 0;
  const send = (method, params = {}) =>
    new Promise((answer, fail) => {
      id += 1;
      answers.set(id, (message) =>
        message.error ? fail(new Error(JSON.stringify(message.error))) : answer(message.result),
      );
      socket.send(JSON.stringify({ id, method, params }));
    });
  /** Runs a function in the page. It is sent as source, so it may not close over anything. */
  const run = async (fn) => {
    const params = { expression: `(${fn})()`, returnByValue: true, awaitPromise: true };
    const { result, exceptionDetails } = await send("Runtime.evaluate", params);
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? "it threw");
    return result.value;
  };
  return {
    id: target.id,
    send,
    run,
    until: (fn, seconds) => poll(() => run(fn), String(fn), seconds),
    close: () => socket.close(),
  };
}

/**
 * The app `app` on `file`, with its first window's page attached. WebView2 keeps its profile in
 * `profile`, takes a free port, and writes there the port it took.
 *
 * Since Runtime 150, WebView2 in an elevated app drops the browser arguments the environment
 * gives it, and takes them from machine policy alone: the workflow sets `--remote-debugging-port=0`
 * for hshblk.exe there. Elevated, this sets no such variable, in case one would keep WebView2
 * from reading the policy.
 */
export async function launch(app, file, profile) {
  mkdirSync(profile, { recursive: true });
  // A profile used before keeps the port its last launch took, which would be read as this one's.
  const active = join(profile, "EBWebView", "DevToolsActivePort");
  rmSync(active, { force: true });
  const elevated = isElevated();
  const flags = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection";
  const browser = { WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `${flags} --remote-debugging-port=0` };
  const child = spawn(app, [file], {
    env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: profile, ...(elevated ? {} : browser) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  // What the app says, for a launch that fails.
  let said = "";
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", (chunk) => (said = `${said}${chunk}`.slice(-4000)));
  }
  const exited = once(child, "exit");
  // The app goes when this script does, however it ends: a child left running holds node open.
  const stop = () => child.kill();
  process.once("exit", stop);
  // A copy of the same build already running takes the file, as a second launch hands it over,
  // and this process ends with no port to read. A debug build runs apart from Hash Block (#287).
  const gone = exited.then(([code]) => {
    throw new Error(`The app ended at once, with ${code}. Is another copy of it running?`);
  });
  let port;
  let target;
  try {
    target = await Promise.race([
      (async () => {
        port = await poll(() => readFileSync(active, "utf8").split("\n")[0], "the port", START);
        return poll(
          async () => (await list(port)).find((page) => page.type === "page"),
          "the page",
        );
      })(),
      gone,
    ]);
  } catch (error) {
    const why = [error.message, report(child.pid, profile), "The app said:", said];
    if (elevated) why.push(`Elevated, WebView2 takes --remote-debugging-port=0 from ${POLICY}.`);
    child.kill();
    throw new Error(why.join("\n"), { cause: error });
  }
  gone.catch(() => {});
  const page = await attach(target);
  return {
    ...page,
    pid: child.pid,
    /** Each window's page target, this one's among them. */
    pages: async () => (await list(port)).filter((each) => each.type === "page"),
    /** Each frame in a process of its own, such as the one mermaid draws in. */
    frames: async () => (await list(port)).filter((each) => each.type === "iframe"),
    async close() {
      page.close();
      child.kill();
      await exited;
      process.off("exit", stop);
      // A second launch while the first is still going hands its file over, and its port.
      await poll(async () => !(await list(port).catch(() => null)), "the port to close");
    },
  };
}
