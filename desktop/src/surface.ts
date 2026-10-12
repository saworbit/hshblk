import { standardKeymap } from "@codemirror/commands";
import { search, searchKeymap } from "@codemirror/search";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, type KeyBinding, keymap } from "@codemirror/view";
import { assetUrl, type AssetUrl } from "./page/assets.ts";
import { completeParse, finishParse } from "./page/complete.ts";
import { markdown } from "./page/dialect.ts";
import {
  cursorLineOnto,
  foldAll,
  page,
  printing,
  toggleDetailsAtCaret,
  toggleTaskAtCaret,
} from "./page/page.ts";
import { linkOpener, modClickOpens, showFrameLink } from "./page/links.ts";
import { clickPastLineEnd } from "./page/pointer.ts";
import { pageTheme } from "./page/theme.ts";
import { summaryToggles } from "./page/widgets.ts";

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
 * box. Up and Down stop on a drawn block, and so do Ctrl+N and Ctrl+P, which CodeMirror binds to
 * them on macOS.
 */
export const pageKeys: readonly KeyBinding[] = [
  { key: "Enter", run: toggleDetailsAtCaret },
  { key: "Enter", run: toggleTaskAtCaret },
  { key: "ArrowDown", run: lineDown },
  { key: "ArrowUp", run: lineUp },
  { mac: "Ctrl-n", run: lineDown },
  { mac: "Ctrl-p", run: lineUp },
  ...searchKeymap,
  ...standardKeymap,
];

/**
 * docs/hld.md milestone one: the editor surface, with editing commands disabled. The caret
 * and the selection stay, so a reader can open the syntax under them, copy, and find.
 */
export function createSurface(
  parent: HTMLElement,
  text: string,
  options: SurfaceOptions,
): EditorView {
  return new EditorView({
    parent,
    state: EditorState.create({
      doc: text,
      extensions: [
        markdown,
        page,
        completeParse,
        pageTheme,
        clickPastLineEnd,
        modClickOpens,
        summaryToggles,
        options.openLink ? linkOpener.of(options.openLink) : [],
        assetUrl.of(options.assets),
        EditorState.readOnly.of(true),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ "aria-label": "Document", spellcheck: "false" }),
        search({ top: true }),
        keymap.of(pageKeys),
        options.nonce ? EditorView.cspNonce.of(options.nonce) : [],
        options.extensions ?? [],
      ],
    }),
  });
}

/**
 * Prints the page as it reads, docs/hld.md §7: every line drawn, every `<details>` open, and no
 * syntax or address open under the selection, which are for the screen.
 */
export function printPage(view: EditorView): void {
  finishParse(view);
  view.dispatch({ effects: [foldAll.of(null), printing.of(true), showFrameLink.of(null)] });
  addEventListener("afterprint", () => view.dispatch({ effects: printing.of(false) }), {
    once: true,
  });
  print();
}
