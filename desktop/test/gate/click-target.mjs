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
import { join } from "node:path";
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
].join("\n");

// --- in the page ---------------------------------------------------------------------------

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

/** The selection's focus as text: what is before it and after it on its line. */
function caret() {
  const selection = getSelection();
  const line = selection.focusNode?.parentElement?.closest(".cm-line");
  if (!line) return null;
  const range = document.createRange();
  range.setStart(line, 0);
  range.setEnd(selection.focusNode, selection.focusOffset);
  const before = range.toString();
  const collapsed = selection.isCollapsed;
  return {
    before,
    after: line.textContent.slice(before.length),
    line: line.textContent,
    collapsed,
  };
}

/** The top of the character just after the caret, and that character. */
function afterCaretBox() {
  const selection = getSelection();
  const range = document.createRange();
  range.setStart(selection.focusNode, selection.focusOffset);
  range.setEnd(
    selection.focusNode,
    Math.min(selection.focusOffset + 1, selection.focusNode.length ?? 0),
  );
  const rect = range.getClientRects()[0];
  return rect ? { top: rect.top, char: range.toString() } : null;
}

/** What the caret would be if the pointer were placed here now, as caret() reports it. */
function caretAtPoint(x, y) {
  const point = document.caretRangeFromPoint(x, y);
  const line = point?.startContainer.parentElement?.closest(".cm-line");
  if (!line) return null;
  const range = document.createRange();
  range.setStart(line, 0);
  range.setEnd(point.startContainer, point.startOffset);
  return { before: range.toString() };
}

// --- the gate ------------------------------------------------------------------------------

const application = process.argv[2];
if (!application) throw new Error("usage: click-target.mjs <app binary>");

const folder = mkdtempSync(join(tmpdir(), "hshblk-gate-"));
const file = join(folder, "gate.md");
writeFileSync(file, FIXTURE);

const stop = await startDriver();
const page = await launch(application, [file]);
const cases = [];
const record = (row, name, pass, detail) => cases.push({ row, name, pass, detail });

try {
  await page.until(() => document.querySelector(".cm-line"));
  const neutral = await page.run(charBox, "A plain line to click on", 3);
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
    const moved = await page.run(afterCaretBox);
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
