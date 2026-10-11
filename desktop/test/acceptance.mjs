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

  test("keeps punctuation on the line of the code, emphasis, or link it follows, at any width", async () => {
    // Find has left the page at the end of the file. The paragraph is near its top.
    await page.run(() => (document.querySelector(".cm-scroller").scrollTop = 0));
    await page.until(() =>
      [...document.querySelectorAll(".cm-line")].some((el) =>
        el.textContent.startsWith("A paragraph with"),
      ),
    );
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
    const words = await page.until(() => {
      const link = [...document.querySelectorAll(".pg-link")].find(
        (el) => el.textContent === "link below the table",
      );
      const box = link?.getBoundingClientRect();
      return box && box.top > 0 && { x: box.x + box.width / 2, y: box.y + box.height / 2 };
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
});
