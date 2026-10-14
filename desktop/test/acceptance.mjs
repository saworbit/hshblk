/**
 * docs/hld.md §8, milestone one's acceptance, through the built app in WebKitGTK. Items 1, 2,
 * 4, 5, and 6. Item 3 is timing, on a named machine: test/timing.mjs. Item 7 is a double-click,
 * by hand: docs/desktop.md.
 *
 *   node test/acceptance.mjs <app binary>
 */
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { Key, launch, startDriver } from "./webdriver.mjs";

if (!process.argv[2]) throw new Error("usage: node test/acceptance.mjs <app binary>");
// Absolute, because the app starts in a folder of its own.
const app = resolve(process.argv[2]);

const run = promisify(execFile);

/** The app's process, by the name pgrep matches: its first 15 characters. */
const processName = basename(app).slice(0, 15);

const running = () =>
  run("pgrep", ["-x", processName]).then(
    () => true,
    () => false,
  );

/**
 * Waits until no copy of the app is running. A launch while one is still closing is handed to
 * it by the single-instance plugin, and opens nothing of its own.
 */
async function gone() {
  for (let tries = 0; tries < 100; tries += 1) {
    if (!(await running())) return;
    await sleep(100);
  }
  throw new Error(`${processName} is still running`);
}

/** Where the app starts, and so where Print to File writes. */
const work = mkdtempSync(join(tmpdir(), "hshblk-work-"));

/**
 * What the app hands the system's opener, one address a line. A stand-in `xdg-open` writes it,
 * so no test opens a browser.
 */
const opened = join(work, "opened.txt");
{
  const bin = join(work, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "xdg-open"), `#!/bin/sh\nprintf '%s\\n' "$1" >> '${opened}'\n`, {
    mode: 0o755,
  });
  process.env.PATH = `${bin}:${process.env.PATH}`;
}

const openedSoFar = () =>
  readFileSync(opened, { encoding: "utf8", flag: "a+" }).split("\n").filter(Boolean);

/**
 * What the resource channel was asked for, one request a line: the window, the status, and the
 * path as asked. A debug build writes it, since resource timing does not see the app's own schemes.
 */
const assetLog = join(work, "assets.log");
process.env.HSHBLK_ASSET_LOG = assetLog;

/** The paths a window asked the channel for. */
const askedBy = (label) =>
  readFileSync(assetLog, { encoding: "utf8", flag: "a+" })
    .split("\n")
    .filter((line) => line.startsWith(`${label} `))
    .map((line) => line.split(" ")[2]);

/** One transparent pixel. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

// The definition at the end sits past what CodeMirror parses ahead of the viewport, so the
// link at the top resolves only once the page has the whole tree.
const FILLER = Array.from({ length: 1500 }, (_, i) => `Filler paragraph ${i}.`).join("\n\n");

const NOTES = `# Notes

A paragraph with **strong**, *emphasis*, \`code\`, ~~struck~~, and a [link](https://example.com/page).

A [reference link][far] defined at the end.

- one
- two
  1. nested

\`\`\`js
const fenced = true;
\`\`\`

---

| Left | Right |
|:-----|------:|
| a    | b     |

![near](near.png) ![spaced](near%20by.png) ![far](../images/far.png) ![root](/images/far.png) ![outside](../../outside.png) ![leaving](leave.png) ![remote](https://example.com/remote.png)

<script>window.ran = "block";</script>

<div onclick="window.ran = 'click'">Raw <b>HTML</b> block</div>

<p style="background: url(near.png)"><img src="near.png" alt="framed"> <img src="doc-asset://localhost/near.png" alt="asset"> <img src="https://example.com/remote.png" alt="remote"> <img src="../../outside.png" alt="outside"> <img srcset="near.png 1x" alt="srcset"> <link rel="stylesheet" href="near.css"> <iframe src="https://example.com/"></iframe> <svg width="8" height="8"><image href="doc-asset://localhost/svg.png"/><image xlink:href="doc-asset://localhost/xlink.png"/></svg> <input type="image" src="doc-asset://localhost/input.png" alt="input"> <video poster="doc-asset://localhost/poster.png"></video></p>
<table background="doc-asset://localhost/table.png"><tr><td>Table</td></tr></table>
<meta http-equiv="refresh" content="0; url=https://example.com/">

Inline <img src="x" onerror="window.ran = 'inline'"> HTML.

${FILLER}

<details>
<summary>More <b>notes</b></summary>

A folded body.

</details>

[far]: https://example.com/far

The **end**.
`;

/** When the fixture's file was last modified. */
const MODIFIED = new Date("2020-01-02T12:00:00Z");

/**
 * root/repo/.git, root/repo/docs/notes.md beside near.png, "near by.png", and a symlink that
 * leaves the repository, root/repo/images/far.png, and root/outside.png. The notes are NOTES
 * unless a test gives its own.
 */
function fixture(notes = NOTES) {
  const root = mkdtempSync(join(tmpdir(), "hshblk-acceptance-"));
  const repo = join(root, "repo");
  for (const dir of [".git", "docs", "images"]) mkdirSync(join(repo, dir), { recursive: true });
  writeFileSync(join(repo, "docs", "near.png"), PNG);
  writeFileSync(join(repo, "docs", "near by.png"), PNG);
  writeFileSync(join(repo, "images", "far.png"), PNG);
  writeFileSync(join(root, "outside.png"), PNG);
  symlinkSync(join(root, "outside.png"), join(repo, "docs", "leave.png"));
  const file = join(repo, "docs", "notes.md");
  writeFileSync(file, notes);
  // A year the status line cannot get from today, to show it reads the file's own time.
  utimesSync(file, MODIFIED, MODIFIED);
  return { root, file };
}

/** Every path under a folder, with its size and modification time. */
function listing(root) {
  return readdirSync(root, { recursive: true })
    .sort()
    .map((path) => {
      const stat = statSync(join(root, path), { throwIfNoEntry: false });
      return `${path} ${stat?.size} ${stat?.mtimeMs}`;
    });
}

/**
 * Prints through the keyboard, as a reader would. WebKit shows no print dialog to a page under
 * automation, so the app runs on its own here, and X input stands in for the reader: a key to
 * place the caret, which opens the title's syntax, then the print keys. GTK's dialog is answered
 * with its first printer, which with no others is Print to File, into the app's folder.
 */
async function printByKeyboard(file, keys = ["Right", "ctrl+p"]) {
  const child = spawn(app, [file], { cwd: work, stdio: ["ignore", "ignore", "pipe"] });
  let said = "";
  child.stderr.on("data", (chunk) => (said = (said + chunk).slice(-4000)));
  try {
    // By its process, so a window still closing from another test is not the one found, and
    // once it shows: GTK names a window before it maps it, and X will not focus it until then.
    const window = await find([
      "--all",
      "--onlyvisible",
      "--pid",
      String(child.pid),
      "--name",
      "^notes\\.md$",
    ]);
    // Outside automation the page cannot say it is ready, so the keys go again until the
    // dialog they open is there.
    let dialog = null;
    for (const until = Date.now() + 60_000; !dialog && Date.now() < until;) {
      await run("xdotool", ["windowfocus", "--sync", window]);
      await run("xdotool", ["key", ...keys]);
      dialog = await find(["--onlyvisible", "--name", "^Print$"], 3000).catch(() => null);
    }
    if (!dialog) throw new Error("the print keys opened no dialog");
    await run("xdotool", ["windowfocus", "--sync", dialog]);
    await run("xdotool", ["key", "Down", "Return"]);
    return await pdfText(join(work, "output.pdf"));
  } catch (error) {
    throw new Error(`${error.message}. The app said:\n${said}`, { cause: error });
  } finally {
    child.kill();
    await gone();
  }
}

/**
 * The first window a search finds, once there is one. A search fails outright if a window
 * closes while it reads it, as another test's may, so it is tried again.
 */
async function find(search, wait = 60_000) {
  const until = Date.now() + wait;
  while (Date.now() < until) {
    const found = await run("xdotool", ["search", ...search]).catch(() => ({ stdout: "" }));
    const window = found.stdout.trim().split("\n")[0];
    if (window) return window;
    await sleep(250);
  }
  throw new Error(`no window for xdotool search ${search.join(" ")}`);
}

/** The text of a PDF, without its page breaks, once GTK has stopped writing it for a second. */
async function pdfText(file) {
  let size = -1;
  for (let still = 0, tries = 0; still < 4 && tries < 240; tries += 1) {
    await sleep(250);
    const now = statSync(file, { throwIfNoEntry: false })?.size ?? -1;
    still = now > 0 && now === size ? still + 1 : 0;
    size = now;
  }
  return (await run("pdftotext", [file, "-"])).stdout.replaceAll("\f", "");
}

function fingerprint(file) {
  const bytes = readFileSync(file);
  return {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    mtime: statSync(file).mtimeMs,
  };
}

// --- in the page ---------------------------------------------------------------------------

