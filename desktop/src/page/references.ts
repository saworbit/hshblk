import type { Text } from "@codemirror/state";
import type { SyntaxNode, Tree } from "@lezer/common";
import { decodeHTML } from "entities";

/** Link reference definitions, by label. The first definition of a label wins. */
export type Definitions = Map<string, string>;

export function definitionsIn(doc: Text, tree: Tree): Definitions {
  const definitions: Definitions = new Map();
  tree.iterate({
    enter(ref) {
      if (ref.name !== "LinkReference") return;
      const label = ref.node.getChild("LinkLabel");
      const url = ref.node.getChild("URL");
      const name = label ? normalize(doc.sliceString(label.from + 1, label.to - 1)) : "";
      if (name && !definitions.has(name)) {
        definitions.set(name, url ? unwrap(doc.sliceString(url.from, url.to)) : "");
      }
      return false;
    },
  });
  return definitions;
}

/**
 * Where a Link or Image points: the parentheses after it, or the definition it names.
 * Null is a reference with no definition, which is not a link at all.
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
