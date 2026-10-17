import { standardKeymap } from "@codemirror/commands";
import {
  search,
  searchKeymap,
  searchPanelOpen,
  selectNextOccurrence,
  selectSelectionMatches,
} from "@codemirror/search";
import { type ChangeSpec, EditorState, type Extension } from "@codemirror/state";
import { type Command, EditorView, type KeyBinding, keymap } from "@codemirror/view";
import { assetUrl, type AssetUrl, imageRefusal, type ImageRefusal } from "./page/assets.ts";
import { completeParse, finishParse } from "./page/complete.ts";
import { diagramFrame, type FrameScript } from "./page/diagrams.ts";
import { markdown } from "./page/dialect.ts";
import { findExtras } from "./page/find.ts";
import { textDirection } from "./page/direction.ts";
import { closeFrontmatter, frontmatter } from "./page/frontmatter.ts";
import { closeOutline, outlineOpen } from "./page/outline.ts";
import {
  cursorLineOnto,
  foldAll,
  page,
  printing,
  startOfPage,
  toggleDetailsAtCaret,
  toggleTaskAtCaret,
} from "./page/page.ts";
import {
  fileOpener,
  goBack,
  goForward,
  linkOpener,
  linkRefused,
  modClickOpens,
  showFrameLink,
} from "./page/links.ts";
import { clickPastLineEnd } from "./page/pointer.ts";
import { pageTheme } from "./page/theme.ts";
import { framesLoaded, printFrames, summaryToggles } from "./page/widgets.ts";

export type SurfaceOptions = {
  assets: AssetUrl;
  /** Why the resource channel refused an image, for its chip. Without one, the chip cannot say. */
  imageRefusal?: ImageRefusal;
  /** Where a link goes when the reader opens it. Without one, links only show their address. */
  openLink?: (href: string) => void;
  /** Where a link to a file in the repository goes, named as the link names it, decoded. */
  openFile?: (file: string, fragment?: string) => void;
  /** Where the shell says why a link the reader followed does not open. */
  linkRefused?: (reason: string) => void;
  /** The script of the frame mermaid draws in (#221). Without one, no diagram draws. */
  diagramFrame?: FrameScript;
  /** The CSP nonce CodeMirror puts on the styles it injects. */
  nonce?: string;
  /** Anything the shell adds: its own keys, its own handlers. */
  extensions?: Extension;
};

const lineDown = cursorLineOnto(true);
const lineUp = cursorLineOnto(false);

/**
 * #197: a page scrolls by the window less a line, as a browser's does, so the last line of one
 * page is the first of the next. CodeMirror's moved the caret a page and scrolled to keep it in
 * place, which skipped a line a page, and more past a table. The caret goes to the first whole
 * line in view, so the keys go on from there.
 */
function pageBy(direction: 1 | -1): Command {
  return (view) => {
    const scroller = view.scrollDOM;
    const line = view.defaultLineHeight;
    scroller.scrollTop += direction * Math.max(scroller.clientHeight - line, line);
    const top = scroller.getBoundingClientRect().top - view.documentTop;
    const block = view.lineBlockAtHeight(Math.max(top, 0));
    const cut = block.top < top - 1 && block.to < view.state.doc.length;
    view.dispatch({ selection: { anchor: cut ? block.to + 1 : block.from }, userEvent: "select" });
    return true;
  };
}

/**
 * Movement and selection. The state is read-only, so the editing commands here do nothing.
 * Enter on a <details>'s tags opens or closes it, and in a task item's text ticks or unticks its
 * box. Escape closes the frontmatter panel, then the outline. Up and Down stop on a drawn block,
 * and so do Ctrl+N and Ctrl+P, which CodeMirror binds to them on macOS. PageDown, PageUp, and
 * Space page by the window less a line. Alt+Left and Alt+Right, ⌘[ and ⌘] on macOS, go back from
 * a link to a heading and forward again. Find's keys that would select several matches are left
 * out.
 */
