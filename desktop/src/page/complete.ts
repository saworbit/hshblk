import { syntaxTree } from "@codemirror/language";
import { type EditorState, StateEffect, StateField } from "@codemirror/state";
import { type EditorView, ViewPlugin } from "@codemirror/view";
import type { PartialParse, Tree } from "@lezer/common";
import { type Blocks, scan } from "./blocks.ts";
import { markdown } from "./dialect.ts";

/** How long one slice of parsing may hold the window, in milliseconds. */
const SLICE = 40;

/** The performance mark set when the page has its whole tree. docs/hld.md §8, item 3. */
export const PARSED = "page-parsed";

/** The whole document's tree, and its blocks read from it. */
type Whole = { tree: Tree; blocks: Blocks };

const finished = StateEffect.define<Whole>();

const whole = StateField.define<Whole | null>({
  create: () => null,
  update: (value, tr) => tr.effects.find((effect) => effect.is(finished))?.value ?? value,
});

/**
 * The tree the page is drawn from: the whole document's once it is parsed, and until then
 * CodeMirror's, which goes only as far as the reader has scrolled and a little beyond.
 */
export function pageTree(state: EditorState): Tree {
  return state.field(whole, false)?.tree ?? syntaxTree(state);
}

/** The whole document's blocks, once it is parsed and they are read. */
export function wholeBlocks(state: EditorState): Blocks | null {
  return state.field(whole, false)?.blocks ?? null;
}

/**
 * The page needs every line: a definition at the end of a file names links at the top, and
 * print paints it all. This parses the document between events, in a parse of its own, so
 * CodeMirror's parse near the viewport never cuts it short, then reads its blocks the same way.
 * The surface is read-only, so the tree it finishes stays true.
 */
const parser = ViewPlugin.fromClass(
  class {
    readonly view: EditorView;
    #parse: PartialParse | null = null;
    #scan: { tree: Tree; steps: Generator<void, Blocks, void> } | null = null;
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

    /** Parses and scans what is left now, however long it takes. */
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

    /** Advances the parse, then the scan, for up to `budget` milliseconds. True once both are done. */
    #work(budget: number): boolean {
      const end = performance.now() + budget;
      if (this.#parse) {
        let tree = this.#parse.advance();
        while (!tree && performance.now() < end) tree = this.#parse.advance();
        if (!tree) return false;
        this.#parse = null;
        this.#scan = { tree, steps: scan(this.view.state.doc, tree) };
      }
      if (!this.#scan) return true;
      const { tree, steps } = this.#scan;
      let step = steps.next();
      while (!step.done && performance.now() < end) step = steps.next();
      if (!step.done) return false;
      this.#scan = null;
      clearTimeout(this.#timer);
      this.view.dispatch({ effects: finished.of({ tree, blocks: step.value }) });
      performance.mark(PARSED);
      return true;
    }
  },
);

export const completeParse = [whole, parser];

/** For a command that needs every line drawn, such as print. */
export function finishParse(view: EditorView): void {
  view.plugin(parser)?.finish();
}
