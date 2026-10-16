import {
  getSearchQuery,
  type SearchQuery,
  searchPanelOpen,
  setSearchQuery,
} from "@codemirror/search";
import {
  EditorSelection,
  EditorState,
  type Extension,
  StateField,
  type Text,
  type TransactionSpec,
} from "@codemirror/state";
import { type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

/** How many matches find counts before it says only that there are more. */
export const COUNT_LIMIT = 1000;

/**
 * How many matches a search has, as far as the limit, and which one the selection is on. While a
 * long text is still being counted, it is counting.
 */
export type Count = { current: number; total: number; more: boolean; counting: boolean };

/**
 * Past this many characters find counts between events, a slice at a time, since one pass is the
 * whole text: half a second at 8 MB, for each word typed (#263, #269).
 */
export const COUNT_TEXT_LIMIT = 1_000_000;

/** How many characters one slice of a count starts its matches in. */
export const COUNT_SLICE = 1 << 18;

/**
 * How far past its slice a slice reads, to the end of a line, so a match that starts in it and
 * runs on is the match a whole walk finds. The regexp cursor cuts its last line at the range's end.
 */
const SLICE_REACH = 1 << 16;

/**
 * A search's matches in a text, where each starts and ends, as far as the limit, and where the
 * walk goes on from, or null once it has reached the end or the limit.
 */
type Matches = {
  query: SearchQuery;
  limit: number;
  from: number[];
  to: number[];
  more: boolean;
  next: number | null;
};

/** The matches last found in each text, so a selection that moves does not walk it again. */
const found = new WeakMap<Text, Matches>();

function matchesOf(state: EditorState, query: SearchQuery, limit: number): Matches {
  const known = found.get(state.doc);
  if (known && known.limit === limit && known.query.eq(query)) return known;
  const matches: Matches = { query, limit, from: [], to: [], more: false, next: 0 };
  found.set(state.doc, matches);
  return matches;
}

/**
 * Walks on through the text a slice at a time, for `budget` milliseconds and at least one slice.
 * True once the walk is done. Each slice keeps the matches that start in it, and the next starts
 * where the last match ended, as one walk of the whole text would.
 */
function walk(state: EditorState, matches: Matches, budget: number): boolean {
  const { doc } = state;
  const end = performance.now() + budget;
  while (matches.next !== null) {
    const from = matches.next;
    const until = Math.min(doc.length, from + COUNT_SLICE);
    const ahead = Math.min(doc.length, until + SLICE_REACH);
    const reach = Math.min(doc.lineAt(ahead).to, ahead + 16 * SLICE_REACH);
    const cursor = matches.query.getCursor(state, from, reach);
    let next = until;
    for (let step = cursor.next(); !step.done; step = cursor.next()) {
      const match = step.value;
      if (match.from >= until && until < doc.length) break;
      if (matches.from.length === matches.limit) {
        matches.more = true;
        next = doc.length;
        break;
      }
      matches.from.push(match.from);
      matches.to.push(match.to);
      next = Math.max(until, match.to);
    }
    matches.next = next >= doc.length ? null : next;
    if (performance.now() >= end) break;
  }
  return matches.next === null;
}

/**
 * Counts on for up to `budget` milliseconds, a slice at least, the search in the find box. True
 * once it is counted, or when there is nothing to count.
 */
export function countSlice(state: EditorState, budget: number): boolean {
  const query = getSearchQuery(state);
  return !query.valid || walk(state, matchesOf(state, query, COUNT_LIMIT), budget);
}

/**
 * The search's matches, counted, or null when there is no search to count. A short text is
 * counted at once. A long one is counted by `countSlice`, between events, and says it is counting
 * until it is done. The count is made once a search and a text. Which match the selection is on
 * is found among them, by halves.
 */
export function matchCount(state: EditorState, limit = COUNT_LIMIT): Count | null {
  const query = getSearchQuery(state);
  if (!query.valid) return null;
  const matches = matchesOf(state, query, limit);
  if (state.doc.length <= COUNT_TEXT_LIMIT) walk(state, matches, Infinity);
  if (matches.next !== null) {
    return { current: 0, total: matches.from.length, more: matches.more, counting: true };
  }
  const { from, to } = state.selection.main;
  let low = 0;
  for (let high = matches.from.length; low < high;) {
    const middle = (low + high) >> 1;
    if (matches.from[middle] < from) low = middle + 1;
    else high = middle;
  }
  const on = matches.from[low] === from && matches.to[low] === to;
  const current = on ? low + 1 : 0;
  return { current, total: matches.from.length, more: matches.more, counting: false };
}

/** What the find box says of a count. */
export function countText(count: Count | null): string {
  if (!count) return "";
  if (count.counting) return "Counting";
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
    #timer: ReturnType<typeof setTimeout> | undefined;

    constructor(view: EditorView) {
      this.view = view;
    }

    destroy() {
      clearTimeout(this.#timer);
    }

    /**
     * #269: a long text is counted a slice at a time between events, so the window never waits
     * on the whole of it, and the box says so until the count is done.
     */
    #countOn() {
      clearTimeout(this.#timer);
      this.#timer = setTimeout(() => {
        const { state } = this.view;
        if (!searchPanelOpen(state)) return;
        countSlice(state, COUNT_BUDGET);
        const drop = dropWhenCounted(state);
        if (drop) this.view.dispatch(drop);
        this.show();
      });
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
      const count = matchCount(this.view.state);
      said.textContent = countText(count);
      if (count?.counting) this.#countOn();
    }
  },
);

