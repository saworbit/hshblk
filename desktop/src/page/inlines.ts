import type { Text } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { decodeHTML } from "entities";
import { emojiOf } from "./emoji.ts";
import { elementsIn, type HtmlElement, type ImageSize, sizeOf } from "./html.ts";
import {
  autolinkHref,
  bareHref,
  destination,
  isBareAddress,
  titleOf,
  type Definitions,
} from "./references.ts";

/**
 * Inline content as plain data, for the places the page draws instead of decorating the
 * source: table cells, and the words an image stands in for.
 */
export type Inline =
  | { kind: "text"; text: string }
  | { kind: "emphasis" | "strong" | "strikethrough"; children: Inline[] }
  | { kind: "code"; text: string }
  | { kind: "link"; href: string; title?: string; children: Inline[] }
  | { kind: "image"; reference: string; alt: string; title?: string; size?: ImageSize }
  | { kind: "note"; label: string; number: number; words: string }
  | { kind: "styled"; tag: "kbd" | "sub" | "sup" | "mark"; children: Inline[] }
  | { kind: "break" }
  | { kind: "math"; tex: string; display: boolean };

/** Each footnote a reference uses, by its label in lower case: its number and its words. */
export type Notes = ReadonlyMap<string, { number: number; text: string }>;

/** Syntax, not content. These characters never paint. */
const MARKS = new Set(["EmphasisMark", "CodeMark", "LinkMark", "StrikethroughMark", "QuoteMark"]);

/**
 * The inline content of a node between two positions, trimmed as CommonMark trims a block. Given
 * the footnotes, a reference to one is its number, as the page draws it (#283).
 */
export function inlinesOf(
  doc: Text,
  definitions: Definitions,
  node: SyntaxNode,
  from = node.from,
  to = node.to,
  notes: Notes = new Map(),
): Inline[] {
  const out = run(doc, definitions, notes, node, from, to);
  const first = out[0];
  if (first?.kind === "text") out[0] = text(first.text.trimStart());
  const last = out.at(-1);
  if (last?.kind === "text") out[out.length - 1] = text(last.text.trimEnd());
  return out.filter((inline) => inline.kind !== "text" || inline.text);
}

/** GFM: in a table cell, `\|` is a pipe, even in code. Lezer keeps the backslash in a code span. */
export function unescapePipes(inlines: Inline[]): Inline[] {
  return inlines.map((inline) =>
    inline.kind === "code"
      ? { ...inline, text: inline.text.replaceAll("\\|", "|") }
      : "children" in inline
        ? { ...inline, children: unescapePipes(inline.children) }
        : inline,
  );
}

export function plainText(inlines: Inline[]): string {
  return inlines
    .map((inline) =>
      inline.kind === "image"
        ? inline.alt
        : inline.kind === "note"
          ? String(inline.number)
          : inline.kind === "break"
            ? " "
            : inline.kind === "math"
              ? inline.tex
              : "text" in inline
                ? inline.text
                : plainText(inline.children),
    )
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function run(
  doc: Text,
  definitions: Definitions,
  notes: Notes,
  node: SyntaxNode,
  from = node.from,
  to = node.to,
) {
  const out: Inline[] = [];
  // #200: the inline HTML the page draws, by where each element opens.
  const elements = new Map(elementsIn(doc, node).map((element) => [element.open.from, element]));
  let pos = from;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.from < from || child.to > to || child.from < pos) continue;
    const element = elements.get(child.from);
    if (element && (element.close?.to ?? element.open.to) <= to) {
      const drawn = html(doc, definitions, notes, node, element);
      append(out, text(doc.sliceString(pos, child.from)), ...drawn);
      pos = element.close?.to ?? element.open.to;
      continue;
    }
    append(out, text(doc.sliceString(pos, child.from)), ...inline(doc, definitions, notes, child));
    pos = child.to;
  }
  append(out, text(doc.sliceString(pos, to)));
  return out;
}

