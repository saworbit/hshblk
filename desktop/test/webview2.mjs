/**
 * What only WebView2 can show, run on Windows: F5 and Ctrl+R (#161), the right-click menu (#244),
 * print's header and footer (#245), and a contrast theme (#233). The Linux suite can only fire
 * synthetic events at these and read the page's rules. Here each is the engine's own behaviour,
 * and each test fails with its fix taken out (#270). A link to a heading in another file is
 * here too, since the Linux suite drives one window a launch and it takes two (#301).
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
import { attach, launch, poll, START } from "./devtools.mjs";

const app = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("usage: webview2.mjs <app binary>");
if (process.platform !== "win32") throw new Error("WebView2 runs on Windows only.");

const keys = fileURLToPath(new URL("keys.ps1", import.meta.url));

/** The app on `file`, its page's DevTools session, and the keys and the clicks Windows gives. */
async function open(file, profile) {
  const page = await launch(app, file, profile);
  return {
    ...page,
    /**
     * Presses a key as Windows delivers one, `F5` or, with Ctrl, `R`, and says where it went.
     * WebView2 drops a key posted while its page has no focus, as when the reader at this PC is
     * in another app (#329). DevTools gives the page focus first, and leaves the window behind.
     */
    async press(key, control = false) {
      await page.send("Page.bringToFront");
      return execFileSync(
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
        { encoding: "utf8", timeout: 60_000 },
      ).trim();
    },
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
  let folder;
  let page;

  before(async () => {
    // Made here, not as the suite is read, so a run that leaves the suite out leaves no folder.
    folder = mkdtempSync(join(tmpdir(), "hshblk-webview2-"));
    const file = join(folder, "webview2.md");
    writeFileSync(
      file,
      "# WebView2\n\nA paragraph.\n\n---\n\n> outer\n>\n> > inner\n\n```\ncode\n```\n",
    );
    page = await open(file, join(folder, "profile"));
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
      const went = await page.press(key, control);
      const focused = await page.run(() => document.hasFocus()).catch(() => "unknown");
      await sleep(1500);
      const kept = await page.run(() => window.kept ?? "reloaded");
      assert.deepEqual(kept, [key], `${key}: the page had focus ${focused}; ${went}`);
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

describe("A link to a heading in another file", { timeout: 300_000 }, () => {
  // #301: #285 sends a link's fragment to the window of the file it names, through
  // `watch_fragments`. Its parts had tests of their own, but nothing drove the two windows.
  let folder;
  let a;
  let b;

  before(async () => {
    // As above: a run that leaves the suite out leaves no folder.
    folder = mkdtempSync(join(tmpdir(), "hshblk-fragment-"));
    const first = join(folder, "a.md");
    writeFileSync(first, "[Install](b.md#install)\n\n[Nowhere](b.md#nothing-here)\n");
    const filler = Array.from({ length: 300 }, (_, n) => `Line ${n + 1}.`).join("\n\n");
    writeFileSync(join(folder, "b.md"), `# B\n\n${filler}\n\n## Install\n\nSteps.\n\n${filler}\n`);
    a = await open(first, join(folder, "profile"));
    await a.until(() => document.querySelectorAll(".pg-link").length === 2, START);
  });
  after(async () => {
    if (!a) return;
    b?.close();
    await a.close();
    rmSync(folder, { recursive: true, force: true, maxRetries: 10 });
  });

  /**
   * Ctrl and a click on a.md's link with these words. Over DevTools, a window that is not in
   * front can drop the first events it gets, so the pointer moves until the page sees it, and
   * then presses.
   */
  async function follow(words) {
    await a.send("Page.bringToFront");
    const at = await a.run(`() => {
      const links = [...document.querySelectorAll(".pg-link")];
      const box = links.find((link) => link.textContent === ${JSON.stringify(words)})
        .getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    }`);
    await a.run(() => {
      window.pointed = false;
      addEventListener("mousemove", () => (window.pointed = true), { once: true, capture: true });
    });
    let nudge = 0;
    await poll(
      async () => {
        nudge = 1 - nudge;
        await a.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...at, x: at.x + nudge });
        return a.run(() => window.pointed);
      },
      "the pointer to reach a.md's page",
    );
    for (const type of ["mousePressed", "mouseReleased"]) {
      const click = { type, ...at, button: "left", clickCount: 1, modifiers: 2 };
      await a.send("Input.dispatchMouseEvent", click);
    }
  }

  /** b.md's window: the page other than a.md's whose status line names it. */
  const windowOfB = () =>
    poll(
      async () => {
        for (const target of await a.pages()) {
          if (target.id === a.id) continue;
          const page = await attach(target);
          const name = await page
            .run(() => document.querySelector(".status-name")?.textContent)
            .catch(() => null);
          if (name === "b.md") return page;
          page.close();
        }
        return null;
      },
      "b.md's window",
      START,
    );

  /** Whether the caret is on Install's line, and that line is in the window's top third. */
  const atInstall = () => {
    const view = document.querySelector(".cm-content").cmTile.root.view;
    const line = view.state.doc.lineAt(view.state.selection.main.head);
    const box = view.scrollDOM.getBoundingClientRect();
    const top = view.coordsAtPos(line.from)?.top;
    return line.text === "## Install" && top !== undefined && top - box.top < box.height / 3;
  };

  test("opens the file at the heading, in a window of its own", async () => {
    await follow("Install");
    b = await windowOfB();
    await b.until(atInstall);
  });

  test("brings the file's window forward and goes to the heading again", async () => {
    await b.run(() => {
      const view = document.querySelector(".cm-content").cmTile.root.view;
      view.dispatch({ selection: { anchor: 0 }, scrollIntoView: true });
      view.scrollDOM.scrollTop = 0;
    });
    assert.equal(await b.run(atInstall), false, "b.md went back to its top");
    await follow("Install");
    await b.until(atInstall);
    assert.equal((await a.pages()).length, 2, "no second window on b.md");
  });

  test("says in the file's status line that it has no such place", async () => {
    await follow("Nowhere");
    const said = () => document.querySelector(".status-said")?.textContent;
    assert.equal(await b.until(said), "Nothing in this file is named #nothing-here.");
  });
});
