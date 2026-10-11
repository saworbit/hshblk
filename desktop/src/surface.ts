import { standardKeymap } from "@codemirror/commands";
import { search, searchKeymap } from "@codemirror/search";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { assetUrl, type AssetUrl } from "./page/assets.ts";
import { completeParse, finishParse } from "./page/complete.ts";
import { markdown } from "./page/dialect.ts";
import { foldAll, page } from "./page/page.ts";
import { linkOpener, modClickOpens } from "./page/links.ts";
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
        // Movement and selection. The state is read-only, so the editing commands here do nothing.
        keymap.of([...searchKeymap, ...standardKeymap]),
        options.nonce ? EditorView.cspNonce.of(options.nonce) : [],
        options.extensions ?? [],
      ],
    }),
  });
}

/**
 * Prints the page as it reads, docs/hld.md §7: every line drawn, and no syntax open under the
 * selection, which is for the screen.
 */
export function printPage(view: EditorView): void {
  finishParse(view);
  view.dispatch({ effects: foldAll.of(null) });
  print();
}
