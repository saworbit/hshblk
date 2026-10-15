import {
  type EditorState,
  type Extension,
  type StateCommand,
  StateEffect,
  StateField,
} from "@codemirror/state";
import { type EditorView, type Panel, showPanel, type ViewUpdate } from "@codemirror/view";
import { page } from "./page.ts";
import { element } from "./dom.ts";

/** What the panel shows: whether it is open, and the raw YAML or the fields. */
type Shown = { open: boolean; raw: boolean };

/** A field of the frontmatter, as the panel lists it. A deeper value is its YAML, as a block. */
export type Field = { key: string; value: string; block: boolean };

/** The yaml package, which the panel loads only when it first opens. */
type Yaml = typeof import("yaml");

const setPanel = StateEffect.define<Partial<Shown>>();

/** docs/hld.md §7: the panel that shows the file's frontmatter. It writes nothing. */
export const frontmatterPanel = StateField.define<Shown>({
  create: () => ({ open: false, raw: false }),
  update(shown, tr) {
    for (const effect of tr.effects) if (effect.is(setPanel)) shown = { ...shown, ...effect.value };
    return shown;
  },
  provide: (field) => showPanel.from(field, (shown) => (shown.open ? panel : null)),
});

/** The frontmatter panel and its state, for the surface. */
export const frontmatter: Extension = frontmatterPanel;

/** The frontmatter's YAML or TOML, between its fences, or null when the file has none. */
export function frontmatterText(state: EditorState): string | null {
  const span = state.field(page).blocks.frontmatter;
  if (!span) return null;
  const { doc } = state;
  const first = doc.lineAt(span.from).number + 1;
  const last = doc.lineAt(span.to).number - 1;
  return first > last ? "" : doc.sliceString(doc.line(first).from, doc.line(last).to);
}

/** Opens or closes the panel, Ctrl+Shift+M. A file with no frontmatter has none. */
export const toggleFrontmatter: StateCommand = ({ state, dispatch }) => {
  if (frontmatterText(state) === null) return false;
  const { open } = state.field(frontmatterPanel);
  dispatch(state.update({ effects: setPanel.of({ open: !open }) }));
  return true;
};

/** Closes the panel, from Escape. With it closed, Escape is left to the next binding. */
export const closeFrontmatter: StateCommand = ({ state, dispatch }) => {
  if (!state.field(frontmatterPanel).open) return false;
  dispatch(state.update({ effects: setPanel.of({ open: false }) }));
  return true;
};

/** Switches the panel between the fields and the raw YAML. */
export const toggleRaw: StateCommand = ({ state, dispatch }) => {
  const { open, raw } = state.field(frontmatterPanel);
  if (!open) return false;
  dispatch(state.update({ effects: setPanel.of({ raw: !raw }) }));
  return true;
};

/**
 * The frontmatter's fields, or null when it is not a mapping the panel can list, such as YAML
 * with errors, a list, or one that takes more aliases than the package allows. Then the panel
 * shows it raw. Nothing in it runs: the package reads data, and the panel writes text. Mappings
 * come as maps, which keep the file's order. An object puts a number key first (#208).
 */
export function fields(yaml: Yaml, text: string): Field[] | null {
  let value: unknown;
  try {
    const document = yaml.parseDocument(text);
    if (document.errors.length > 0) return null;
    value = document.toJS({ mapAsMap: true });
  } catch {
    // The package throws past its alias limit, which stops a YAML bomb.
    return null;
  }
  if (value === null || value === undefined) return [];
  if (!(value instanceof Map)) return null;
  return [...value].map(([key, item]) => ({ key: keyOf(yaml, key), ...shown(yaml, item) }));
}

/** A key as the file reads, on one line. A key may be a list or a mapping in YAML. */
function keyOf(yaml: Yaml, key: unknown): string {
  if (key === null || key === undefined) return "";
  if (typeof key !== "object") return String(key);
  return yaml.stringify(key, { collectionStyle: "flow" }).trim();
}

function shown(yaml: Yaml, value: unknown): { value: string; block: boolean } {
  if (value === null || value === undefined) return { value: "", block: false };
  const scalar = (item: unknown) => item === null || typeof item !== "object";
  if (Array.isArray(value) && value.every(scalar)) {
    return { value: value.map((item) => String(item ?? "")).join(", "), block: false };
  }
  if (typeof value === "object") return { value: yaml.stringify(value).trimEnd(), block: true };
  return { value: String(value), block: false };
}

let loading: Promise<Yaml> | null = null;

/** The panel, above the page, as the find box is. */
function panel(view: EditorView): Panel {
  const dom = element("div", "pg-front-panel");
  dom.setAttribute("role", "region");
  dom.setAttribute("aria-label", "Frontmatter");
  const head = element("div", "pg-front-head");
  const title = element("span", "pg-front-title", "Frontmatter");
  const raw = element("button", "pg-front-raw-toggle");
  raw.setAttribute("type", "button");
  raw.addEventListener("click", () => toggleRaw(view));
  const close = element("button", "pg-front-close", "×");
  close.setAttribute("type", "button");
  close.setAttribute("aria-label", "Close");
  close.addEventListener("click", () => {
    closeFrontmatter(view);
    view.focus();
  });
  const body = element("div", "pg-front-body");
  head.append(title, raw, close);
  dom.append(head, body);
  dom.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    closeFrontmatter(view);
    view.focus();
  });

  let yaml: Yaml | null = null;
  const render = (state: EditorState) => {
    const text = frontmatterText(state) ?? "";
    // #209: the bundle has no TOML parser, so TOML shows as written, with no fields.
    const toml = state.field(page).blocks.frontmatter?.format === "toml";
    const listed = yaml && !toml ? fields(yaml, text) : null;
    const asRaw = state.field(frontmatterPanel).raw || (yaml !== null && listed === null);
    raw.textContent = asRaw ? "Fields" : "Raw YAML";
    // Until the package loads, and for YAML it cannot list, there are no fields to switch to.
    raw.hidden = listed === null;
    if (asRaw || !listed) {
      const pre = element("pre", "pg-front-yaml", text);
      body.replaceChildren(pre);
      return;
    }
    const list = element("dl", "pg-front-fields");
    for (const field of listed) {
      list.append(element("dt", "", field.key));
      const value = element("dd", field.block ? "pg-front-block" : "", field.value);
      list.append(value);
    }
    body.replaceChildren(list);
  };
  render(view.state);
  loading ??= import("yaml");
  loading.then(
    (loaded) => {
      yaml = loaded;
      render(view.state);
    },
    (error: unknown) => console.warn(`The frontmatter panel shows the raw YAML: ${error}`),
  );
  return {
    dom,
    top: true,
    update(update: ViewUpdate) {
      const before = update.startState.field(frontmatterPanel);
      if (update.state.field(frontmatterPanel).raw !== before.raw) render(update.state);
    },
  };
}
