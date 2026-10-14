import { standardKeymap } from "@codemirror/commands";
import { search, searchKeymap, searchPanelOpen } from "@codemirror/search";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, type KeyBinding, keymap } from "@codemirror/view";
import { assetUrl, type AssetUrl } from "./page/assets.ts";
import { completeParse, finishParse } from "./page/complete.ts";
import { markdown } from "./page/dialect.ts";
import { closeFrontmatter, frontmatter } from "./page/frontmatter.ts";
import {
  cursorLineOnto,
  foldAll,
  page,
  printing,
  startOfPage,
  toggleDetailsAtCaret,
  toggleTaskAtCaret,
} from "./page/page.ts";
import { linkOpener, modClickOpens, showFrameLink } from "./page/links.ts";
import { clickPastLineEnd } from "./page/pointer.ts";
import { pageTheme } from "./page/theme.ts";
import { framesLoaded, printFrames, summaryToggles } from "./page/widgets.ts";

export type SurfaceOptions = {
  assets: AssetUrl;
  /** Where a link goes when the reader opens it. Without one, links only show their address. */
  openLink?: (href: string) => void;
  /** The CSP nonce CodeMirror puts on the styles it injects. */
  nonce?: string;
  /** Anything the shell adds: its own keys, its own handlers. */
  extensions?: Extension;
};

const lineDown = cursorLineOnto(true);
const lineUp = cursorLineOnto(false);

/**
 * Movement and selection. The state is read-only, so the editing commands here do nothing.
 * Enter on a <details>'s tags opens or closes it, and in a task item's text ticks or unticks its
 * box. Escape closes the frontmatter panel. Up and Down stop on a drawn block, and so do Ctrl+N
 * and Ctrl+P, which CodeMirror binds to them on macOS.
 */
export const pageKeys: readonly KeyBinding[] = [
  { key: "Enter", run: toggleDetailsAtCaret },
  { key: "Enter", run: toggleTaskAtCaret },
  { key: "ArrowDown", run: lineDown },
  { key: "ArrowUp", run: lineUp },
  { mac: "Ctrl-n", run: lineDown },
  { mac: "Ctrl-p", run: lineUp },
  { key: "Escape", run: closeFrontmatter },
  ...searchKeymap,
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
      completeParse,
      pageTheme,
      clickPastLineEnd,
      modClickOpens,
      summaryToggles,
      frontmatter,
      options.openLink ? linkOpener.of(options.openLink) : [],
      assetUrl.of(options.assets),
      EditorState.readOnly.of(true),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ "aria-label": "Document", spellcheck: "false" }),
      search({ top: true }),
      plainFindFields,
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
