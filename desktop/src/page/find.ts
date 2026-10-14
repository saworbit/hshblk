import { getSearchQuery, searchPanelOpen, setSearchQuery } from "@codemirror/search";
import { EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

/** How many matches find counts before it says only that there are more. */
export const COUNT_LIMIT = 1000;

/** How many matches a search has, as far as the limit, and which one the selection is on. */
export type Count = { current: number; total: number; more: boolean };

/** The search's matches, counted, or null when there is no search to count. */
export function matchCount(state: EditorState, limit = COUNT_LIMIT): Count | null {
  const query = getSearchQuery(state);
  if (!query.valid) return null;
  const { from, to } = state.selection.main;
  const cursor = query.getCursor(state);
  let total = 0;
  let current = 0;
  for (let next = cursor.next(); !next.done; next = cursor.next()) {
    if (total === limit) return { current, total, more: true };
    total += 1;
    if (next.value.from === from && next.value.to === to) current = total;
  }
  return { current, total, more: false };
}

/** What the find box says of a count. */
export function countText(count: Count | null): string {
  if (!count) return "";
  if (count.total === 0) return "No matches";
  const total = `${count.total}${count.more ? "+" : ""}`;
  if (count.current) return `${count.current} of ${total}`;
  return total === "1" ? "1 match" : `${total} matches`;
}

/**
 * #203: the find box says how many matches there are, and which one the selection is on, and a
 * screen reader hears it. CodeMirror makes the panel afresh each time it opens, after the plugins
 * have seen the update, so the count goes in when the view next writes to the page.
 */
const findCount = ViewPlugin.fromClass(
  class {
    readonly view: EditorView;

    constructor(view: EditorView) {
      this.view = view;
    }

    update(update: ViewUpdate) {
      const opened = searchPanelOpen(update.state) && !searchPanelOpen(update.startState);
      const searched = update.transactions.some((tr) =>
        tr.effects.some((effect) => effect.is(setSearchQuery)),
      );
      if (!opened && !searched && !update.selectionSet) return;
      this.view.requestMeasure({ key: this, read: () => null, write: () => this.show() });
    }

    show() {
      const panel = this.view.dom.querySelector(".cm-search");
      if (!panel) return;
      let said = panel.querySelector<HTMLElement>(".pg-find-count");
      if (!said) {
        said = document.createElement("span");
        said.className = "pg-find-count";
        said.setAttribute("aria-live", "polite");
        const close = panel.querySelector("button[name=close]");
        if (close) close.before(said);
        else panel.append(said);
      }
      said.textContent = countText(matchCount(this.view.state));
    }
  },
);

/**
 * #203: a search with no match leaves no old match selected, so the page does not look as if the
 * new words were found where the old ones were.
 */
const dropStaleMatch = EditorState.transactionFilter.of((tr) => {
  const query = tr.effects.find((effect) => effect.is(setSearchQuery))?.value;
  if (!query?.valid || tr.newSelection.main.empty) return tr;
  if (!query.getCursor(tr.startState.doc).next().done) return tr;
  return [tr, { selection: EditorSelection.cursor(tr.newSelection.main.head), sequential: true }];
});

/** The find box's count, and its care for a search that finds nothing. */
export const findExtras: Extension = [findCount, dropStaleMatch];
