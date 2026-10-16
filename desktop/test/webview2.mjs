/**
 * What only WebView2 can show, run on Windows: F5 and Ctrl+R (#161), the right-click menu (#244),
 * print's header and footer (#245), and a contrast theme (#233). The Linux suite can only fire
 * synthetic events at these and read the page's rules. Here each is the engine's own behaviour,
 * and each test fails with its fix taken out (#270).
 *
 *   node test/webview2.mjs <app>
 *
 * WebDriver cannot open a file on Windows: msedgedriver passes the app's arguments as switches
 * (#27). So the app starts with its file on the command line, as a double-click starts it, and
 * the page is driven over WebView2's DevTools port, as test/timing.mjs reads it. Keys go as
 * Windows delivers them, posted to the page's window by test/keys.ps1, since the protocol's keys
 * never reach WebView2's own shortcuts.
 */
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

const app = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("usage: webview2.mjs <app binary>");
if (process.platform !== "win32") throw new Error("WebView2 runs on Windows only.");

/** The DevTools port WebView2 opens for the app. */
const PORT = 9333;

const keys = fileURLToPath(new URL("keys.ps1", import.meta.url));

/** Tries `fn` every 100 ms until it gives something, for 15 seconds. */
async function poll(fn, what) {
  for (let tries = 0; tries < 150; tries += 1) {
    const value = await fn().catch(() => null);
    if (value) return value;
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${what}`);
}

const list = () => fetch(`http://127.0.0.1:${PORT}/json/list`).then((answer) => answer.json());

/** The app on `file`, with its page's DevTools session. */
async function launch(file) {
  const flags = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection";
  const browser = `${flags} --remote-debugging-port=${PORT}`;
  const child = spawn(app, [file], {
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: browser },
    stdio: "ignore",
  });
  const exited = once(child, "exit");
  // A Hash Block already running takes the file, as a second launch hands it over, and this
  // process ends with no port to read.
  const gone = exited.then(() => {
    throw new Error("The app ended at once. Is another Hash Block running?");
  });
  const target = await Promise.race([
    poll(async () => (await list()).find((page) => page.type === "page"), "the page"),
    gone,
  ]);
  gone.catch(() => {});
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
    send,
    run,
    until: (fn) => poll(() => run(fn), String(fn)),
    /** Presses a key as Windows delivers one, `F5` or, with Ctrl, `R`. */
    press: (key, control = false) =>
      execFileSync("powershell", [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        keys,
        "-ProcessId",
        String(child.pid),
        "-Key",
        key,
        ...(control ? ["-Control"] : []),
      ]),
    /** A right-click in the middle of what a selector names. */
    async rightClick(selector) {
      const at = await run(`() => {
        const box = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
        return { x: box.left + Math.min(box.width / 2, 40), y: box.top + box.height / 2 };
      }`);
      for (const type of ["mousePressed", "mouseReleased"]) {
        await send("Input.dispatchMouseEvent", { type, ...at, button: "right", clickCount: 1 });
      }
    },
    async close() {
      socket.close();
      child.kill();
      await exited;
      await poll(() => list().then(() => null, () => true), "the port to close");
    },
  };
}

/** How many runs of text a PDF draws: its streams' Tj and TJ operators. */
function textRuns(pdf) {
  const bytes = Buffer.from(pdf, "base64");
  let runs = 0;
  for (let at = bytes.indexOf("stream"); at >= 0; at = bytes.indexOf("stream", at)) {
    const body = at + (bytes[at + 6] === 0x0d ? 8 : 7);
    const end = bytes.indexOf("endstream", body);
    at = end + "endstream".length;
    try {
      const text = inflateSync(bytes.subarray(body, end)).toString("latin1");
      runs += text.match(/\bT[jJ]\b/g)?.length ?? 0;
    } catch {
      // A stream that is not deflated, such as a font's, draws no text.
    }
  }
  return runs;
}

describe("WebView2", () => {
  const folder = mkdtempSync(join(tmpdir(), "hshblk-webview2-"));
  const file = join(folder, "webview2.md");
  writeFileSync(
    file,
    "# WebView2\n\nA paragraph.\n\n---\n\n> outer\n>\n> > inner\n\n```\ncode\n```\n",
  );
  let page;

  before(async () => {
    page = await launch(file);
    await page.until(() => document.querySelector(".pg-h1") && document.querySelector(".status"));
  });
  after(async () => {
    await page?.close();
  });

  test("F5 and Ctrl+R leave the page as the reader left it", async () => {
    // #161: each reloaded the window, which brought back the text as it was read and lost the
    // reader's place. The page sees each key, so a key that went nowhere fails this too.
    for (const [key, control] of [
      ["F5", false],
      ["R", true],
    ]) {
      await page.run(() => {
        window.kept = [];
        if (window.listening) return;
        window.listening = true;
        addEventListener("keydown", (event) => {
          if (!["Control", "Shift", "Alt"].includes(event.key)) {
            window.kept.push(event.key.toUpperCase());
          }
        });
      });
      page.press(key, control);
      await sleep(1500);
      assert.deepEqual(await page.run(() => window.kept ?? "reloaded"), [key], key);
    }
  });

  test("a right-click on the page or the status line opens no menu", async () => {
    // #244: WebView2's menu offered Save as, a Print that skipped the page's preparation, and
    // Refresh. The click is the engine's own, so the event is trusted.
    await page.run(() => {
      window.menus = [];
      addEventListener("contextmenu", (event) => {
        const on = event.target.closest(".status") ? "status" : "page";
        window.menus.push([on, event.defaultPrevented], event.isTrusted);
      });
    });
    await page.rightClick(".cm-line");
    await page.rightClick(".status-name");
    await sleep(300);
    const seen = await page.run(() => window.menus);
    assert.deepEqual(seen, [["page", true], true, ["status", true], true]);
  });

  test("print leaves the engine's header and footer no room", async () => {
    // #245: WebView2 put the date, the file's name, and tauri.localhost on every sheet. With
    // them asked for, the page prints the same text as without them.
    const print = async (displayHeaderFooter) =>
      textRuns((await page.send("Page.printToPDF", { displayHeaderFooter })).data);
    const bare = await print(false);
    assert.ok(bare > 0, "the page printed some text");
    assert.equal(await print(true), bare);
  });

  test("a contrast theme keeps a break's and a quote's rules, and marks a code block", async () => {
    // #233: they were backgrounds and shadows, which a contrast theme drops.
    const features = [{ name: "forced-colors", value: "active" }];
    await page.send("Emulation.setEmulatedMedia", { features });
    try {
      const drawn = await page.until(() => {
        if (!matchMedia("(forced-colors: active)").matches) return null;
        const style = (selector) => getComputedStyle(document.querySelector(selector));
        const ruled = (selector) => style(selector).backgroundImage !== "none";
        return {
          rule: ruled(".pg-rule"),
          quote: ruled(".pg-quote-2"),
          code: style(".pg-code-block").borderLeftWidth,
        };
      });
      assert.deepEqual(drawn, { rule: true, quote: true, code: "3px" });
    } finally {
      await page.send("Emulation.setEmulatedMedia", { features: [] });
    }
  });
});
