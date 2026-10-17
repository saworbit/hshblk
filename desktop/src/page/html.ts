import type { Text } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { decodeHTML } from "entities";

/**
 * #200: the inline HTML the page draws, from what GitHub's sanitiser lets through in a README,
 * each as the page's own construct is drawn. Anything else stays as written. None of it becomes
 * HTML: the page reads the tags' source, and a link's address and an image's file go where a
 * markdown link's and image's go.
 */
export type HtmlKind =
  "strong" | "em" | "code" | "kbd" | "sub" | "sup" | "mark" | "a" | "br" | "img";

/** What each tag the page draws is. `<b>` and `<i>` are bold and italic, as `**` and `*` are. */
const KINDS: Readonly<Record<string, HtmlKind>> = {
  b: "strong",
  strong: "strong",
  i: "em",
  em: "em",
  code: "code",
  kbd: "kbd",
  sub: "sub",
  sup: "sup",
  mark: "mark",
  a: "a",
  br: "br",
  img: "img",
};

/** The elements that have no closing tag. */
const VOID = new Set(["br", "img"]);

/** A tag as written: its name in lower case, whether it closes, and its attributes. */
export type Tag = { name: string; closing: boolean; attributes: Map<string, string> };

const TAG = /^<(\/?)([A-Za-z][A-Za-z0-9-]*)(\s[^<>]*?)?\s*\/?>$/s;

/** An attribute's name, and its value quoted either way, or bare. */
const ATTRIBUTE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/** A tag's name, whether it closes, and its attributes, their entities decoded. The first wins. */
export function readTag(source: string): Tag | null {
  const match = TAG.exec(source);
  if (!match) return null;
  const attributes = new Map<string, string>();
  for (const attribute of (match[3] ?? "").matchAll(ATTRIBUTE)) {
    const name = attribute[1].toLowerCase();
    const value = attribute[2] ?? attribute[3] ?? attribute[4] ?? "";
    if (!attributes.has(name)) attributes.set(name, decodeHTML(value));
  }
  return { name: match[2].toLowerCase(), closing: match[1] === "/", attributes };
}

/** A span of the source. */
type Span = { from: number; to: number };

/** An element the page draws: what it is, its attributes, and its tags. A void one has one. */
export type HtmlElement = {
  kind: HtmlKind;
  attributes: ReadonlyMap<string, string>;
  open: Span;
  close: Span | null;
};

/**
 * The elements among a node's children: each `<br>` and `<img>`, and each other opening tag the
 * page draws, paired with the closing tag of its name after it, as tags nest. Tags pair only as
 * siblings, in one paragraph or one construct. One with no partner stays as written, and so does
 * every tag the page does not draw.
 */
export function elementsIn(doc: Text, parent: SyntaxNode): HtmlElement[] {
  const found: HtmlElement[] = [];
  const opened: { tag: Tag; span: Span }[] = [];
  for (let child = parent.firstChild; child; child = child.nextSibling) {
    if (child.name !== "HTMLTag") continue;
    const tag = readTag(doc.sliceString(child.from, child.to));
    const kind = tag && KINDS[tag.name];
    if (!tag || !kind) continue;
    const span = { from: child.from, to: child.to };
    if (VOID.has(tag.name)) {
      if (!tag.closing) found.push({ kind, attributes: tag.attributes, open: span, close: null });
    } else if (!tag.closing) {
      opened.push({ tag, span });
    } else {
      let at = opened.length - 1;
      while (at >= 0 && opened[at].tag.name !== tag.name) at -= 1;
      if (at < 0) continue;
      // What opened inside it and never closed is left as written.
      const [{ tag: opening, span: open }] = opened.splice(at);
      found.push({ kind, attributes: opening.attributes, open, close: span });
    }
  }
  return found.sort((a, b) => a.open.from - b.open.from);
}

/** An image's width or height as GitHub takes one: pixels, or a percentage. */
const LENGTH = /^\s*(\d+(?:\.\d+)?)(%|px)?\s*$/i;

/** An `<img>`'s width and height, where it gives them, as CSS lengths. */
export function sizeOf(attributes: ReadonlyMap<string, string>): ImageSize | undefined {
  const length = (name: string) => {
    const match = LENGTH.exec(attributes.get(name) ?? "");
    return match ? `${match[1]}${match[2] === "%" ? "%" : "px"}` : undefined;
  };
  const width = length("width");
  const height = length("height");
  if (!width && !height) return undefined;
  return { ...(width ? { width } : {}), ...(height ? { height } : {}) };
}

/** The size an `<img>` asks for. */
export type ImageSize = { width?: string; height?: string };