/** How long one slice of a long count may hold the window, in milliseconds. */
const COUNT_BUDGET = 12;

/**
 * The selection a search left in a text too long to check at once, until its count says whether
 * the new words are in the file. The reader moving it, new words, or the file's new text let it
 * go (#199).
 */
const stale = StateField.define<{ query: SearchQuery; head: number; from: number } | null>({
  create: () => null,
  update(value, tr) {
    const query = tr.effects.find((effect) => effect.is(setSearchQuery))?.value;
    const { main } = tr.state.selection;
    if (query) {
      const long = tr.state.doc.length > COUNT_TEXT_LIMIT;
      return query.valid && long && !main.empty ? { query, head: main.head, from: main.from } : null;
    }
    return tr.selection || tr.docChanged ? null : value;
  },
});

/**
 * #269: once a long text is counted and its search has no match, the old match the selection is
 * still on goes, as `dropStaleMatch` does at once in a short text (#203).
 */
export function dropWhenCounted(state: EditorState): TransactionSpec | null {
  const left = state.field(stale, false);
  const count = matchCount(state);
  if (!left || !count || count.counting || count.total > 0) return null;
  if (!left.query.eq(getSearchQuery(state)) || state.selection.main.from !== left.from) return null;
  return { selection: EditorSelection.cursor(left.head) };
}

/**
 * #203: a search with no match leaves no old match selected, so the page does not look as if the
 * new words were found where the old ones were.
 */
const dropStaleMatch = EditorState.transactionFilter.of((tr) => {
  const query = tr.effects.find((effect) => effect.is(setSearchQuery))?.value;
  if (!query?.valid || tr.newSelection.main.empty) return tr;
  // A text too long to count at once is not walked for each word typed either (#263). Its count
  // drops the old match once it is done (#269).
  if (tr.startState.doc.length > COUNT_TEXT_LIMIT) return tr;
  const matches = matchesOf(tr.startState, query, COUNT_LIMIT);
  walk(tr.startState, matches, Infinity);
  if (matches.from.length > 0) return tr;
  return [tr, { selection: EditorSelection.cursor(tr.newSelection.main.head), sequential: true }];
});

/** The find box's count, and its care for a search that finds nothing. */
export const findExtras: Extension = [findCount, dropStaleMatch, stale];
