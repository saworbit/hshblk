import { type EditorState, type StateCommand, StateEffect, StateField } from "@codemirror/state";
import { type EditorView, type Panel, showPanel, type ViewUpdate } from "@codemirror/view";
import type { Heading } from "./blocks.ts";
import { element } from "./dom.ts";
import { jumpTo, placeOf } from "./links.ts";
import { page } from "./page.ts";

const setOutline = StateEffect.define<boolean>();

/**
 * #236: the outline of the document's headings, a panel above the page, as the frontmatter's is.
 * It lists every heading by level, marks the one the window is in, and goes to one on a click or
 * Enter, which Alt+Left comes back from. It is the page's headings for a screen reader too, which
 * meets only the lines CodeMirror has drawn (#157).
 */
export const outlineOpen = StateField.define<boolean>({
  create: () => false,
  update: (open, tr) => tr.effects.reduce((v, e) => (e.is(setOutline) ? e.value : v), open),
  provide: (field) => showPanel.from(field, (open) => (open ? panel : null)),
});

/** The document's headings, in order. */
export function outlineOf(state: EditorState): readonly Heading[] {
  return state.field(page).blocks.outline;
}

/** Ctrl+Shift+O (⌘⇧O): opens or closes the outline. A file with no heading has none. */
export const toggleOutline: StateCommand = ({ state, dispatch }) => {
  const open = state.field(outlineOpen);
  if (!open && outlineOf(state).length === 0) return false;
  dispatch(state.update({ effects: setOutline.of(!open) }));
  return true;
};

/** Escape closes the outline. With it closed, Escape is left to the next binding. */
export const closeOutline: StateCommand = ({ state, dispatch }) => {
  if (!state.field(outlineOpen)) return false;
  dispatch(state.update({ effects: setOutline.of(false) }));
  return true;
};

/** The heading a place is under: the last that starts at or before it, or -1 before the first. */
export function headingOver(outline: readonly Heading[], pos: number): number {
  let low = 0;
  for (let high = outline.length; low < high;) {
    const middle = (low + high) >> 1;
    if (outline[middle].from <= pos) low = middle + 1;
    else high = middle;
  }
  return low - 1;
}

/** Where the reader is: the caret, and the first and last lines in the window. */
type Place = { caret: number; top: number; bottom: number };

/**
 * The heading the reader is in: the one the caret is under while the caret is in the window, and
 * otherwise the one the window's top line is under. Near a file's end the window cannot bring a
 * heading gone to up to its top, so its top line is still in the section above (#286).
 */
export function markedHeading(outline: readonly Heading[], { caret, top, bottom }: Place): number {
  return headingOver(outline, top <= caret && caret <= bottom ? caret : top);
}

function placeIn(view: EditorView): Place {
  const { top, bottom } = view.scrollDOM.getBoundingClientRect();
  const line = (y: number) => view.lineBlockAtHeight(Math.max(y - view.documentTop, 0));
  return { caret: view.state.selection.main.head, top: line(top).from, bottom: line(bottom).to };
}

function panel(view: EditorView): Panel {
  const dom = element("nav", "pg-outline");
  dom.setAttribute("aria-label", "Outline");
  const close = element("button", "pg-outline-close", "×");
  close.setAttribute("type", "button");
  close.setAttribute("aria-label", "Close");
  close.addEventListener("click", () => {
    closeOutline(view);
    view.focus();
  });
  const list = element("ol", "pg-outline-list");
  const title = element("span", "pg-outline-title", "Outline");
  dom.append(element("div", "pg-outline-head", [title, close]));
  dom.append(list);
  dom.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    closeOutline(view);
    view.focus();
  });

  /** Each heading, a button that goes to it. */
  const render = () => {
    const entries = outlineOf(view.state).map(({ from, level, words }) => {
      const go = element("button", "", words || "Untitled");
      go.setAttribute("type", "button");
      go.addEventListener("click", () => {
        view.dispatch(jumpTo(view.state, placeOf(view), from));
        view.focus();
      });
      return element("li", `pg-outline-${level}`, [go]);
    });
    list.replaceChildren(...entries);
    mark();
  };

  /**
   * Marks the heading the reader is in, as the current place. The window is read when the view
   * next measures, since it may not be read while CodeMirror updates.
   */
  const mark = () =>
    view.requestMeasure({
      key: list,
      read: () => markedHeading(outlineOf(view.state), placeIn(view)),
      write: (current) => {
        [...list.children].forEach((entry, i) => {
          const go = entry.firstElementChild!;
          if (i === current) go.setAttribute("aria-current", "location");
          else go.removeAttribute("aria-current");
        });
      },
    });
  // A scroll short of the viewport's edge changes no viewport, so the page's own scroll marks too.
  view.scrollDOM.addEventListener("scroll", mark, { passive: true });

  render();
  return {
    dom,
    top: true,
    // Opened from the keys, the outline takes them, on the heading the reader is in.
    mount() {
      const index = headingOver(outlineOf(view.state), view.state.selection.main.head);
      const current = list.children[Math.max(index, 0)]?.firstElementChild as HTMLElement | null;
      current?.scrollIntoView({ block: "nearest" });
      current?.focus();
    },
    update(update: ViewUpdate) {
      if (outlineOf(update.state) !== outlineOf(update.startState)) render();
      else if (
        update.viewportChanged ||
        update.geometryChanged ||
        update.docChanged ||
        update.selectionSet
      )
        mark();
    },
    destroy() {
      view.scrollDOM.removeEventListener("scroll", mark);
    },
  };
}
