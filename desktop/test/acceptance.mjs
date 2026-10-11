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

| Left | Right |
|:-----|------:|
| a    | b     |

![near](near.png) ![spaced](near%20by.png) ![far](../images/far.png) ![outside](../../outside.png) ![leaving](leave.png) ![remote](https://example.com/remote.png)

<script>window.ran = "block";</script>

<div onclick="window.ran = 'click'">Raw <b>HTML</b> block</div>

Inline <img src="x" onerror="window.ran = 'inline'"> HTML.

${FILLER}

[far]: https://example.com/far

The **end**.
`;

/**
 * root/repo/.git, root/repo/docs/notes.md beside near.png, "near by.png", and a symlink that
 * leaves the repository, root/repo/images/far.png, and root/outside.png.
 */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "hshblk-acceptance-"));
  const repo = join(root, "repo");
  for (const dir of [".git", "docs", "images"]) mkdirSync(join(repo, dir), { recursive: true });
  writeFileSync(join(repo, "docs", "near.png"), PNG);
  writeFileSync(join(repo, "docs", "near by.png"), PNG);
  writeFileSync(join(repo, "images", "far.png"), PNG);
  writeFileSync(join(root, "outside.png"), PNG);
  symlinkSync(join(root, "outside.png"), join(repo, "docs", "leave.png"));
  const file = join(repo, "docs", "notes.md");
  writeFileSync(file, NOTES);
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
async function printByKeyboard(file) {
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
      await run("xdotool", ["key", "Right", "ctrl+p"]);
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
      missing: missing.map((el) => el.textContent),
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
  });

  test("Ctrl+P prints from the find box: the syntax open for the screen folds", async () => {
    const at = await page.run(() => {
      const box = document.querySelector(".pg-strong").getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    });
    await page.click(at.x, at.y);
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
});

describe("one open document", () => {
  const { root, file } = fixture();
  const original = fingerprint(file);
  let page;
  let shown;

  before(async () => {
    page = await launch(app, [file]);
    shown = await page.until(settled, 6);
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
    ]);
    assert.deepEqual(loads, [true, false, false, false, false, false]);
  });

  test("2. runs no script and shows raw HTML as source", async () => {
    assert.equal(await page.run(() => window.ran ?? null), null);
    const source = (await page.run(texts, ".pg-source-block")).join("\n");
    assert.match(source, /<script>window\.ran = "block";<\/script>/);
    assert.match(source, /<div onclick=/);
    const lines = await page.run(texts, ".cm-line");
    assert.ok(lines.some((line) => line.includes('Inline <img src="x" onerror=')));
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
    }));
    for (const [where, text] of Object.entries(seen)) {
      const value = Array.isArray(text) ? text.join("\n") : text;
      assert.ok(!value.includes(root), `${where} holds the path`);
      assert.ok(!value.includes(tmpdir()), `${where} holds the temporary folder`);
    }
    assert.equal(seen.title, "notes.md");
    assert.equal(JSON.parse(seen.opened).name, "notes.md");
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

  test("5. copies the source, and says so", async () => {
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
});

describe("print", () => {
  const { file } = fixture();

  test("5. prints every line of the page, drawn, with no syntax open", async () => {
    const printed = await printByKeyboard(file);
    assert.match(printed, /^Notes$/m);
    assert.match(printed, /^A reference link/m);
    assert.match(printed, /^Filler paragraph 1499\.$/m);
    assert.match(printed, /^The end\.$/m);
    assert.doesNotMatch(printed, /^# |\*\*|\[far\]/m);
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
