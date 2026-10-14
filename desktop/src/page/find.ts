import {
  getSearchQuery,
  type SearchQuery,
  searchPanelOpen,
  setSearchQuery,
} from "@codemirror/search";
import { EditorSelection, EditorState, type Extension, type Text } from "@codemirror/state";
import { type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

/** How many matches find counts before it says only that there are more. */
export const COUNT_LIMIT = 1000;

/** How many matches a search has, as far as the limit, and which one the selection is on. */
export type Count = { current: number; total: number; more: boolean };

/**
 * Past this many characters find does not count, since one pass is the whole text: half a second
 * at 8 MB, for each word typed (#263).
 */
export const COUNT_TEXT_LIMIT = 1_000_000;

/** A search's matches in a text, where each starts and ends, as far as the limit. */
type Matches = { query: SearchQuery; limit: number; from: number[]; to: number[]; more: boolean };

/** The matches last found in each text, so a selection that moves does not walk it again. */
const found = new WeakMap<Text, Matches>();

function matchesOf(state: EditorState, query: SearchQuery, limit: number): Matches {
  const known = found.get(state.doc);
  if (known && known.limit === limit && known.query.eq(query)) return known;
  const matches: Matches = { query, limit, from: [], to: [], more: false };
  const cursor = query.getCursor(state);
  for (let next = cursor.next(); !next.done; next = cursor.next()) {
    if (matches.from.length === limit) {
      matches.more = true;
      break;
    }
    matches.from.push(next.value.from);
    matches.to.push(next.value.to);
  }
  found.set(state.doc, matches);
  return matches;
}

/**
 * The search's matches, counted, or null when there is no search to count, or the text is too
 * long to count at once. The count is made once a search and a text. Which match the selection is
 * on is found among them, by halves.
 */
export function matchCount(state: EditorState, limit = COUNT_LIMIT): Count | null {
  const query = getSearchQuery(state);
  if (!query.valid || state.doc.length > COUNT_TEXT_LIMIT) return null;
  const matches = matchesOf(state, query, limit);
  const { from, to } = state.selection.main;
  let low = 0;
  for (let high = matches.from.length; low < high;) {
    const middle = (low + high) >> 1;
    if (matches.from[middle] < from) low = middle + 1;
    else high = middle;
  }
  const on = matches.from[low] === from && matches.to[low] === to;
  return { current: on ? low + 1 : 0, total: matches.from.length, more: matches.more };
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
  // A text too long to count is not walked for each word typed either (#263).
  if (tr.startState.doc.length > COUNT_TEXT_LIMIT) return tr;
  if (matchesOf(tr.startState, query, COUNT_LIMIT).from.length > 0) return tr;
  return [tr, { selection: EditorSelection.cursor(tr.newSelection.main.head), sequential: true }];
});

/** The find box's count, and its care for a search that finds nothing. */
export const findExtras: Extension = [findCount, dropStaleMatch];
