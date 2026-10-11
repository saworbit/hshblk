/**
 * docs/hld.md §9, the click-target gate, run through real pointer input in WebKitGTK.
 *
 *   node test/gate/click-target.mjs <app binary>
 *
 * Prints a markdown report, and exits non-zero if any case fails.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { launch, startDriver } from "../webdriver.mjs";

const LINKS = [
  "ipsum",
  "consectetur",
  "eiusmod",
  "labore",
  "aliqua",
  "veniam",
  "ullamco",
  "commodo",
  "reprehenderit",
  "pariatur",
];

/** Words marked bold, italic, and code in turn, through a wrapped paragraph. */
const MARKED = [
  "quis",
  "nostrud",
  "exercitation",
  "laboris",
  "nisi",
  "aliquip",
  "commodi",
  "consequat",
  "duis",
  "aute",
  "irure",
  "voluptate",
];
const MARKS = ["**", "*", "`"];
/** Words after each marked one, of four lengths, so the marked words fall at many places in a line. */
const AFTER = [
  "",
  " sint occaecat",
  " cupidatat non proident, sunt in",
  " culpa qui officia deserunt",
];

const FIXTURE = [
  "Some **bold** words, then plain text to the end of the line.",
  "",
  "Ends in **bold**",
  "",
  "Lorem " +
    LINKS.map(
      (word, i) => `[${word}](https://example.com/${"path/".repeat((i % 3) + 1)}${i})`,
    ).join(" dolor sit amet, sed do tempor incididunt ut et dolore magna, ") +
    " and the end.",
  "",
  "Drag from here across **bold** and on to there.",
  "",
  "A plain line to click on, which opens nothing.",
  "",
  "Ut " +
    MARKED.map((word, i) => `${MARKS[i % 3]}${word}${MARKS[i % 3]}${AFTER[i % 4]}`).join(
      " mollit anim id est, ",
    ) +
    " and the end.",
].join("\n");

// --- in the page ---------------------------------------------------------------------------

/**
 * Whether caret() and caretAtPoint() can reach CodeMirror's view. They go through its internal
 * tile tree, since the page does not expose the view and EditorView.findFromDOM needs the class.
 * An upgrade can rename the internal, as cmView became cmTile.
 */
function viewReachable() {
  return Boolean(document.querySelector(".cm-content")?.cmTile?.root?.view?.state);
}

/** The box of the character at a visible index, in the first line holding `marker`. */
function charBox(marker, index) {
  const line = [...document.querySelectorAll(".cm-line")].find((el) =>
    el.textContent.includes(marker),
  );
  const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
  let seen = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (seen + node.length > index) {
      const range = document.createRange();
      range.setStart(node, index - seen);
      range.setEnd(node, index - seen + 1);
      const { left, top, width, height } = range.getClientRects()[0];
      return { left, top, width, height, char: node.data[index - seen] };
    }
    seen += node.length;
  }
  return null;
}

/**
 * The selection's head in the source: what is before it and after it on its line. A click opens
 * no syntax, so the marks around the caret have no text in the DOM, and the source is read from
 * CodeMirror's state, through its view on the content element.
 */
function caret() {
  const view = document.querySelector(".cm-content").cmTile.root.view;
  const { head, empty } = view.state.selection.main;
  const line = view.state.doc.lineAt(head);
  const before = line.text.slice(0, head - line.from);
  return { before, after: line.text.slice(before.length), line: line.text, collapsed: empty };
}

/**
 * The top of the character just after the caret, and that character, or null while the caret
 * is not in a line. A caret at the end of one text node is the same place as the start of the
 * next, and a caret given as an element and a child index is before that child.
 */
function afterCaretBox() {
  const { focusNode, focusOffset } = getSelection();
  const line = (
    focusNode?.nodeType === Node.TEXT_NODE ? focusNode.parentElement : focusNode
  )?.closest(".cm-line");
  if (!line) return null;
  const rest = document.createRange();
  rest.setStart(focusNode, focusOffset);
  rest.setEnd(line, line.childNodes.length);
  const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    const from = text === rest.startContainer ? rest.startOffset : 0;
    if (!rest.intersectsNode(text) || from >= text.length) continue;
    const char = document.createRange();
    char.setStart(text, from);
    char.setEnd(text, from + 1);
    const rect = char.getClientRects()[0];
    return rect ? { top: rect.top, char: char.toString() } : null;
  }
  return null;
}

/**
 * Where the browser itself puts a caret at a point, in the source, as caret() reports it. The
 * point is the browser's hit test, not CodeMirror's, which the drag used.
 */
function caretAtPoint(x, y) {
  const view = document.querySelector(".cm-content").cmTile.root.view;
  const point = document.caretRangeFromPoint(x, y);
  if (!point) return null;
  const head = view.posAtDOM(point.startContainer, point.startOffset);
  const line = view.state.doc.lineAt(head);
  return { before: line.text.slice(0, head - line.from) };
}

// --- the gate ------------------------------------------------------------------------------

if (!process.argv[2]) throw new Error("usage: click-target.mjs <app binary>");
const application = resolve(process.argv[2]);

const folder = mkdtempSync(join(tmpdir(), "hshblk-gate-"));
const file = join(folder, "gate.md");
writeFileSync(file, FIXTURE);

const stop = await startDriver();
const page = await launch(application, [file]);
const cases = [];
const record = (row, name, pass, detail) => cases.push({ row, name, pass, detail });

