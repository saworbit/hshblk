import { syntaxTree } from "@codemirror/language";
import { type EditorState, StateEffect, StateField } from "@codemirror/state";
import { type EditorView, ViewPlugin } from "@codemirror/view";
import type { PartialParse, Tree } from "@lezer/common";
import { markdown } from "./dialect.ts";

/** How long one slice of parsing may hold the window, in milliseconds. */
const SLICE = 40;

/** The performance mark set when the page has its whole tree. docs/hld.md §8, item 3. */
export const PARSED = "page-parsed";

const finished = StateEffect.define<Tree>();

const wholeTree = StateField.define<Tree | null>({
  create: () => null,
  update: (tree, tr) => tr.effects.find((effect) => effect.is(finished))?.value ?? tree,
});

/**
 * The tree the page is drawn from: the whole document's once it is parsed, and until then
 * CodeMirror's, which goes only as far as the reader has scrolled and a little beyond.
 */
export function pageTree(state: EditorState): Tree {
  return state.field(wholeTree, false) ?? syntaxTree(state);
}

/**
 * The page needs every line: a definition at the end of a file names links at the top, and
 * print paints it all. This parses the document between events, in a parse of its own, so
 * CodeMirror's parse near the viewport never cuts it short. The surface is read-only, so the
 * tree it finishes stays true.
 */
const parser = ViewPlugin.fromClass(
  class {
    readonly view: EditorView;
    #parse: PartialParse | null = null;
    #frame = 0;
    #timer: ReturnType<typeof setTimeout> | undefined;

    constructor(view: EditorView) {
      this.view = view;
      if (syntaxTree(view.state).length >= view.state.doc.length) {
        performance.mark(PARSED);
        return;
      }
      this.#parse = markdown.parser.startParse(view.state.doc.toString());
      // The reader sees the page first. The rest is parsed after the frame that shows it.
      this.#frame = requestAnimationFrame(() => this.#next());
    }

    /** Parses what is left now, however long it takes. */
    finish(): void {
      this.#work(Infinity);
    }

    destroy(): void {
      cancelAnimationFrame(this.#frame);
      clearTimeout(this.#timer);
    }

    #next(): void {
      this.#timer = setTimeout(() => {
        if (!this.#work(SLICE)) this.#next();
      });
    }

    /** Advances the parse for up to `budget` milliseconds. True once nothing is left. */
    #work(budget: number): boolean {
      if (!this.#parse) return true;
      const end = performance.now() + budget;
      let tree = this.#parse.advance();
      while (!tree && performance.now() < end) tree = this.#parse.advance();
      if (!tree) return false;
      this.#parse = null;
      clearTimeout(this.#timer);
      this.view.dispatch({ effects: finished.of(tree) });
      performance.mark(PARSED);
      return true;
    }
  },
);

export const completeParse = [wholeTree, parser];

/** For a command that needs every line drawn, such as print. */
export function finishParse(view: EditorView): void {
  view.plugin(parser)?.finish();
}