function inline(doc: Text, definitions: Definitions, notes: Notes, node: SyntaxNode): Inline[] {
  const source = doc.sliceString(node.from, node.to);
  switch (node.name) {
    case "Emphasis":
      return [{ kind: "emphasis", children: run(doc, definitions, notes, node) }];
    case "StrongEmphasis":
      return [{ kind: "strong", children: run(doc, definitions, notes, node) }];
    case "Strikethrough":
      return [{ kind: "strikethrough", children: run(doc, definitions, notes, node) }];
    case "InlineCode": {
      const open = node.firstChild?.to ?? node.from;
      const close = node.lastChild?.from ?? node.to;
      const content = doc.sliceString(open, close).replace(/\n/g, " ");
      return [
        { kind: "code", text: /^ .*[^ ].* $/s.test(content) ? content.slice(1, -1) : content },
      ];
    }
    case "Link":
    case "Image": {
      // A reference to a footnote is its number, as the page draws it (#283).
      const label = /^\[\^([^\]\s]+)\]$/.exec(source)?.[1].toLowerCase();
      const note = node.name === "Link" && label ? notes.get(label) : undefined;
      if (label && note) return [{ kind: "note", label, number: note.number, words: note.text }];
      const [open, close] = node.getChildren("LinkMark");
      const words = run(doc, definitions, notes, node, open.to, close.from);
      const href = destination(doc, node, definitions);
      if (href === null) {
        return [
          text(doc.sliceString(node.from, open.to)),
          ...words,
          text(doc.sliceString(close.from, node.to)),
        ];
      }
      const title = titleOf(doc, node, definitions);
      const titled = title ? { title } : {};
      // An image in a table cell is drawn there as on the page (#155).
      if (node.name === "Image") {
        return [{ kind: "image", reference: href, alt: plainText(words), ...titled }];
      }
      return [{ kind: "link", href, ...titled, children: words }];
    }
    case "Autolink": {
      const url = node.getChild("URL");
      const address = url ? doc.sliceString(url.from, url.to) : source;
      return [{ kind: "link", href: autolinkHref(address), children: [text(address)] }];
    }
    case "URL":
      // #201: a bare address is a link. One in a link's words is text.
      if (!isBareAddress(node)) return [text(source)];
      return [{ kind: "link", href: bareHref(source), children: [text(source)] }];
    case "InlineMath":
    case "DisplayMath":
      return [{ kind: "math", tex: mathTex(doc, node), display: node.name === "DisplayMath" }];
    case "Escape":
      return [text(source.slice(1))];
    case "Emoji":
      return [text(emojiOf(source.slice(1, -1)) ?? source)];
    case "Entity":
      return [text(decodeHTML(source))];
    case "HardBreak":
      return [text(" ")];
    case "Comment":
      // Written not to be seen, as on the page (#224).
      return [];
    default:
      return MARKS.has(node.name) ? [] : [text(source)];
  }
}

/** A formula's TeX, between its marks (#220). Its lines in a quote lose the quote's marks. */
export function mathTex(doc: Text, node: SyntaxNode): string {
  const [open, close] = node.getChildren("MathMark");
  const tex = doc.sliceString(open.to, close.from);
  for (let up = node.parent; up; up = up.parent) {
    if (up.name === "Blockquote") return tex.replace(/\n[ \t]*(?:>[ \t]?)+/g, "\n");
  }
  return tex;
}

/** An element of inline HTML the page draws (#200), as the construct it stands for. */
function html(
  doc: Text,
  definitions: Definitions,
  notes: Notes,
  parent: SyntaxNode,
  { kind, attributes, open, close }: HtmlElement,
): Inline[] {
  const children = () => (close ? run(doc, definitions, notes, parent, open.to, close.from) : []);
  const title = attributes.get("title");
  const titled = title ? { title } : {};
  switch (kind) {
    case "br":
      return [{ kind: "break" }];
    case "img": {
      const reference = attributes.get("src")?.trim();
      if (!reference) return [text(doc.sliceString(open.from, open.to))];
      const size = sizeOf(attributes);
      const alt = attributes.get("alt") ?? "";
      return [{ kind: "image", reference, alt, ...titled, ...(size ? { size } : {}) }];
    }
    case "a": {
      // An anchor with no address, `<a id="top">`, marks a place, and shows only its words.
      const href = attributes.get("href")?.trim();
      if (href === undefined) return children();
      return [{ kind: "link", href, ...titled, children: children() }];
    }
    case "code":
      return [{ kind: "code", text: plainText(children()) }];
    case "strong":
      return [{ kind: "strong", children: children() }];
    case "em":
      return [{ kind: "emphasis", children: children() }];
    default:
      return [{ kind: "styled", tag: kind, children: children() }];
  }
}

function append(out: Inline[], ...inlines: Inline[]): void {
  for (const next of inlines) {
    if (next.kind === "text" && !next.text) continue;
    const last = out.at(-1);
    if (next.kind === "text" && last?.kind === "text")
      out[out.length - 1] = text(last.text + next.text);
    else out.push(next);
  }
}

function text(value: string): Inline {
  return { kind: "text", text: value };
}