/** The images once each has loaded or given way to its placeholder, and the tree is whole. */
function settled(total) {
  const images = [...document.querySelectorAll("img.pg-image")];
  const missing = [...document.querySelectorAll(".pg-image-missing")];
  return (
    performance.getEntriesByName("page-parsed").length > 0 &&
    images.length + missing.length === total &&
    images.every((image) => image.complete && image.naturalWidth > 0) && {
      images: images.map((image) => ({ alt: image.alt, width: image.naturalWidth })),
      // A chip in a line says why on hover. A block says it in its words.
      missing: missing.map((el) => el.title || el.textContent),
    }
  );
}

function texts(selector) {
  return [...document.querySelectorAll(selector)].map((el) => el.textContent);
}

/** Whether the engine shows each reference, as an image the page itself might ask for. */
async function forged(references) {
  const label = window.__TAURI_INTERNALS__.metadata.currentWindow.label;
  const handle = label.replace(/^doc-/, "");
  const load = (reference) =>
    new Promise((resolve) => {
      const image = new Image();
      image.onload = () => resolve(true);
      image.onerror = () => resolve(false);
      image.src = window.__TAURI_INTERNALS__.convertFileSrc(`${handle}/${reference}`, "doc-asset");
    });
  return Promise.all(references.map(load));
}

// --- the cases ------------------------------------------------------------------------------

let stopDriver;
before(async () => {
  if (await running())
    throw new Error("Hash Block is running. Close it, so no test hands it a file.");
  stopDriver = await startDriver({ cwd: work });
});
after(() => stopDriver());

describe("the window's keys, wherever focus is", () => {
  const folder = mkdtempSync(join(tmpdir(), "hshblk-keys-"));
  const file = join(folder, "keys.md");
  writeFileSync(file, "# Keys\n\nSome **bold** words.\n");
  let page;

  before(async () => {
    page = await launch(app, [file]);
    await page.until(() => document.querySelector(".pg-strong"));
  });
  after(async () => {
    await page?.close();
    await gone();
  });

  /** In the page: the name of what has focus, or its tag. */
  const focused = () => document.activeElement?.name || document.activeElement?.tagName;

  /** Ctrl+O, the Open dialog it shows, and Escape to close it again. */
  async function openDialog() {
    await page.press(Key.Control, "o");
    const dialog = await find(["--onlyvisible", "--name", "^Open File$"], 10_000);
    await run("xdotool", ["windowfocus", "--sync", dialog]);
    await run("xdotool", ["key", "Escape"]);
    // Until it has gone, so the next search cannot find this one.
    for (let tries = 0; tries < 40; tries += 1) {
      const open = await run("xdotool", ["search", "--onlyvisible", "--name", "^Open File$"]).then(
        () => true,
        () => false,
      );
      if (!open) return;
      await sleep(250);
    }
    throw new Error("the Open dialog did not close");
  }

  test("Ctrl+O opens a file from the find box, and with nothing focused", async () => {
    await page.press(Key.Control, "f");
    assert.equal(await page.until(focused), "search");
    await openDialog();
    await page.run(() => document.activeElement.blur());
    assert.equal(await page.run(focused), "BODY");
    await openDialog();
  });

  test("Ctrl+F finds with nothing focused", async () => {
    await page.run(() => document.activeElement.blur());
    await page.press(Key.Control, "f");
    assert.equal(await page.until(() => document.activeElement?.name), "search");
    // #188: a search term is not prose, so nothing corrects it.
    const field = await page.run(() => {
      const input = document.activeElement;
      const attribute = (name) => input.getAttribute(name);
      return [input.spellcheck, attribute("autocorrect"), attribute("autocapitalize")];
    });
    assert.deepEqual(field, [false, "off", "off"]);
  });

  test("Ctrl+/ shows all the syntax from the find box, and says so, until it goes again", async () => {
    await page.press(Key.Control, "f");
    assert.equal(await page.until(focused), "search");
    await page.press(Key.Control, "/");
    const shown = await page.until(() => {
      const text = document.querySelector(".cm-content").textContent;
      const said = document.querySelector(".status-source");
      return (
        text.includes("# Keys") && text.includes("**bold**") && !said.hidden && said.textContent
      );
    });
    assert.match(shown, /^Showing the source\./);
    await page.press(Key.Control, "/");
    assert.ok(
      await page.until(() => {
        const text = document.querySelector(".cm-content").textContent;
        const hidden = document.querySelector(".status-source").hidden;
        return !text.includes("#") && !text.includes("**") && hidden;
      }),
    );
  });

  test("Ctrl+P prints from the find box: the syntax open for the screen folds", async () => {
    const at = await page.run(() => {
      const box = document.querySelector(".pg-strong").getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    });
    // A click opens no syntax. A key that moves the caret does.
    await page.click(at.x, at.y);
    await page.press(Key.ArrowRight);
    await page.until(() => document.querySelector(".cm-content").textContent.includes("**bold**"));
    await page.press(Key.Control, "f");
    assert.equal(await page.until(focused), "search");
    await page.press(Key.Control, "p");
    // WebKit shows no print dialog under automation. What printing does first still shows.
    const text = await page.until(() => {
      const text = document.querySelector(".cm-content").textContent;
      return !text.includes("**") && text;
    });
    assert.match(text, /Some bold words\./);
  });

  test("Ctrl+= and Ctrl+- change the text size, and Ctrl+0 puts it back", async () => {
    // #164: there was no way to change it.
    const size = () =>
      parseFloat(getComputedStyle(document.querySelector(".cm-scroller")).fontSize);
    const own = await page.run(size);
    await page.press(Key.Control, "=");
    const bigger = await page.until((own) => {
      const now = parseFloat(getComputedStyle(document.querySelector(".cm-scroller")).fontSize);
      return now > own && now;
    }, own);
    await page.press(Key.Control, "-");
    await page.press(Key.Control, "-");
    const smaller = await page.until((own) => {
      const now = parseFloat(getComputedStyle(document.querySelector(".cm-scroller")).fontSize);
      return now < own && now;
    }, own);
    await page.press(Key.Control, "0");
    await page.until(
      (own) =>
        parseFloat(getComputedStyle(document.querySelector(".cm-scroller")).fontSize) === own,
      own,
    );
    assert.ok(bigger > own && smaller < own, `${smaller} < ${own} < ${bigger}`);
  });

  test("F5, Ctrl+R, and a right-click do nothing, but the find box's fields keep their menu", async () => {
    // #161: reload brought back the text as it was read. #244: the menu was the browser's.
    await page.press(Key.Control, "f");
    await page.until(() => document.querySelector(".cm-search input"));
    const prevented = await page.run(() => {
      const fire = (target, event) => {
        target.dispatchEvent(event);
        return event.defaultPrevented;
      };
      const key = (init) =>
        fire(
          document.body,
          new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }),
        );
      const menu = (target) =>
        fire(target, new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      return [
        key({ key: "F5" }),
        key({ key: "r", ctrlKey: true }),
        menu(document.querySelector(".cm-content")),
        menu(document.querySelector(".status")),
        menu(document.querySelector(".cm-search input")),
      ];
    });
    assert.deepEqual(prevented, [true, true, true, true, false]);
  });
});

describe("closing a window", () => {
  const folder = mkdtempSync(join(tmpdir(), "hshblk-close-"));
  const file = join(folder, "close.md");
  writeFileSync(file, "# Close\n");

  test(
    "Ctrl+W closes it, and the app quits with its last window",
    { timeout: 30_000 },
    async () => {
      // #166: only the title bar's button or Alt+F4 closed one.
      const page = await launch(app, [file]);
      try {
        await page.until(() => document.querySelector(".pg-h1"));
        // The window goes while the driver is still pressing, so the session ends without a
        // reply. That the app has gone is the test.
        await page.press(Key.Control, "w").catch(() => {});
        await gone();
      } finally {
        await page.close().catch(() => {});
        await gone();
      }
    },
  );
});

