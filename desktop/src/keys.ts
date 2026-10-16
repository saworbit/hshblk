import { type Extension, type StateCommand, StateEffect, StateField } from "@codemirror/state";
import { type EditorView, type Panel, showPanel } from "@codemirror/view";
import { element } from "./page/dom.ts";

/** A row of the README's key table: the keys, as this system writes them, and what they do. */
export type KeyRow = { keys: string; does: string };

/**
 * #239: the app's keys, read from the README's key table, so the two say the same. A row names
 * Ctrl, and ⌘ in brackets after it when macOS differs: `Ctrl+O` (`⌘O`). macOS takes the ⌘ form.
 */
export function keyRows(readme: string, mac: boolean): KeyRow[] {
  const lines = readme.split(/\r?\n/);
  const head = lines.findIndex((line) => /^\|\s*Key\s*\|\s*Does\s*\|/.test(line));
  if (head < 0) return [];
  const rows: KeyRow[] = [];
  // After the header and its delimiter row, to the table's end.
  for (const line of lines.slice(head + 2)) {
    if (!line.startsWith("|")) break;
    const [keys = "", does = ""] = line.split("|").slice(1, -1);
    const forms = /^(.*?)\s*\((.*⌘.*)\)\s*$/.exec(keys.trim());
    rows.push({ keys: plain(forms ? forms[mac ? 2 : 1] : keys), does: plain(does) });
  }
  return rows;
}

/** A cell's words, without code marks or links' addresses. */
function plain(cell: string): string {
  return cell
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`/g, "")
    .trim();
}

/** The keys as a list, for the panel and the welcome window. */
export function keyList(rows: KeyRow[]): HTMLElement {
  const list = element("dl", "keys-list");
  for (const { keys, does } of rows) {
    list.append(element("dt", "", keys), element("dd", "", does));
  }
  return list;
}

const setKeys = StateEffect.define<boolean>();

const keysShown = StateField.define<boolean>({
  create: () => false,
  update: (shown, tr) => tr.effects.reduce((v, e) => (e.is(setKeys) ? e.value : v), shown),
});

/** F1 or Ctrl+? (⌘? on macOS): shows the keys, or hides them again. */
export const toggleKeys: StateCommand = ({ state, dispatch }) => {
  dispatch(state.update({ effects: setKeys.of(!state.field(keysShown)) }));
  return true;
};

/** Escape hides the keys. With them hidden, Escape is left to the next binding. */
export const closeKeys: StateCommand = ({ state, dispatch }) => {
  if (!state.field(keysShown)) return false;
  dispatch(state.update({ effects: setKeys.of(false) }));
  return true;
};

/** Whether the keys show. */
export function keysOpen(view: EditorView): boolean {
  return view.state.field(keysShown);
}

/** The panel that lists the keys, below the page, as the find box is above it. */
export function keysPanel(rows: KeyRow[]): Extension {
  const panel = (view: EditorView): Panel => {
    const dom = element("div", "keys-panel");
    dom.setAttribute("role", "region");
    dom.setAttribute("aria-label", "Keys");
    const close = element("button", "keys-close", "×");
    close.setAttribute("type", "button");
    close.setAttribute("aria-label", "Close");
    close.addEventListener("click", () => {
      closeKeys(view);
      view.focus();
    });
    dom.append(element("div", "keys-head", [element("span", "keys-title", "Keys"), close]));
    dom.append(keyList(rows));
    return { dom, top: false };
  };
  return [keysShown, showPanel.from(keysShown, (shown) => (shown ? panel : null))];
}