export const pageKeys: readonly KeyBinding[] = [
  { key: "Enter", run: toggleDetailsAtCaret },
  { key: "Enter", run: toggleTaskAtCaret },
  { key: "ArrowDown", run: lineDown },
  { key: "ArrowUp", run: lineUp },
  { mac: "Ctrl-n", run: lineDown },
  { mac: "Ctrl-p", run: lineUp },
  { key: "Escape", run: closeFrontmatter },
  { key: "Escape", run: closeOutline },
  { key: "PageDown", run: pageBy(1) },
  { key: "PageUp", run: pageBy(-1) },
  // Space pages as it does in a browser, Shift and Space back (#234). Find's field is not the page.
  { key: "Space", run: pageBy(1), shift: pageBy(-1) },
  // As in a browser (#235). On macOS, Alt and an arrow moves by words.
  { key: "Alt-ArrowLeft", mac: "Mod-[", run: goBack },
  { key: "Alt-ArrowRight", mac: "Mod-]", run: goForward },
  // Selecting every match, or the next beside the selection, takes more than one selection,
  // which the page does not allow. It kept only one, and said nothing (#202).
  ...searchKeymap.filter(
    ({ run }) => run !== selectSelectionMatches && run !== selectNextOccurrence,
  ),
  ...standardKeymap,
];

/**
 * Find's fields hold search terms, not prose, so WebKit corrects nothing in them. On macOS it
 * offered "Word" for `word` (#188). CodeMirror makes the panel afresh each time it opens.
 */
const plainFindFields = EditorView.updateListener.of((update) => {
  if (!searchPanelOpen(update.state) || searchPanelOpen(update.startState)) return;
  const fields = update.view.dom.querySelectorAll<HTMLInputElement>(".cm-search .cm-textfield");
  for (const field of fields) {
    field.spellcheck = false;
    field.setAttribute("autocorrect", "off");
    field.setAttribute("autocapitalize", "off");
  }
});

/**
 * docs/hld.md milestone one: the editor surface, with editing commands disabled. The caret
 * and the selection stay, so a reader can open the syntax under them, copy, and find.
 */
export function createSurface(
  parent: HTMLElement,
  text: string,
  options: SurfaceOptions,
): EditorView {
  const state = EditorState.create({
    doc: text,
    extensions: [
      markdown,
      page,
      textDirection,
      completeParse,
      pageTheme,
      clickPastLineEnd,
      modClickOpens,
      summaryToggles,
      frontmatter,
      outlineOpen,
      options.openLink ? linkOpener.of(options.openLink) : [],
      options.openFile ? fileOpener.of(options.openFile) : [],
      options.linkRefused ? linkRefused.of(options.linkRefused) : [],
      assetUrl.of(options.assets),
      options.imageRefusal ? imageRefusal.of(options.imageRefusal) : [],
      options.diagramFrame ? diagramFrame.of(options.diagramFrame) : [],
      EditorState.readOnly.of(true),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ "aria-label": "Document", spellcheck: "false" }),
      search({ top: true }),
      plainFindFields,
      findExtras,
      keymap.of(pageKeys),
      options.nonce ? EditorView.cspNonce.of(options.nonce) : [],
      options.extensions ?? [],
    ],
  });
  // The caret starts after the frontmatter, so the first key does not open it. Placing it is
  // not the reader's selection, so it opens nothing.
  const start = state.update({ selection: { anchor: startOfPage(state) } }).state;
  return new EditorView({ parent, state: start });
}

/** How many lines a save may add or take away before its changes are taken as one stretch. */
const MOST_LINE_EDITS = 500;

/**
 * The changes that turn `old` into `next`, a line at a time: the lines each adds or takes away,
 * as few as it can be said in, so every line they share keeps its place. Past `MOST_LINE_EDITS`
 * it is one change, between the lines they share at each end. None when they are the same.
 */
export function textChanges(old: string, next: string): ChangeSpec[] {
  if (old === next) return [];
  // Each line with its line break, so the lines put back together are the text.
  const a = old.split(/(?<=\n)/);
  const b = next.split(/(?<=\n)/);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1;
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail += 1;
  }
  const at = [0];
  for (const line of a) at.push(at[at.length - 1] + line.length);
  const runs = lineEdits(
    a.slice(head, a.length - tail),
    b.slice(head, b.length - tail),
    MOST_LINE_EDITS,
  ) ?? [[0, a.length - tail - head, 0, b.length - tail - head]];
  return runs.map(([fromA, toA, fromB, toB]) => ({
    from: at[head + fromA],
    to: at[head + toA],
    insert: b.slice(head + fromB, head + toB).join(""),
  }));
}

/** A run of lines that differ: `[from, to)` in the old beside `[from, to)` in the new. */
type Run = [number, number, number, number];