describe("one open document", () => {
  const { root, file } = fixture();
  const original = fingerprint(file);
  let page;
  let shown;

  before(async () => {
    page = await launch(app, [file]);
    shown = await page.until(settled, 7);
  });
  after(async () => {
    await page?.close();
    await gone();
  });

  test("1. paints a page, not a code buffer", async () => {
    assert.deepEqual(await page.run(texts, ".pg-h1"), ["Notes"]);
    assert.deepEqual(await page.run(texts, ".pg-strong"), ["strong"]);
    assert.deepEqual(await page.run(texts, ".pg-em"), ["emphasis"]);
    assert.deepEqual(await page.run(texts, ".pg-strike"), ["struck"]);
    assert.ok((await page.run(texts, ".pg-code")).includes("code"));
    assert.equal((await page.run(texts, ".pg-list-mark")).length, 3);
    assert.ok((await page.run(texts, ".pg-code-block")).includes("const fenced = true;"));
    assert.deepEqual(await page.run(texts, ".pg-table th"), ["Left", "Right"]);
    // #187: the rule's line holds only its hidden marks, and still has a height to draw in.
    const rule = await page.run(
      () => document.querySelector(".pg-rule")?.getBoundingClientRect().height,
    );
    assert.ok(rule > 0, `the rule's line is ${rule} px tall`);
    const align = await page.run(
      () => document.querySelectorAll(".pg-table td")[1].style.textAlign,
    );
    assert.equal(align, "right");
  });

  test("1. resolves a link from a definition at the end of a long file", async () => {
    const links = await page.run(() =>
      [...document.querySelectorAll(".pg-link")].map((el) => [el.textContent, el.dataset.href]),
    );
    assert.deepEqual(links, [
      ["link", "https://example.com/page"],
      ["reference link", "https://example.com/far"],
    ]);
  });

  test("1. shows images in the repository, and none outside it or remote", async () => {
    assert.deepEqual(shown.images, [
      { alt: "near", width: 1 },
      { alt: "spaced", width: 1 },
      { alt: "far", width: 1 },
      { alt: "root", width: 1 },
    ]);
    assert.deepEqual(shown.missing, [
      "Image not shown · outside",
      "Image not shown · leaving",
      "Image not loaded · remote",
    ]);
    const requests = await page.run(() =>
      performance.getEntriesByType("resource").map((entry) => entry.name),
    );
    assert.deepEqual(
      requests.filter((name) => /^https?:/.test(name) && !name.includes(".localhost")),
      [],
    );
  });

  test("1. serves nothing the page forges a request for, outside the repository", async () => {
    const loads = await page.run(forged, [
      "near.png",
      "../../outside.png",
      "leave.png",
      "/etc/hostname",
      "%2Fetc%2Fhostname",
      "../../../../../../etc/hostname",
      "/images/far.png",
      "//images/far.png",
    ]);
    // A leading slash is the repository's root, never the filesystem's. Two name a host.
    assert.deepEqual(loads, [true, false, false, false, false, false, true, false]);
  });

  test("2. runs no script, and draws raw HTML blocks in frames that fetch only the repository's images", async () => {
    assert.equal(await page.run(() => window.ran ?? null), null);
    // CodeMirror draws only the lines near the window, and these are just below it.
    const inline = await page.until(() => {
      const line = [...document.querySelectorAll(".cm-line")].find((el) =>
        el.textContent.startsWith("Inline "),
      );
      if (!line) [...document.querySelectorAll(".pg-html")].at(-1)?.scrollIntoView();
      return line?.textContent;
    });
    assert.match(inline, /^Inline <img src="x" onerror=/);
    const frames = () =>
      page.until(() => {
        const frames = [...document.querySelectorAll("iframe.pg-html")];
        // The frame's own HTML, not the blank document it starts on.
        const loaded = (f) =>
          f.contentDocument?.URL === "about:srcdoc" &&
          f.contentDocument.readyState === "complete" &&
          [...f.contentDocument.images].every((image) => image.complete);
        if (frames.length < 3 || !frames.every(loaded)) return null;
        return frames.map((frame) => ({
          sandbox: frame.getAttribute("sandbox"),
          url: frame.contentDocument.URL,
          text: frame.contentDocument.body.textContent.trim(),
          scripts: frame.contentDocument.scripts.length,
          ran: frame.contentWindow.ran ?? null,
          ipc: "__TAURI_INTERNALS__" in frame.contentWindow,
          height: frame.getBoundingClientRect().height,
          policy: frame.contentDocument.querySelector("meta[http-equiv=Content-Security-Policy]")
            ?.content,
          images: [...frame.contentDocument.images].map((image) => [image.alt, image.naturalWidth]),
          chips: [...frame.contentDocument.querySelectorAll(".pg-image-chip")].map(
            (chip) => chip.textContent,
          ),
          backgrounds: [...frame.contentDocument.body.querySelectorAll("*")]
            .map((el) => frame.contentWindow.getComputedStyle(el).backgroundImage)
            .filter((image) => image !== "none"),
          loads: frame.contentWindow.performance.getEntriesByType("resource").length,
        }));
      });
    const [script, block, fetching] = await frames();
    assert.deepEqual([script.scripts, script.ran, script.height], [1, null, 0]);
    assert.equal(block.text, "Raw HTML block");
    assert.ok(block.height > 10, `the frame is ${block.height}px tall`);
    // A click on the block's onclick runs nothing either. The block comes into view first: where
    // the scroll above leaves it depends on the height of every line before it.
    const at = await page.run(() => {
      const frame = document.querySelectorAll("iframe.pg-html")[1];
      frame.scrollIntoView({ block: "center" });
      const box = frame.getBoundingClientRect();
      return { x: box.x + 20, y: box.y + box.height / 2 };
    });
    await page.click(at.x, at.y);
    await sleep(500);
    // The frames asked the channel for nothing, not for an SVG <image>, an image input, a poster,
    // or a table's background either. The page's own requests name its document's handle, which
    // no HTML in the file can know, so any other request came from a frame.
    const label = await page.run(() => window.__TAURI_INTERNALS__.metadata.currentWindow.label);
    const asked = askedBy(label);
    assert.ok(asked.length > 0, "the channel's log holds the page's own images");
    const own = `/${label.replace(/^doc-/, "")}%2F`;
    assert.deepEqual(
      asked.filter((path) => !path.startsWith(own)),
      [],
    );
    for (const frame of await frames()) {
      // Never allow-scripts. The frame's policy refuses inline script too, but not every script.
      assert.equal(frame.sandbox, "allow-same-origin");
      assert.equal(frame.ran, null);
      // It shares the page's origin, but not the app's IPC.
      assert.equal(frame.ipc, false);
      // The refresh and the frame in the HTML went nowhere.
      assert.equal(frame.url, "about:srcdoc");
      // Resource timing misses the app's own schemes, which the channel's log covers. The
      // policy is checked as well: images from the channel, and nothing else.
      assert.match(
        frame.policy,
        /^default-src 'none'; img-src doc-asset: http:\/\/doc-asset\.localhost;/,
      );
      assert.equal(frame.loads, 0);
      assert.deepEqual(frame.backgrounds, []);
    }
    // The image beside the file shows. A remote one, one outside the repository, one named by a
    // doc-asset address, a srcset, and the CSS background do not. Those left with nothing to load
    // are the page's chips of their words, not the engine's broken image (#170).
    assert.deepEqual(fetching.images, [
      ["framed", 1],
      ["outside", 0],
    ]);
    assert.deepEqual(fetching.chips, ["asset", "remote", "srcset"]);
    assert.equal(await page.run(() => window.ran ?? null), null);
    assert.equal(await page.run(() => document.querySelectorAll(".cm-content script").length), 0);
    const images = await page.run(
      () => document.querySelectorAll(".cm-content img:not(.pg-image, .cm-widgetBuffer)").length,
    );
    assert.equal(images, 0);
  });

  test("6. puts no filesystem path in the DOM, a URL, or an IPC reply", async () => {
    const seen = await page.run(async () => ({
      html: document.documentElement.outerHTML,
      url: location.href,
      title: document.title,
      metadata: JSON.stringify(window.__TAURI_INTERNALS__.metadata),
      requests: performance.getEntriesByType("resource").map((entry) => entry.name),
      opened: JSON.stringify(await window.__TAURI_INTERNALS__.invoke("open_document")),
      text: new TextDecoder().decode(await window.__TAURI_INTERNALS__.invoke("document_text")),
    }));
    for (const [where, text] of Object.entries(seen)) {
      const value = Array.isArray(text) ? text.join("\n") : text;
      assert.ok(!value.includes(root), `${where} holds the path`);
      assert.ok(!value.includes(tmpdir()), `${where} holds the temporary folder`);
    }
    assert.equal(seen.title, "notes.md");
    assert.equal(JSON.parse(seen.opened).name, "notes.md");
    assert.ok(seen.text.startsWith("# Notes\n"), "document_text is the text, as bytes");
  });

  test("6. opens only web and mail addresses", async () => {
    const refused = await page.run(async () => {
      try {
        await window.__TAURI_INTERNALS__.invoke("open_url", { url: "file:///etc/hostname" });
        return false;
      } catch {
        return true;
      }
    });
    assert.ok(refused);
  });

  test("5. copies the source, and says so, beside the file's name and when it was modified", async () => {
    await page.run(() => {
      window.copied = null;
      addEventListener(
        "copy",
        (event) => (window.copied = event.clipboardData.getData("text/plain")),
      );
      document.querySelector(".cm-content").focus();
    });
    await page.press(Key.Control, "a");
    await page.press(Key.Control, "c");
    assert.equal(await page.run(() => window.copied), NOTES);
    const status = (await page.run(texts, ".status")).join(" ");
    assert.match(status, /Read only\. Copy and find work on the source\./);
    const [name, modified] = await page.run(texts, ".status > span");
    assert.deepEqual([name, /^Modified .*2020/.test(modified)], ["notes.md", true]);
  });

  test("5. finds the source, hidden syntax included, to the end of the file", async () => {
    await page.press(Key.Control, "f");
    await page.keys("**strong**");
    await page.press(Key.Enter);
    assert.equal(
      await page.until(() => document.querySelector(".cm-searchMatch-selected")?.textContent),
      "**strong**",
    );
    const findAgain = () =>
      page.run(() => document.querySelector(".cm-search input[name=search]").select());
    // A match in a link's address, which never shows on the page, shows in its popover.
    await findAgain();
    await page.keys("com/page");
    await page.press(Key.Enter);
    assert.equal(
      await page.until(() => document.querySelector(".pg-address-url mark")?.textContent),
      "com/page",
    );
    await findAgain();
    await page.keys("[far]:");
    await page.press(Key.Enter);
    assert.equal(
      await page.until(() => document.querySelector(".cm-searchMatch-selected")?.textContent),
      "[far]:",
    );
    await page.press(Key.Escape);
  });

  test("2. leaves the file's bytes and modification time as they were", async () => {
    assert.deepEqual(fingerprint(file), original);
  });

  test("keeps punctuation on the line of the code, emphasis, or link it follows, at any width", async () => {
    // Find has left the page at the end of the file. The paragraph is near its top. CodeMirror
    // may put the page back where it was in the frame after the find box closes, so the scroll
    // goes again until the paragraph shows.
    await page.until(() => {
      const shown = [...document.querySelectorAll(".cm-line")].some((el) =>
        el.textContent.startsWith("A paragraph with"),
      );
      if (!shown) document.querySelector(".cm-scroller").scrollTop = 0;
      return shown;
    });
    // Narrower and narrower, a pixel at a time, so a line ends at every character in turn.
    const stranded = await page.run(() => {
      const content = document.querySelector(".cm-content");
      const line = [...document.querySelectorAll(".cm-line")].find((el) =>
        el.textContent.startsWith("A paragraph with"),
      );
      const chars = [];
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode())
        for (let i = 0; i < node.length; i += 1) if (node.data[i].trim()) chars.push([node, i]);
      const middle = ([node, i]) => {
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const box = range.getBoundingClientRect();
        return (box.top + box.bottom) / 2;
      };
      const found = [];
      for (let width = 160; width <= 720; width += 1) {
        content.style.maxWidth = `${width}px`;
        for (let k = 1; k < chars.length; k += 1) {
          const [node, i] = chars[k];
          if (/[.,]/.test(node.data[i]) && Math.abs(middle(chars[k]) - middle(chars[k - 1])) > 8)
            found.push(
              `${width}px: "${node.data[i]}" after "${chars[k - 1][0].data[chars[k - 1][1]]}"`,
            );
        }
      }
      content.style.maxWidth = "";
      return found;
    });
    assert.deepEqual(stranded, []);
  });
});

