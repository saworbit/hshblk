import { type EditorState, Facet, type Text } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { decodeHTML } from "entities";

/** Link reference definitions, by label. The first definition of a label wins. */
export type Definitions = Map<string, string>;

/** Adds a definition, a LinkReference node, unless its label is already defined. */
export function define(definitions: Definitions, doc: Text, node: SyntaxNode): void {
  const label = node.getChild("LinkLabel");
  const url = node.getChild("URL");
  const name = label ? normalize(doc.sliceString(label.from + 1, label.to - 1)) : "";
  if (name && !definitions.has(name)) {
    definitions.set(name, url ? unwrap(doc.sliceString(url.from, url.to)) : "");
  }
}

/**
 * Where a Link or Image points: the parentheses after it, or the definition it names, with its
 * escapes and entities resolved. Null is a reference with no definition, which is not a link.
 */
export function destination(doc: Text, node: SyntaxNode, definitions: Definitions): string | null {
  const marks = node.getChildren("LinkMark");
  if (marks.some((mark) => doc.sliceString(mark.from, mark.to) === "(")) {
    const url = node.getChild("URL");
    return url ? unwrap(doc.sliceString(url.from, url.to)) : "";
  }
  // `[text][label]` names its definition. `[text][]` and `[text]` are named by their text.
  const [open, close] = marks;
  const reference = node.getChild("LinkLabel");
  const label =
    reference && reference.to - reference.from > 2
      ? doc.sliceString(reference.from + 1, reference.to - 1)
      : doc.sliceString(open.to, close.from);
  return definitions.get(normalize(label)) ?? null;
}

/** An autolink's address. An email autolink's is `mailto:` and the address, as CommonMark says. */
export function autolinkHref(address: string): string {
  return !address.includes(":") && address.includes("@") ? `mailto:${address}` : address;
}

/** The document's headings, by the anchor GitHub gives each, to where each starts. */
export const headings = Facet.define<ReadonlyMap<string, number>, ReadonlyMap<string, number>>({
  combine: (values) => values[0] ?? new Map(),
});

/**
 * The anchor GitHub gives a heading, since READMEs link to it: lower case, punctuation dropped,
 * and each space a `-`. A repeat takes `-1`, `-2`, and on, as `taken` says.
 */
export function anchorOf(words: string, taken: { has(anchor: string): boolean }): string {
  const base = words
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
    .replace(/ /g, "-");
  let anchor = base;
  for (let n = 1; taken.has(anchor); n += 1) anchor = `${base}-${n}`;
  return anchor;
}

/** Where the heading a `#fragment` names starts, if it names one in this document. */
export function headingAt(state: EditorState, href: string): number | undefined {
  if (!href.startsWith("#") || href.length < 2) return undefined;
  let name = href.slice(1);
  try {
    name = decodeURIComponent(name);
  } catch {
    // A stray `%` escapes nothing. The fragment is the name as written.
  }
  return state.facet(headings).get(name);
}

/** CommonMark label matching: case-folded, with any run of whitespace as one space. */
export function normalize(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase().toUpperCase();
}

/** A backslash escape of ASCII punctuation, or an entity with its semicolon. */
const ESCAPED =
  /\\([!-/:-@[-`{-~])|&(?:#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]{1,31});/g;

/**
 * A destination written as `<...>` may hold spaces. The angle brackets are not the address, and
 * its escapes and entities stand for the characters they name. Percent escapes stay: it is a URL.
 */
function unwrap(url: string): string {
  const bare = url.startsWith("<") && url.endsWith(">") ? url.slice(1, -1) : url;
  return bare.replace(ESCAPED, (match, escaped?: string) => escaped ?? decodeHTML(match));
}