try {
  await page.until(() => document.querySelector(".cm-line"));
  if (!(await page.run(viewReachable))) {
    throw new Error(
      "The gate cannot reach CodeMirror's view at .cm-content's cmTile.root.view. " +
        "A CodeMirror upgrade renamed that internal: update caret() and caretAtPoint().",
    );
  }
  const neutral = await page.run(charBox, "A plain line to click on", 3);
  // The click returns before CodeMirror has drawn what it did. Until then the DOM selection
  // can sit between lines, so the caret is read once it is in one.
  const caretSettled = async () => {
    for (let tries = 0; tries < 20; tries += 1) {
      const moved = await page.run(afterCaretBox);
      if (moved) return moved;
      await new Promise((done) => setTimeout(done, 50));
    }
    return null;
  };
  const settle = async () => {
    await page.click(neutral.left + 1, neutral.top + neutral.height / 2);
  };

  // Row 1: the first or last visible character of **bold**.
  for (const [name, index, side, expect] of [
    [
      "left half of the first character",
      "Some ".length,
      0.25,
      { before: "Some **", after: "bold** words" },
    ],
    [
      "right half of the last character",
      "Some bol".length,
      0.75,
      { before: "Some **bold", after: "** words" },
    ],
  ]) {
    await settle();
    const box = await page.run(charBox, "Some bold words", index);
    await page.click(box.left + box.width * side, box.top + box.height / 2);
    const got = await page.run(caret);
    const pass = got.before === expect.before && got.after.startsWith(expect.after);
    record(
      1,
      name,
      pass,
      `before ${JSON.stringify(got.before)}, after ${JSON.stringify(got.after.slice(0, 12))}`,
    );
  }

  // Row 2: past the end of a line that ends in a folded construct.
  await settle();
  const last = await page.run(charBox, "Ends in bold", "Ends in bol".length);
  await page.click(last.left + last.width + 200, last.top + last.height / 2);
  const end = await page.run(caret);
  record(
    2,
    "past the end of the line",
    end.before === "Ends in **bold**" && end.after === "",
    `before ${JSON.stringify(end.before)}`,
  );

  // Row 3: a folded link in a wrapped paragraph keeps the clicked character on its line.
  for (const word of LINKS) {
    await settle();
    const lineText = await page.run(
      () =>
        [...document.querySelectorAll(".cm-line")].find((el) => el.textContent.startsWith("Lorem"))
          .textContent,
    );
    const box = await page.run(charBox, "Lorem", lineText.indexOf(word));
    await page.click(box.left + box.width * 0.25, box.top + box.height / 2);
    const moved = await caretSettled();
    const address = await page.run(
      () => document.querySelector(".pg-address-url")?.textContent ?? null,
    );
    const pass =
      moved?.char === word[0] &&
      Math.abs(moved.top - box.top) < 2 &&
      address?.endsWith(`/${LINKS.indexOf(word)}`);
    record(
      3,
      `link "${word}"`,
      pass,
      moved
        ? `top ${box.top.toFixed(0)} → ${moved.top.toFixed(0)}, char ${JSON.stringify(moved.char)}, address ${address}`
        : "no caret",
    );
  }

  // Row 4: a drag from plain text across a folded construct ends under the pointer.
  await settle();
  const from = await page.run(charBox, "Drag from here", "Drag from ".length);
  const to = await page.run(
    charBox,
    "Drag from here",
    "Drag from here across bold and on to t".length,
  );
  const release = { x: to.left + to.width * 0.25, y: to.top + to.height / 2 };
  await page.drag({ x: from.left + from.width * 0.25, y: from.top + from.height / 2 }, release);
  const selected = await page.run(caret);
  const under = await page.run(caretAtPoint, release.x, release.y);
  record(
    4,
    "drag across **bold**",
    !selected.collapsed && selected.before === under?.before,
    `ends after ${JSON.stringify(selected.before.slice(-12))}, pointer at ${JSON.stringify(under?.before.slice(-12))}`,
  );

  // Row 5: a click on bold, italic, or code keeps the clicked character on its line. A click
  // opens no marks (§7). If it did, a word near a line's end could wrap to the next. The
  // paragraph is last, below the others, so the page scrolls to it, and a click on its first
  // word puts the caret in plain text between cases.
  await page.run(() => {
    const scroller = document.querySelector(".cm-scroller");
    scroller.scrollTop = scroller.scrollHeight;
  });
  const marked = () =>
    [...document.querySelectorAll(".cm-line")].find((el) => el.textContent.startsWith("Ut "))
      ?.textContent;
  const lineText = await page.until(marked);
  const plain = await page.run(charBox, "Ut ", 0);
  for (const [i, word] of MARKED.entries()) {
    await page.click(plain.left + 1, plain.top + plain.height / 2);
    const box = await page.run(charBox, "Ut ", lineText.indexOf(word));
    await page.click(box.left + box.width * 0.25, box.top + box.height / 2);
    const moved = await caretSettled();
    record(
      5,
      `${MARKS[i % 3]}${word}${MARKS[i % 3]}`,
      moved?.char === word[0] && Math.abs(moved.top - box.top) < 2,
      moved
        ? `top ${box.top.toFixed(0)} → ${moved.top.toFixed(0)}, char ${JSON.stringify(moved.char)}`
        : "no caret",
    );
  }
} finally {
  await page.close().catch(() => {});
  stop();
}

const webkit = execFileSync("pkg-config", ["--modversion", "webkit2gtk-4.1"], {
  encoding: "utf8",
}).trim();
const failed = cases.filter((c) => !c.pass);
console.log(
  `WebKitGTK ${webkit}. ${cases.length - failed.length} of ${cases.length} cases pass.\n`,
);
console.log("| Row | Case | Result | Measured |\n|---|---|---|---|");
for (const c of cases)
  console.log(`| ${c.row} | ${c.name} | ${c.pass ? "pass" : "**fail**"} | ${c.detail} |`);
process.exitCode = failed.length ? 1 : 0;