/**
 * Myers's diff: the runs of lines that differ, as `[from, to)` in `a` beside `[from, to)` in `b`,
 * by the fewest lines added and taken away, or null when it takes more than `most`.
 */
function lineEdits(a: string[], b: string[], most: number): Run[] | null {
  const max = Math.min(a.length + b.length, most);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = -1;
  search: for (let d = 0; d <= max; d += 1) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      const down = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]);
      let x = down ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < a.length && y < b.length && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      v[offset + k] = x;
      if (x >= a.length && y >= b.length) {
        found = d;
        break search;
      }
    }
  }
  if (found < 0) return null;
  // Back from the end, the lines both keep, which the runs fall between.
  const kept: [number, number][] = [];
  let x = a.length;
  let y = b.length;
  for (let d = found; d > 0; d -= 1) {
    const before = trace[d];
    const k = x - y;
    const down = k === -d || (k !== d && before[offset + k - 1] < before[offset + k + 1]);
    const fromK = down ? k + 1 : k - 1;
    const fromX = before[offset + fromK];
    const fromY = fromX - fromK;
    // One line added, down, or taken away, across, and then the lines both keep, diagonally.
    const afterX = down ? fromX : fromX + 1;
    while (x > afterX) {
      x -= 1;
      y -= 1;
      kept.push([x, y]);
    }
    x = fromX;
    y = fromY;
  }
  while (x > 0 && y > 0) {
    x -= 1;
    y -= 1;
    kept.push([x, y]);
  }
  const runs: Run[] = [];
  let nextA = 0;
  let nextB = 0;
  for (const [keptA, keptB] of kept.reverse()) {
    if (keptA > nextA || keptB > nextB) runs.push([nextA, keptA, nextB, keptB]);
    nextA = keptA + 1;
    nextB = keptB + 1;
  }
  if (nextA < a.length || nextB < b.length) runs.push([nextA, a.length, nextB, b.length]);
  return runs;
}

/**
 * #199: the page takes its file's new text, changing only the lines that differ, so the caret,
 * the scroll, and what the reader opened stay put in the rest. CodeMirror keeps its lines with
 * `\n`, so the file's line endings are read as it reads them first.
 */
export function takeText(view: EditorView, text: string): void {
  const changes = textChanges(view.state.doc.toString(), text.replace(/\r\n?/g, "\n"));
  if (changes.length > 0) view.dispatch({ changes });
}

/** How long print waits for the HTML blocks to load, so one that never loads cannot hold it up. */
const FRAME_WAIT = 3000;

/**
 * Prints the page as it reads, docs/hld.md §7: every line drawn, every `<details>` open, those in
 * HTML blocks too, and no syntax or address open under the selection, which are for the screen.
 * Each `<details>` goes back as the reader left it after. `print` opens the print panel: the
 * page's own, or Rust's on macOS, where WKWebView ignores `window.print()` (#191).
 */
export async function printPage(
  view: EditorView,
  print: () => unknown = () => window.print(),
): Promise<void> {
  finishParse(view);
  view.dispatch({ effects: [foldAll.of(null), printing.of(true), showFrameLink.of(null)] });
  // CodeMirror draws every line once print has begun, too late for an HTML block drawn then to
  // load before WebKit takes the page. So every line is drawn first, and print waits for them.
  const drawn = drawEveryLine(view, true);
  if (drawn) await framesLoaded(view, FRAME_WAIT);
  printFrames(view, true);
  const after = () => {
    removeEventListener("afterprint", after);
    printFrames(view, false);
    if (drawn) drawEveryLine(view, false);
    view.dispatch({ effects: printing.of(false) });
  };
  addEventListener("afterprint", after);
  try {
    await print();
  } catch (error) {
    // No panel opened, so no afterprint comes. The page goes back now.
    after();
    throw error;
  }
}

/**
 * Sets the flag CodeMirror's own print handler sets to draw every line, not only those near the
 * window. It is internal, so if an upgrade renames it, print goes on as before, with HTML blocks
 * the reader has not reached left blank, and says so in the console.
 */
function drawEveryLine(view: EditorView, on: boolean): boolean {
  const viewState = (view as unknown as { viewState?: { printing?: unknown } }).viewState;
  if (typeof viewState?.printing !== "boolean") {
    console.warn("CodeMirror has no viewState.printing, so print draws only what has been seen.");
    return false;
  }
  viewState.printing = on;
  view.requestMeasure();
  return true;
}
