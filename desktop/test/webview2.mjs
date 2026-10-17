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
 * the page is driven over WebView2's DevTools port, through test/devtools.mjs. Keys go as
 * Windows delivers them, posted to the page's window by test/keys.ps1, since the protocol's keys
 * never reach WebView2's own shortcuts.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { launch, START } from "./devtools.mjs";

const app = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("usage: webview2.mjs <app binary>");
if (process.platform !== "win32") throw new Error("WebView2 runs on Windows only.");

const keys = fileURLToPath(new URL("keys.ps1", import.meta.url));

/** The app on `file`, its page's DevTools session, and the keys and the clicks Windows gives. */
async function open(file, profile) {
  const page = await launch(app, file, profile);
  return {
    ...page,
    /** Presses a key as Windows delivers one, `F5` or, with Ctrl, `R`. */
    press: (key, control = false) =>
      execFileSync(
        "powershell",
        [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          keys,
          "-ProcessId",
          String(page.pid),
          "-Key",
          key,
          ...(control ? ["-Control"] : []),
        ],
        { timeout: 60_000 },
      ),
    /** A right-click in the middle of what a selector names. */
    async rightClick(selector) {
      const at = await page.run(`() => {
        const box = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
        return { x: box.left + Math.min(box.width / 2, 40), y: box.top + box.height / 2 };
      }`);
      for (const type of ["mousePressed", "mouseReleased"]) {
        await page.send("Input.dispatchMouseEvent", { type, ...at, button: "right", clickCount: 1 });
      }
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

// Each step has a limit, so a page that stops answering fails the run rather than holding it.
describe("WebView2", { timeout: 300_000 }, () => {
  const folder = mkdtempSync(join(tmpdir(), "hshblk-webview2-"));
  const file = join(folder, "webview2.md");
  const profile = join(folder, "profile");
  writeFileSync(
    file,
    "# WebView2\n\nA paragraph.\n\n---\n\n> outer\n>\n> > inner\n\n```\ncode\n```\n",
  );
  let page;

  before(async () => {
    page = await open(file, profile);
    const drawn = () => document.querySelector(".pg-h1") && document.querySelector(".status");
    await page.until(drawn, START);
  });
  after(async () => {
    // A launch that failed leaves its folder, where WebView2 may still be, to be looked at.
    if (!page) return;
    await page.close();
    rmSync(folder, { recursive: true, force: true, maxRetries: 10 });
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