describe("links that open", () => {
  const folder = mkdtempSync(join(tmpdir(), "hshblk-links-"));
  const file = join(folder, "links.md");
  writeFileSync(
    file,
    `[web](https://example.com/page), <someone@example.com>, [shouty](HTTPS://EXAMPLE.COM/UP), [script](javascript:alert(1))

[Tables](#tables), [nowhere](#nothing-here), and [the docs](https://example.com/docs "A title here").

| Name | Link |
|------|------|
| row  | [table link](https://table.example.com) |
| mail | <cell@example.com> |

<p align="center"><a href="https://html.example.com/">html link</a> and <a href="#tables">html heading</a></p>

<details><summary>html summary</summary><p>Folded in one block.</p></details>

${FILLER}

## Tables

${FILLER}
`,
  );
  let page;

  before(async () => {
    page = await launch(app, [file]);
    await page.until(() => document.querySelector(".pg-table"));
  });
  after(async () => {
    await page?.close();
    await gone();
  });

  /**
   * The middle of a link's words, once it is in the window and holds still. CodeMirror draws only
   * what is near the window, and measures what a scroll brings in, which may move it.
   */
  function linkAt(words) {
    return page.until((words) => {
      const link = [...document.querySelectorAll(".pg-link")].find(
        (el) => el.textContent === words,
      );
      if (!link) {
        // Every link in this file is near its top.
        document.querySelector(".cm-scroller").scrollTop = 0;
        return null;
      }
      const box = link.getBoundingClientRect();
      if (box.top < 0 || box.bottom > innerHeight) {
        link.scrollIntoView({ block: "center" });
        return null;
      }
      const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      const still = window.lastLinkAt?.x === at.x && window.lastLinkAt?.y === at.y;
      window.lastLinkAt = at;
      return still && at;
    }, words);
  }

  /** Ctrl and a click on the words, as a reader opens a link. */
  async function controlClick(words) {
    const at = await linkAt(words);
    await page.clickWith(Key.Control, at.x, at.y);
  }

  test("6. open from Ctrl and a click, on the page and in a table, in any case", async () => {
    const expected = [
      ["web", "https://example.com/page"],
      ["someone@example.com", "mailto:someone@example.com"],
      ["shouty", "HTTPS://EXAMPLE.COM/UP"],
      ["table link", "https://table.example.com"],
      ["cell@example.com", "mailto:cell@example.com"],
    ];
    const before = openedSoFar().length;
    for (const [i, [words, address]] of expected.entries()) {
      // An address that does not open goes first, so the next line shows it was skipped.
      if (i === 3) await controlClick("script");
      await controlClick(words);
      for (let tries = 0; openedSoFar().length < before + i + 1 && tries < 50; tries += 1)
        await sleep(100);
      assert.equal(openedSoFar()[before + i], address, words);
    }
    assert.equal(openedSoFar().length, before + expected.length);
  });

  /** In the page: the heading line holding the caret, once it is near the top of the window. */
  const atHeading = () => {
    const node = getSelection().focusNode;
    const line = (node?.nodeType === Node.TEXT_NODE ? node.parentElement : node)?.closest(
      ".cm-line",
    );
    if (!line?.classList.contains("pg-heading")) return null;
    const top = document.querySelector(".cm-scroller").getBoundingClientRect().top;
    return line.getBoundingClientRect().top - top < 100 && line.textContent;
  };

  test("a link to a heading in the file goes there, from Go to and from Ctrl and a click", async () => {
    const words = await linkAt("Tables");
    await page.click(words.x, words.y);
    // A tooltip is placed off the page until CodeMirror measures where it goes.
    const button = await page.until(() => {
      const button = document.querySelector(".pg-address button");
      const box = button?.getBoundingClientRect();
      const inside = box && box.top >= 0 && box.bottom <= innerHeight;
      return (
        inside && { text: button.textContent, x: box.x + box.width / 2, y: box.y + box.height / 2 }
      );
    });
    assert.equal(button.text, "Go to");
    await page.click(button.x, button.y);
    assert.match(await page.until(atHeading), /^(## )?Tables$/);
    await controlClick("Tables");
    assert.match(await page.until(atHeading), /^(## )?Tables$/);
  });

  /** The middle of a link or summary's words in an HTML block, once its frame holds still. */
  function inFrame(words) {
    return page.until((words) => {
      const frame = [...document.querySelectorAll("iframe.pg-html")].find((frame) =>
        frame.contentDocument?.body?.textContent.includes(words),
      );
      if (!frame) {
        document.querySelector(".cm-scroller").scrollTop = 0;
        return null;
      }
      const box = frame.getBoundingClientRect();
      if (box.top < 0 || box.bottom > innerHeight) {
        frame.scrollIntoView({ block: "center" });
        return null;
      }
      const target = [...frame.contentDocument.querySelectorAll("a, summary")].find(
        (el) => el.textContent === words,
      );
      const inner = target.getBoundingClientRect();
      const at = { x: box.x + inner.x + inner.width / 2, y: box.y + inner.y + inner.height / 2 };
      const still = window.lastFrameAt?.x === at.x && window.lastFrameAt?.y === at.y;
      window.lastFrameAt = at;
      return still && at;
    }, words);
  }

  test("a link in an HTML block opens from Ctrl and a click, and goes to a heading", async () => {
    const before = openedSoFar().length;
    // A plain click follows nothing.
    const web = await inFrame("html link");
    await page.click(web.x, web.y);
    await sleep(500);
    assert.equal(openedSoFar().length, before);
    await page.clickWith(Key.Control, web.x, web.y);
    for (let tries = 0; openedSoFar().length < before + 1 && tries < 50; tries += 1)
      await sleep(100);
    assert.deepEqual(openedSoFar().slice(before), ["https://html.example.com/"]);
    const heading = await inFrame("html heading");
    await page.clickWith(Key.Control, heading.x, heading.y);
    assert.match(await page.until(atHeading), /^(## )?Tables$/);
  });

  test("a plain click on a link in an HTML block shows its address under it", async () => {
    /** In the page: the popover, once it shows the address asked for and sits in the window. */
    const popover = (address) => {
      const box = document.querySelector(".pg-address");
      const shown = box?.getBoundingClientRect();
      const button = box?.querySelector("button");
      const press = button?.getBoundingClientRect();
      return (
        box?.querySelector(".pg-address-url").textContent === address &&
        shown.top >= 0 &&
        shown.bottom <= innerHeight && {
          top: shown.top,
          left: shown.left,
          button: button?.textContent,
          x: press && press.x + press.width / 2,
          y: press && press.y + press.height / 2,
        }
      );
    };
    const web = await inFrame("html link");
    await page.click(web.x, web.y);
    const shown = await page.until(popover, "https://html.example.com/");
    assert.equal(shown.button, "Open");
    // Under the link's words, as on the page.
    assert.ok(
      shown.top > web.y && shown.top - web.y < 40 && shown.left < web.x,
      JSON.stringify({ shown, web }),
    );
    const heading = await inFrame("html heading");
    await page.click(heading.x, heading.y);
    const goTo = await page.until(popover, "#tables");
    assert.equal(goTo.button, "Go to");
    await page.click(goTo.x, goTo.y);
    assert.match(await page.until(atHeading), /^(## )?Tables$/);
  });

  test("a frame link's address hides while its frame is scrolled away", async () => {
    let web = await inFrame("html link");
    await page.click(web.x, web.y);
    /** In the page: the popover's top, once it shows the frame link's address in the window. */
    const popover = () => {
      const box = document.querySelector(".pg-address");
      const top = box?.getBoundingClientRect().top;
      return box?.textContent.includes("https://html.example.com/") && top >= 0 && { top };
    };
    const shown = await page.until(popover);
    assert.ok(shown.top > web.y, JSON.stringify({ shown, web }));
    // At the end of the file. The popover stays, out of the window.
    await page.until(() => {
      const scroller = document.querySelector(".cm-scroller");
      scroller.scrollTop = scroller.scrollHeight;
      return document.querySelector(".pg-address")?.getBoundingClientRect().bottom < 0;
    });
    web = await inFrame("html link");
    const back = await page.until(popover);
    assert.ok(back.top > web.y, JSON.stringify({ back, web }));
  });

  test("a summary in an HTML block opens and closes its details from a click", async () => {
    const details = () =>
      [...document.querySelectorAll("iframe.pg-html")]
        .map((frame) => [frame, frame.contentDocument.querySelector("details")])
        .filter(([, details]) => details)
        .map(([frame, details]) => ({
          open: details.open,
          height: frame.getBoundingClientRect().height,
        }))[0];
    let at = await inFrame("html summary");
    const closed = await page.run(details);
    assert.equal(closed.open, false);
    await page.click(at.x, at.y);
    const opened = await page.until(details);
    assert.equal(opened.open, true);
    // The frame grows to show what it holds.
    const grown = await page.until((height) => {
      const frame = [...document.querySelectorAll("iframe.pg-html")].find((frame) =>
        frame.contentDocument.querySelector("details"),
      );
      const now = frame.getBoundingClientRect().height;
      return now > height && now;
    }, closed.height);
    assert.ok(grown > closed.height);
    at = await inFrame("html summary");
    await page.click(at.x, at.y);
    assert.equal((await page.run(details)).open, false);
  });

  test("a details in an HTML block stays as the reader left it when its frame is drawn again", async () => {
    /** In the page: whether the frame's details is open, or null while its frame is not drawn. */
    const open = () =>
      [...document.querySelectorAll("iframe.pg-html")]
        .map((frame) => frame.contentDocument?.querySelector("details"))
        .find((details) => details)?.open ?? null;
    let at = await inFrame("html summary");
    await page.click(at.x, at.y);
    assert.equal(await page.until(open), true);
    // The caret leaves the frame, which CodeMirror keeps drawn while the caret is on it. The line
    // below moves down as the frame grows, so it is clicked once it holds still.
    const below = await page.until(() => {
      const line = [...document.querySelectorAll(".cm-line")].find(
        (line) => line.textContent === "Filler paragraph 0.",
      );
      const box = line?.getBoundingClientRect();
      if (!box) return null;
      if (box.top < 0 || box.bottom > innerHeight) {
        line.scrollIntoView({ block: "center" });
        return null;
      }
      const at = { x: box.x + 20, y: box.y + box.height / 2 };
      const still = window.lastBelowAt?.x === at.x && window.lastBelowAt?.y === at.y;
      window.lastBelowAt = at;
      return still && at;
    });
    await page.click(below.x, below.y);
    // At the end of the file, where CodeMirror lets the frame go.
    await page.until(() => {
      const scroller = document.querySelector(".cm-scroller");
      scroller.scrollTop = scroller.scrollHeight;
      return ![...document.querySelectorAll("iframe.pg-html")].some((frame) =>
        frame.contentDocument?.body?.textContent.includes("html summary"),
      );
    });
    at = await inFrame("html summary");
    assert.equal(await page.until(open), true);
    await page.click(at.x, at.y);
    assert.equal(await page.run(open), false);
  });

  test("a link to no heading shows its address, and nothing to follow", async () => {
    const words = await linkAt("nowhere");
    await page.click(words.x, words.y);
    const popover = await page.until(() => {
      const box = document.querySelector(".pg-address");
      return (
        box?.textContent.includes("#nothing-here") && {
          text: box.textContent,
          buttons: box.querySelectorAll("button").length,
        }
      );
    });
    assert.deepEqual(popover, { text: "#nothing-here", buttons: 0 });
  });

  test("a find match in a link's title shows, marked, in its popover", async () => {
    await page.press(Key.Control, "f");
    await page.run(() => document.querySelector(".cm-search input[name=search]").select());
    await page.keys("A title");
    await page.press(Key.Enter);
    const popover = await page.until(() => {
      const mark = document.querySelector(".pg-address-source mark");
      return mark && [mark.textContent, document.querySelector(".pg-address-url").textContent];
    });
    assert.deepEqual(popover, ["A title", "https://example.com/docs"]);
    await page.press(Key.Escape);
  });
});

describe("a task list", () => {
  const folder = mkdtempSync(join(tmpdir(), "hshblk-tasks-"));
  const file = join(folder, "tasks.md");
  writeFileSync(file, "# Tasks\n\n- [ ] still to do\n- [x] done\n");
  const bytes = fingerprint(file);
  let page;

  before(async () => {
    page = await launch(app, [file]);
    await page.until(() => document.querySelectorAll(".pg-task").length === 2);
  });
  after(async () => {
    await page?.close();
    await gone();
  });

  /** In the page: each box's state, and the middle of the first. */
  const boxes = () => {
    const all = [...document.querySelectorAll(".pg-task")];
    const box = all[0].getBoundingClientRect();
    return {
      checked: all.map((task) => task.getAttribute("aria-checked")),
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
    };
  };

  test("draws each box as the file has it, and a click ticks it on the page only", async () => {
    const before = await page.run(boxes);
    assert.deepEqual(before.checked, ["false", "true"]);
    /** In the page: whether the first box shows ticked, as wanted. */
    const first = (ticked) =>
      document.querySelector(".pg-task")?.getAttribute("aria-checked") === String(ticked);
    await page.click(before.x, before.y);
    await page.until(first, true);
    // Both boxes still show, not their source, so the click opened nothing.
    assert.deepEqual((await page.run(boxes)).checked, ["true", "true"]);
    await page.click(before.x, before.y);
    await page.until(first, false);
    assert.deepEqual(fingerprint(file), bytes);
  });

  test("draws the tick inside a ticked box, in a hung line", async () => {
    // #158: the check took the line's negative indent, and drew left of its box, paper on paper.
    const indents = await page.run(() =>
      [...document.querySelectorAll(".pg-task-ticked")].map(
        (box) => getComputedStyle(box, "::after").textIndent,
      ),
    );
    assert.deepEqual(indents, ["0px"]);
  });
});

describe("frontmatter", () => {
  const folder = mkdtempSync(join(tmpdir(), "hshblk-frontmatter-"));
  const file = join(folder, "front.md");
  writeFileSync(file, "---\ntitle: Notes\ntags: [a, b]\n---\n\n# Front\n\nText.\n");
  const bytes = fingerprint(file);
  let page;

  before(async () => {
    page = await launch(app, [file]);
    await page.until(() => document.querySelector(".pg-h1"));
  });
  after(async () => {
    await page?.close();
    await gone();
  });

  const text = () => document.querySelector(".cm-content").textContent;

  test("stays folded when the first keys move the caret", async () => {
    await page.press(Key.ArrowRight);
    await page.press(Key.End);
    assert.doesNotMatch(await page.run(text), /title:/);
  });

  test("folds away, and the status line's indicator opens its fields", async () => {
    assert.doesNotMatch(await page.run(text), /title:/);
    const at = await page.until(() => {
      const button = document.querySelector(".status-frontmatter");
      if (!button || button.hidden) return null;
      const box = button.getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    });
    await page.click(at.x, at.y);
    // The panel loads the yaml package as it first opens, so this also finds it under the CSP.
    const listed = await page.until(() => {
      const terms = [...document.querySelectorAll(".pg-front-fields dt, .pg-front-fields dd")];
      return terms.map((term) => term.textContent).join(" ");
    });
    assert.equal(listed, "title Notes tags a, b");
    await page.press(Key.Control, Key.Shift, "M");
    assert.ok(await page.until(() => !document.querySelector(".pg-front-panel")));
    assert.deepEqual(fingerprint(file), bytes);
  });

  test("Tab to the status line's button shows where focus is", async () => {
    // #163: the engine's ring was near black, and did not show on the night's paper.
    await page.run(() => document.querySelector(".cm-content").focus());
    await page.press(Key.Tab);
    const ring = await page.until(() => {
      const button = document.activeElement;
      if (!button?.classList.contains("status-frontmatter")) return null;
      const style = getComputedStyle(button);
      return [button.matches(":focus-visible"), style.outlineStyle, style.outlineWidth];
    });
    assert.deepEqual(ring, [true, "solid", "2px"]);
  });
});

describe("find", () => {
  const folder = mkdtempSync(join(tmpdir(), "hshblk-find-"));
  const file = join(folder, "find.md");
  writeFileSync(file, "one two one three one\n\nAnother one.\n");
  let page;

  before(async () => {
    page = await launch(app, [file]);
    await page.until(() => document.querySelector(".cm-content")?.textContent.includes("Another"));
  });
  after(async () => {
    await page?.close();
    await gone();
  });

  /** In the page: what the find box says of the matches. */
  const said = () => document.querySelector(".pg-find-count")?.textContent;

  test("counts the matches, marks the current one apart, and offers no all", async () => {
    // #203: it said nothing of how many. #159: the current one looked like the rest. #202: all
    // selected one.
    await page.press(Key.Control, "f");
    await page.until(() => document.activeElement?.name === "search");
    await page.keys("one");
    assert.equal(await page.until(said), "4 matches");
    await page.press(Key.Enter);
    const current = () => {
      const words = document.querySelector(".pg-find-count")?.textContent;
      return / of /.test(words ?? "") && words;
    };
    assert.equal(await page.until(current), "1 of 4");
    const look = await page.until(() => {
      const current = document.querySelector(".cm-searchMatch-selected");
      const other = document.querySelector(".cm-searchMatch:not(.cm-searchMatch-selected)");
      if (!current || !other) return null;
      return [getComputedStyle(current).backgroundColor, getComputedStyle(other).backgroundColor];
    });
    assert.notEqual(look[0], look[1]);
    const all = await page.run(
      () => getComputedStyle(document.querySelector(".cm-search button[name=select]")).display,
    );
    assert.equal(all, "none");
  });

  test("says when there is no match, and leaves no old match selected", async () => {
    await page.run(() => document.activeElement.select());
    await page.keys("zzqq");
    const none = () => document.querySelector(".pg-find-count")?.textContent === "No matches";
    assert.ok(await page.until(none));
    // The page has the focus back, and its selection is the editor's.
    await page.press(Key.Escape);
    await page.until(() => document.activeElement?.classList.contains("cm-content"));
    assert.equal(await page.run(() => window.getSelection().toString()), "");
  });
});

describe("a <details> around markdown", () => {
  const folder = mkdtempSync(join(tmpdir(), "hshblk-details-"));
  const file = join(folder, "details.md");
  writeFileSync(
    file,
    `# Details

<details>
<summary>More <b>notes</b></summary>

A folded body with a needle in it.

</details>

After.

| a | b |
|---|---|
| c | d |

<p>A frame.</p>

End.
`,
  );
  let page;

  before(async () => {
    page = await launch(app, [file]);
    await page.until(() => document.querySelector(".pg-summary"));
  });
  after(async () => {
    await page?.close();
    await gone();
  });

  /** In the page: the summary's words and state, and whether the body shows. */
  const state = () => {
    const summary = document.querySelector(".pg-summary");
    const box = summary.getBoundingClientRect();
    return {
      summary: summary.textContent,
      open: summary.getAttribute("aria-expanded"),
      body: [...document.querySelectorAll(".cm-line")].some((line) =>
        line.textContent.includes("needle"),
      ),
      x: box.x + 40,
      y: box.y + box.height / 2,
    };
  };

  test("opens and closes from its summary", async () => {
    const closed = await page.run(state);
    assert.deepEqual([closed.summary, closed.open, closed.body], ["More notes", "false", false]);
    await page.click(closed.x, closed.y);
    const opened = await page.until(() => {
      const summary = document.querySelector(".pg-summary");
      const lines = [...document.querySelectorAll(".cm-line")].map((line) => line.textContent);
      return summary?.getAttribute("aria-expanded") === "true" && lines;
    });
    assert.ok(opened.includes("A folded body with a needle in it."));
    const at = await page.run(state);
    await page.click(at.x, at.y);
    await page.until(() => document.querySelector(".pg-summary[aria-expanded=false]"));
    assert.equal((await page.run(state)).body, false);
  });

  test("opens and closes from Enter with the caret on its tags", async () => {
    const title = await page.run(() => {
      const box = document.querySelector(".pg-h1").getBoundingClientRect();
      return { x: box.x + 20, y: box.y + box.height / 2 };
    });
    // A click on the title opens nothing. The keys bring the caret onto the tags: down to the
    // blank line, and right onto the opening tag, which shows its source.
    await page.click(title.x, title.y);
    await page.press(Key.ArrowDown);
    await page.press(Key.ArrowRight);
    /** In the page: whether the tags show as source, with the body showing or not as asked. */
    const tagsWithBody = (body) => {
      const lines = [...document.querySelectorAll(".cm-line")].map((line) => line.textContent);
      return lines.includes("<details>") && lines.some((line) => line.includes("needle")) === body;
    };
    await page.until(tagsWithBody, false);
    await page.press(Key.Enter);
    await page.until(tagsWithBody, true);
    await page.press(Key.Enter);
    await page.until(tagsWithBody, false);
  });

  test("Up and Down stop on it, a table, and an HTML block, and open their source", async () => {
    /** In the page: the line holding the caret, as it reads. */
    const caretLine = () => {
      const node = getSelection().focusNode;
      const line = (node?.nodeType === Node.TEXT_NODE ? node.parentElement : node)?.closest(
        ".cm-line",
      );
      return line && { text: line.textContent };
    };
    const title = await page.run(() => {
      const box = document.querySelector(".pg-h1").getBoundingClientRect();
      return { x: box.x + 20, y: box.y + box.height / 2 };
    });
    await page.click(title.x, title.y);
    const walk = async (key, times) => {
      const lines = [];
      for (let i = 0; i < times; i += 1) {
        await page.press(key);
        lines.push((await page.until(caretLine)).text);
      }
      return lines;
    };
    // The folded body and the closing tag are hidden, so the keys pass them.
    assert.deepEqual(await walk(Key.ArrowDown, 13), [
      "",
      "<details>",
      "<summary>More <b>notes</b></summary>",
      "",
      "After.",
      "",
      "| a | b |",
      "|---|---|",
      "| c | d |",
      "",
      "<p>A frame.</p>",
      "",
      "End.",
    ]);
    assert.deepEqual(await walk(Key.ArrowUp, 13), [
      "",
      "<p>A frame.</p>",
      "",
      "| c | d |",
      "|---|---|",
      "| a | b |",
      "",
      "After.",
      "",
      "<summary>More <b>notes</b></summary>",
      "<details>",
      "",
      "# Details",
    ]);
  });

  test("find in its body opens it", async () => {
    await page.press(Key.Control, "f");
    await page.keys("needle");
    await page.press(Key.Enter);
    assert.equal(
      await page.until(() => document.querySelector(".cm-searchMatch-selected")?.textContent),
      "needle",
    );
    assert.equal((await page.run(state)).open, "true");
    await page.press(Key.Escape);
  });
});

describe("print", () => {
  // An HTML block near the top, and two below the window, which print has to draw and load.
  const frames = `<details><summary>Near frame</summary><p>Near frame body.</p></details>

${FILLER}

<p>Far frame text.</p>

<details><summary>Far frame</summary><p>Far frame body.</p></details>`;
  const { file } = fixture(NOTES.replace(FILLER, frames));

  test("5. prints every line of the page, drawn, with no syntax open", async () => {
    const printed = await printByKeyboard(file);
    assert.match(printed, /^Notes$/m);
    assert.match(printed, /^A reference link/m);
    assert.match(printed, /^Filler paragraph 1499\.$/m);
    // A <details> prints open.
    assert.match(printed, /More notes$/m);
    assert.match(printed, /^A folded body\.$/m);
    assert.match(printed, /^The end\.$/m);
    assert.doesNotMatch(printed, /^# |\*\*|\[far\]/m);
    // So does every HTML block, the ones below the window too, with each details in one open.
    assert.match(printed, /Near frame body\./);
    assert.match(printed, /Far frame text\./);
    assert.match(printed, /Far frame body\./);
  });

  test("leaves the find box out, as it is for the screen", async () => {
    const printed = await printByKeyboard(file, ["Right", "ctrl+f", "ctrl+p"]);
    assert.match(printed, /^Notes$/m);
    assert.doesNotMatch(printed, /match case|by word|regexp/);
  });
});

describe("a file that does not open", () => {
  // With no window, the driver waits for one without end. A timeout says what went wrong.
  const timeout = 30_000;

  test("leaves a window to open another from, and to quit by", { timeout }, async () => {
    for (const path of [join(work, "missing.md"), work]) {
      const page = await launch(app, [path]);
      try {
        assert.ok(await page.until(() => document.querySelector(".welcome-open")));
      } finally {
        await page.close();
        await gone();
      }
    }
  });
});

describe("quit and reopen", () => {
  const { root, file } = fixture();
  const files = listing(root);
  const bytes = fingerprint(file);

  test("4. opens straight to the page, twice, and writes nothing beside the file", async () => {
    for (let run = 0; run < 2; run += 1) {
      const page = await launch(app, [file]);
      try {
        const heading = await page.until(() => document.querySelector(".pg-h1")?.textContent);
        assert.equal(heading, "Notes");
        assert.equal(await page.run(() => document.querySelector(".welcome")), null);
      } finally {
        await page.close();
        await gone();
      }
    }
    assert.deepEqual(listing(root), files, `written under ${relative(tmpdir(), root)}`);
    assert.deepEqual(fingerprint(file), bytes);
  });
});

describe("an HTML block's frame", () => {
  const folder = mkdtempSync(join(tmpdir(), "hshblk-frames-"));
  const file = join(folder, "frames.md");
  writeFileSync(
    file,
    `<h1 align="center">Project</h1>

<table><tr><th>Name</th><th align="right">Value</th></tr><tr><td>alpha</td><td align="right">1</td></tr></table>

<form><input name="q"><button>Send</button></form>

<p><a href="https://example.com/">A link</a> <iframe src="https://example.com/"></iframe></p>

<details><summary>One-line details</summary>Body</details>

<details>
<summary><b>Bold</b> summary with <code>code</code></summary>

A markdown body.

</details>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="dark.png">
  <img src="light.png" alt="mark">
</picture>

${Array.from({ length: 60 }, (_, n) => `Paragraph ${n}, long enough for the page to scroll.`).join("\n\n")}
`,
  );
  writeFileSync(join(folder, "dark.png"), PNG);
  writeFileSync(join(folder, "light.png"), PNG);
  let page;
  let drawn;

  before(async () => {
    page = await launch(app, [file]);
    drawn = await page.until(() => {
      const frames = [...document.querySelectorAll("iframe.pg-html")];
      // Its HTML loaded, and the frame sized to it in pixels. Until then it is a line tall, in em.
      const ready = (frame) =>
        frame.contentDocument?.URL === "about:srcdoc" &&
        frame.contentDocument.readyState === "complete" &&
        frame.style.height.endsWith("px");
      if (frames.length < 6 || !frames.every(ready)) return null;
      return frames.map((frame) => {
        const doc = frame.contentDocument;
        const style = (el, pseudo) => frame.contentWindow.getComputedStyle(el, pseudo);
        const heading = doc.querySelector("h1");
        const cells = [...doc.querySelectorAll("th, td")];
        return {
          height: frame.getBoundingClientRect().height,
          spills: doc.body.scrollHeight - frame.clientHeight,
          // A line at least as tall as its letters, so none is cut off.
          heading:
            heading && parseFloat(style(heading).lineHeight) >= parseFloat(style(heading).fontSize),
          frameTab: frame.tabIndex,
          cells: cells.map((cell) => [
            parseFloat(style(cell).paddingRight) > 0,
            style(cell).borderBottomWidth,
            // The engine names an align attribute's side its own way, and the default "start".
            /right/.test(style(cell).textAlign)
              ? "right"
              : /center/.test(style(cell).textAlign)
                ? "center"
                : "left",
          ]),
          fields: [...doc.querySelectorAll("input, button")].map((field) => field.disabled),
          sources: [...doc.querySelectorAll("source")].map((source) =>
            source.getAttribute("srcset"),
          ),
          links: [...doc.querySelectorAll("a, summary")].map((el) => el.tabIndex),
          inner: [...doc.querySelectorAll("iframe")].map((inner) => style(inner).display),
          marker: [...doc.querySelectorAll("summary")].map((el) => style(el, "::before").content),
        };
      });
    });
  });
  after(async () => {
    await page?.close();
    await gone();
  });

  test("a file that starts with one opens at its top, with the block in view", async () => {
    // #152: CodeMirror kept the line after the frame where it was as the frame took its height.
    // It does so as it next measures, after the frames have their heights.
    await sleep(500);
    assert.equal(await page.run(() => document.querySelector(".cm-scroller").scrollTop), 0);
  });

  test("a picture keeps a source in the repository, for the engine to pick by its media", () => {
    // #171: every srcset was dropped, so a README's dark-mode mark never showed.
    assert.equal(drawn[5].sources.length, 1);
    assert.match(drawn[5].sources[0], /dark\.png$/);
  });

  test("a heading in one is not cut off, and no frame scrolls", () => {
    // #227: the page's line height came as a length, too short for a heading.
    assert.equal(drawn[0].heading, true);
    for (const frame of drawn) assert.ok(frame.spills <= 0, JSON.stringify(frame));
  });

  test("a table in one draws as the page's tables do, and keeps its alignment", () => {
    // #226: it had no rules and no padding.
    assert.deepEqual(drawn[1].cells, [
      [true, "1px", "left"],
      [true, "1px", "right"],
      [true, "1px", "left"],
      [true, "1px", "right"],
    ]);
  });

  test("nothing in one takes the keyboard, and a form's field takes no typing", () => {
    // #165: each frame was a tab stop, and a field in one took typing.
    assert.ok(drawn.every((frame) => frame.frameTab === -1));
    assert.deepEqual(drawn[2].fields, [true, true]);
    assert.deepEqual(drawn[3].links, [-1]);
    assert.deepEqual(drawn[4].links, [-1]);
  });

  test("a frame in one draws nothing, and its details have the page's marker", () => {
    // #170: an empty box with a border, and the engine's large filled marker.
    assert.deepEqual(drawn[3].inner, ["none"]);
    assert.deepEqual(drawn[4].marker, ['"▸"']);
  });

  test("a summary the page draws keeps its bold and its code", async () => {
    // #232: it was drawn as plain words.
    const summary = await page.until(() => {
      const summary = document.querySelector(".pg-summary");
      if (!summary) return null;
      return [
        summary.textContent,
        summary.querySelector(".pg-strong")?.textContent,
        summary.querySelector(".pg-code")?.textContent,
      ];
    });
    assert.deepEqual(summary, ["Bold summary with code", "Bold", "code"]);
  });
});

describe("reading", () => {
  const folder = mkdtempSync(join(tmpdir(), "hshblk-reading-"));
  const file = join(folder, "reading.md");
  const paragraphs = Array.from(
    { length: 120 },
    (_, n) => `Paragraph ${n}, with words enough to fill some of a line.`,
  );
  writeFileSync(
    file,
    [
      "## العربية",
      "هذه فقرة باللغة العربية مع **نص عريض** و[رابط](https://example.com).",
      "- عنصر أول\n- عنصر ثان",
      "English, with one word of עברית in it.",
      ...paragraphs,
    ].join("\n\n") + "\n",
  );
  let page;

  before(async () => {
    page = await launch(app, [file]);
    await page.until(() => document.querySelector(".pg-h2"));
  });
  after(async () => {
    await page?.close();
    await gone();
  });

  test("Arabic and Hebrew read right to left, and English left to right", async () => {
    // #198: every line was laid out left to right.
    const seen = await page.run(() => {
      const lines = [...document.querySelectorAll(".cm-line")];
      const style = (words) => getComputedStyle(lines.find((l) => l.textContent.includes(words)));
      const item = style("عنصر أول");
      return {
        heading: style("العربية").direction,
        paragraph: style("هذه فقرة").direction,
        english: style("English").direction,
        // A list item hangs from its start, which is the right.
        item: [item.direction, parseFloat(item.paddingRight) > 0, item.paddingLeft],
      };
    });
    assert.deepEqual(seen, {
      heading: "rtl",
      paragraph: "rtl",
      english: "ltr",
      item: ["rtl", true, "0px"],
    });
  });

  test("PageDown, Space, Shift+Space, and PageUp keep a line of the last page in view", async () => {
    // #197: PageDown skipped a line a page, and more past a table. #234: Space did nothing.
    await page.run(() => document.querySelector(".cm-content").focus());
    /** In the page: the lines with words in view, wholly or in part, from the top. */
    const shown = () => {
      const box = document.querySelector(".cm-scroller").getBoundingClientRect();
      return [...document.querySelectorAll(".cm-line")]
        .filter((line) => line.textContent.trim())
        .filter((line) => {
          const at = line.getBoundingClientRect();
          return at.bottom > box.top + 1 && at.top < box.bottom - 1;
        })
        .map((line) => line.textContent);
    };
    // A page moves by the window less a line, so one or two lines of the last page still show.
    const turn = async (...keys) => {
      const before = await page.run(shown);
      await page.press(...keys);
      await sleep(300);
      const after = await page.run(shown);
      const kept = after.filter((line) => before.includes(line));
      assert.ok(kept.length >= 1 && kept.length <= 2, JSON.stringify({ before, after }));
    };
    await turn(Key.PageDown);
    await turn(" ");
    await turn(Key.Shift, " ");
    await turn(Key.PageUp);
  });
});

describe("a table's images", () => {
  const folder = mkdtempSync(join(tmpdir(), "hshblk-cells-"));
  const file = join(folder, "cells.md");
  writeFileSync(
    file,
    "| ![dot](dot.png) | beside |\n|---|---|\n| ![remote](https://example.com/r.png) | x |\n",
  );
  writeFileSync(join(folder, "dot.png"), PNG);
  let page;

  before(async () => {
    page = await launch(app, [file]);
    await page.until(() => document.querySelector(".pg-table"));
  });
  after(async () => {
    await page?.close();
    await gone();
  });

  test("an image in a cell shows from the repository, and a remote one is a chip", async () => {
    // #155: a cell showed an image's words, so a README's grid of badges was a row of text.
    const seen = await page.until(() => {
      const image = document.querySelector(".pg-table img.pg-image");
      const chip = document.querySelector(".pg-table .pg-image-chip");
      return image?.complete && chip && [image.naturalWidth > 0, chip.textContent];
    });
    assert.deepEqual(seen, [true, "remote"]);
  });
});

describe("layout", () => {
  const folder = mkdtempSync(join(tmpdir(), "hshblk-layout-"));
  const file = join(folder, "layout.md");
  const long = "and this sentence goes on long enough to wrap at the default window size ".repeat(
    3,
  );
  writeFileSync(
    file,
    `- A browser product, ${long}
  1. A nested item, ${long}
     More of it, ${long}

| Decision | Host | Document |
|---|---|---|
| Host | provisional | The reason is who patches the engine. ${long} |

| Address |
|---|
| https://example.com/${"averylongaddress".repeat(8)} |

A [link below the table](https://example.com/below) and more words.

[![CI](https://example.com/ci.svg)](https://example.com/ci) [![npm](https://example.com/npm.svg)](https://example.com/npm) [![License: MIT](https://example.com/mit.svg)](LICENSE) [![codecov](https://example.com/cov.svg)](https://example.com/cov) [![Downloads](https://example.com/dl.svg)](https://example.com/dl)

![wide](wide.svg)

A dot ![dot](dot.png) in a line, and one at the end ![end](dot.png).

#### Four

##### Five

###### Six
`,
  );
  writeFileSync(join(folder, "dot.png"), PNG);
  writeFileSync(
    join(folder, "wide.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" width="3000" height="40"><rect width="3000" height="40" fill="gray"/></svg>',
  );
  let page;

  before(async () => {
    page = await launch(app, [file]);
    await page.until(() => document.querySelectorAll(".pg-table").length === 2);
  });
  after(async () => {
    await page?.close();
    await gone();
  });

  test("a list item's wrapped lines start under its text, at every level", async () => {
    const starts = await page.run(() =>
      [...document.querySelectorAll(".cm-line")]
        .filter((line) => /pg-hang-/.test(line.className))
        .map((line) => {
          // From after the indent and the marker to the end: one left edge a visual line.
          const range = document.createRange();
          range.setStartAfter([...line.querySelectorAll("[class*='pg-box-']")].at(-1));
          range.setEndAfter(line.lastChild);
          const lefts = new Map();
          for (const { top, left } of range.getClientRects()) {
            const row = Math.round(top);
            lefts.set(row, Math.min(left, lefts.get(row) ?? Infinity));
          }
          return [...lefts.values()].map(Math.round);
        }),
    );
    assert.equal(starts.length, 3);
    for (const lefts of starts) {
      assert.ok(lefts.length > 1, "the line wraps");
      assert.ok(Math.max(...lefts) - Math.min(...lefts) <= 1, `lines start at ${lefts}`);
    }
    // The nested item's text, and its next line's, sit right of the outer item's.
    assert.ok(starts[1][0] > starts[0][0]);
    assert.equal(starts[2][0], starts[1][0]);
  });

  test("a click in the hanging space puts the caret at the start of that visual line", async () => {
    const target = await page.run(() => {
      const line = document.querySelector(".cm-line[class*='pg-hang-']");
      const range = document.createRange();
      range.selectNodeContents(line);
      const rows = [...range.getClientRects()].sort((a, b) => a.top - b.top || a.left - b.left);
      const second = rows.find((rect) => rect.top > rows[0].top + 1);
      const box = line.getBoundingClientRect();
      return { x: box.left + 2, y: second.top + second.height / 2, left: second.left };
    });
    await page.click(target.x, target.y);
    const caret = await page.until(() => {
      const selection = getSelection();
      if (!selection.isCollapsed || selection.focusNode?.nodeType !== Node.TEXT_NODE) return null;
      // The character after the caret, which at a wrap is the first of the visual line below.
      const range = document.createRange();
      range.setStart(selection.focusNode, selection.focusOffset);
      range.setEnd(selection.focusNode, selection.focusOffset + 1);
      const { top, left, height } = range.getBoundingClientRect();
      return { y: top + height / 2, left };
    });
    assert.ok(Math.abs(caret.y - target.y) <= 2, `caret row ${caret.y}, clicked ${target.y}`);
    assert.ok(
      Math.abs(caret.left - target.left) <= 1,
      `caret at ${caret.left}, row at ${target.left}`,
    );
  });

  test("a table's short columns keep their words whole", async () => {
    const lines = await page.run(() =>
      [...document.querySelectorAll(".pg-table")][0]
        .querySelectorAll("th, tr:first-child td:not(:last-child)")
        .values()
        .map((cell) => {
          const range = document.createRange();
          range.selectNodeContents(cell);
          return [cell.textContent, new Set([...range.getClientRects()].map((r) => r.top)).size];
        })
        .toArray(),
    );
    assert.deepEqual(lines, [
      ["Decision", 1],
      ["Host", 1],
      ["Document", 1],
      ["Host", 1],
      ["provisional", 1],
    ]);
    const widths = await page.run(() => {
      const [, wide] = document.querySelectorAll(".pg-table");
      const scroller = document.querySelector(".cm-scroller");
      return {
        table: [wide.scrollWidth, wide.clientWidth],
        page: [scroller.scrollWidth, scroller.clientWidth],
      };
    });
    assert.ok(widths.table[0] > widths.table[1], "the long address scrolls in its table");
    assert.ok(widths.page[0] <= widths.page[1], "the page does not scroll sideways");
  });

  test("a click below a table lands where it was aimed", async () => {
    await page.run(() =>
      [...document.querySelectorAll(".pg-link")]
        .find((el) => el.textContent === "link below the table")
        .scrollIntoView({ block: "center" }),
    );
    // CodeMirror measures what a scroll brings in, which may move the link. It is clicked once
    // it holds still.
    const words = await page.until(() => {
      const link = [...document.querySelectorAll(".pg-link")].find(
        (el) => el.textContent === "link below the table",
      );
      const box = link?.getBoundingClientRect();
      if (!box || box.top <= 0) return null;
      const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      const still = window.lastBelow?.x === at.x && window.lastBelow?.y === at.y;
      window.lastBelow = at;
      return still && at;
    });
    await page.click(words.x, words.y);
    const address = await page.until(() => document.querySelector(".pg-address-url")?.textContent);
    assert.equal(address, "https://example.com/below");
    await page.press(Key.Escape);
  });

  test("an image in a line stays in it, and one alone is a block no wider than the page", async () => {
    const seen = await page.until(() => {
      const images = [...document.querySelectorAll("img.pg-image")];
      if (images.length < 3 || !images.every((image) => image.complete)) return null;
      const rows = (els) =>
        new Set(els.map((el) => Math.round(el.getBoundingClientRect().top))).size;
      const chips = [...document.querySelectorAll(".pg-image-chip")];
      const wide = document.querySelector("img[alt='wide']");
      const content = document.querySelector(".cm-content").getBoundingClientRect();
      const dot = document.querySelector("img[alt='end']");
      // The full stop after the last image: the line's last character.
      const line = dot.closest(".cm-line");
      const range = document.createRange();
      range.setStart(line.lastChild, line.lastChild.length - 1);
      range.setEnd(line.lastChild, line.lastChild.length);
      const stop = range.getBoundingClientRect();
      const image = dot.getBoundingClientRect();
      return {
        chips: chips.map((chip) => chip.textContent),
        chipRows: rows(chips),
        wide: wide.getBoundingClientRect().width <= content.width,
        wideAlone: wide.closest(".pg-figure") !== null,
        inLine: document.querySelector("img[alt='dot']").closest(".pg-figure-inline") !== null,
        stop: [range.toString(), Math.abs(stop.bottom - image.bottom) < stop.height],
      };
    });
    assert.deepEqual(seen.chips, ["CI", "npm", "License: MIT", "codecov", "Downloads"]);
    assert.ok(seen.chipRows <= 2, `the badges take ${seen.chipRows} rows`);
    assert.ok(seen.wide, "the lone image is no wider than the page");
    assert.ok(seen.wideAlone, "the lone image is a block");
    assert.ok(seen.inLine, "an image between words stays in the line");
    assert.deepEqual(seen.stop, [".", true]);
  });

  test("headings four to six draw apart, each smaller, and six muted", async () => {
    // #211: they shared one rule.
    const drawn = await page.until(() => {
      document.querySelector(".cm-scroller").scrollTop = 1e6;
      const lines = [".pg-h4", ".pg-h5", ".pg-h6"].map((name) => document.querySelector(name));
      if (!lines.every(Boolean)) return null;
      return lines.map((line) => {
        const style = getComputedStyle(line);
        return { size: parseFloat(style.fontSize), color: style.color };
      });
    });
    const [four, five, six] = drawn;
    assert.ok(four.size > five.size && five.size > six.size, JSON.stringify(drawn));
    assert.equal(four.color, five.color);
    assert.notEqual(six.color, five.color);
  });
});
