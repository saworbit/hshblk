import type { SyntaxNode, Tree } from "@lezer/common";
import { parser as commonMark, Strikethrough, Table } from "@lezer/markdown";
import { decodeHTML } from "entities";

/**
 * The presentation layer. Lezer says where the syntax is; this decides what paints.
 *
 * The dialect is docs/hld.md §7: CommonMark, GFM tables, and `~~` strikethrough.
 * Anything outside it stays as the characters that were written.
 */
const parser = commonMark.configure([Table, Strikethrough]);

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "emphasis" | "strong" | "strikethrough"; children: Inline[] }
  | { kind: "code"; text: string }
  | { kind: "link"; href: string; children: Inline[] }
  | { kind: "image"; src: string; alt: string }
  | { kind: "break" };

export type Align = "left" | "center" | "right" | null;

export type ListItem = { marker: string; children: Block[] };

export type Block =
  | { kind: "heading"; level: number; id: string; children: Inline[] }
  | { kind: "paragraph"; children: Inline[] }
  | { kind: "code"; info: string; text: string }
  | { kind: "source"; text: string }
  | { kind: "quote"; children: Block[] }
  | { kind: "list"; ordered: boolean; tight: boolean; items: ListItem[] }
  | { kind: "table"; align: Align[]; head: Inline[][]; rows: Inline[][][] }
  | { kind: "rule" };

export type Heading = { id: string; level: number; text: string };

export type Page = { blocks: Block[]; headings: Heading[]; words: number };

type Context = {
  doc: string;
  definitions: Map<string, string>;
  headings: Heading[];
  ids: Set<string>;
};

/** Syntax, not content. These characters never paint. */
const MARKS = new Set([
  "HeaderMark",
  "EmphasisMark",
  "CodeMark",
  "LinkMark",
  "QuoteMark",
  "ListMark",
  "StrikethroughMark",
]);

const BLANK_LINE = /\n[ \t>]*\n/;

export function readMarkdown(file: string): Page {
  // Lezer ends lines at \n alone. The page does not depend on which ending the file used.
  const doc = file.replace(/\r\n?/g, "\n");
  const tree = parser.parse(doc);
  const cx: Context = {
    doc,
    definitions: definitionsIn(doc, tree),
    headings: [],
    ids: new Set(),
  };
  const blocks = blocksOf(cx, tree.topNode);
  return { blocks, headings: cx.headings, words: wordsIn(blocks) };
}

function blocksOf(cx: Context, parent: SyntaxNode): Block[] {
  return children(parent).flatMap((node) => blockOf(cx, node) ?? []);
}

function blockOf(cx: Context, node: SyntaxNode): Block | null {
  switch (node.name) {
    case "ATXHeading1":
    case "ATXHeading2":
    case "ATXHeading3":
    case "ATXHeading4":
    case "ATXHeading5":
    case "ATXHeading6":
    case "SetextHeading1":
    case "SetextHeading2":
      return heading(cx, node);
    case "Paragraph":
      return { kind: "paragraph", children: contentOf(cx, node) };
    case "FencedCode":
    case "CodeBlock":
      return codeBlock(cx, node);
    case "Blockquote":
      return { kind: "quote", children: blocksOf(cx, node) };
    case "BulletList":
    case "OrderedList":
      return list(cx, node);
    case "Table":
      return table(cx, node);
    case "HorizontalRule":
      return { kind: "rule" };
    case "LinkReference":
      // A definition. The links that use it carry its address.
      return null;
    default:
      // Raw HTML, comments, and anything unrecognised: shown as written.
      return MARKS.has(node.name) ? null : { kind: "source", text: slice(cx, node) };
  }
}

function heading(cx: Context, node: SyntaxNode): Block {
  const level = Number(node.name.slice(-1));
  // A setext heading ends where its underline starts. An ATX heading's marks are skipped inline.
  const underline = node.name.startsWith("Setext") ? node.getChild("HeaderMark") : null;
  const children = contentOf(cx, node, underline?.from ?? node.to);
  const text = plainText(children);
  const id = uniqueId(cx, text);
  if (text) cx.headings.push({ id, level, text });
  return { kind: "heading", level, id, children };
}

function codeBlock(cx: Context, node: SyntaxNode): Block {
  const info = node.getChild("CodeInfo");
  // Between the CodeText pieces sit indentation and quote marks that belong to the container.
  const text = node
    .getChildren("CodeText")
    .map((piece) => slice(cx, piece))
    .join("");
  return { kind: "code", info: info ? slice(cx, info) : "", text: text.replace(/\n$/, "") };
}

function list(cx: Context, node: SyntaxNode): Block {
  const items = node.getChildren("ListItem").map((item) => {
    const mark = item.getChild("ListMark");
    return { marker: mark ? slice(cx, mark) : "", children: blocksOf(cx, item) };
  });
  return {
    kind: "list",
    ordered: node.name === "OrderedList",
    tight: !isLoose(cx.doc, node),
    items,
  };
}

/** CommonMark: a blank line between two items, or between two blocks in one item. */
function isLoose(doc: string, list: SyntaxNode): boolean {
  const items = list.getChildren("ListItem");
  return gapped(doc, items) || items.some((item) => gapped(doc, children(item)));
}

function gapped(doc: string, nodes: SyntaxNode[]): boolean {
  return nodes.some((node, i) => i > 0 && BLANK_LINE.test(doc.slice(nodes[i - 1].to, node.from)));
}

function table(cx: Context, node: SyntaxNode): Block {
  const delimiter = node.getChild("TableDelimiter");
  const align = delimiter ? alignments(slice(cx, delimiter)) : [];
  // GFM: the delimiter row sets the column count. Short rows are padded, long rows cut.
  const fit = (cells: Inline[][]) => align.map((_, i) => cells[i] ?? []);
  const header = node.getChild("TableHeader");
  return {
    kind: "table",
    align,
    head: header ? fit(cellsOf(cx, header)) : [],
    rows: node.getChildren("TableRow").map((row) => fit(cellsOf(cx, row))),
  };
}

function alignments(delimiterRow: string): Align[] {
  return delimiterRow
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((spec) => {
      const left = spec.trim().startsWith(":");
      const right = spec.trim().endsWith(":");
      return left && right ? "center" : right ? "right" : left ? "left" : null;
    });
}

/** A row's cells in order. Two pipes with nothing between them are an empty cell. */
function cellsOf(cx: Context, row: SyntaxNode): Inline[][] {
  const cells: Inline[][] = [];
  let cell: Inline[] | null = row.firstChild?.name === "TableDelimiter" ? null : [];
  for (const child of children(row)) {
    if (child.name === "TableCell") {
      cell = contentOf(cx, child);
    } else if (child.name === "TableDelimiter") {
      if (cell) cells.push(cell);
      cell = [];
    }
  }
  if (cell && row.lastChild?.name !== "TableDelimiter") cells.push(cell);
  return cells;
}

/** The inline content of a block, without the whitespace CommonMark strips from its ends. */
function contentOf(cx: Context, node: SyntaxNode, to = node.to): Inline[] {
  const inlines = inlinesOf(cx, node, node.from, to);
  const first = inlines[0];
  if (first?.kind === "text") inlines[0] = literal(first.text.trimStart());
  const last = inlines.at(-1);
  if (last?.kind === "text") inlines[inlines.length - 1] = literal(last.text.trimEnd());
  return inlines.filter((inline) => inline.kind !== "text" || inline.text);
}

/** The text between children is content. The children say what it means. */
function inlinesOf(cx: Context, node: SyntaxNode, from = node.from, to = node.to): Inline[] {
  const out: Inline[] = [];
  let pos = from;
  for (const child of children(node)) {
    if (child.from < from || child.to > to) continue;
    append(out, literal(cx.doc.slice(pos, child.from)), ...inlineOf(cx, child));
    pos = child.to;
  }
  append(out, literal(cx.doc.slice(pos, to)));
  return out;
}

function inlineOf(cx: Context, node: SyntaxNode): Inline[] {
  switch (node.name) {
    case "Emphasis":
      return [{ kind: "emphasis", children: inlinesOf(cx, node) }];
    case "StrongEmphasis":
      return [{ kind: "strong", children: inlinesOf(cx, node) }];
    case "Strikethrough":
      return [{ kind: "strikethrough", children: inlinesOf(cx, node) }];
    case "InlineCode":
      return [{ kind: "code", text: codeSpan(cx, node) }];
    case "Link":
    case "Image":
      return link(cx, node);
    case "Autolink":
      return autolink(cx, node);
    case "Escape":
      return [literal(slice(cx, node).slice(1))];
    case "Entity":
      return [literal(decodeHTML(slice(cx, node)))];
    case "HardBreak":
      return [{ kind: "break" }];
    default:
      // Inline HTML and anything unrecognised: shown as written.
      return MARKS.has(node.name) ? [] : [literal(slice(cx, node))];
  }
}

/** CommonMark: line endings become spaces, and one space of padding comes off each side. */
function codeSpan(cx: Context, node: SyntaxNode): string {
  const open = node.firstChild?.to ?? node.from;
  const close = node.lastChild?.from ?? node.to;
  const content = cx.doc.slice(open, close).replace(/\r?\n/g, " ");
  const padded = /^ .*[^ ].* $/s.test(content);
  return padded ? content.slice(1, -1) : content;
}

/**
 * A link paints its words. Its address comes from the parentheses after it, or from a
 * definition somewhere in the file. A reference with no definition is not a link, and its
 * brackets stay as written.
 */
function link(cx: Context, node: SyntaxNode): Inline[] {
  const [open, close] = node.getChildren("LinkMark");
  const words = inlinesOf(cx, node, open.to, close.from);
  const href = destination(cx, node, cx.doc.slice(open.to, close.from));
  if (href === null) {
    return [literal(slice(cx, open)), ...words, literal(cx.doc.slice(close.from, node.to))];
  }
  if (node.name === "Image") return [{ kind: "image", src: href, alt: plainText(words) }];
  return [{ kind: "link", href, children: words }];
}

function destination(cx: Context, node: SyntaxNode, label: string): string | null {
  const inline = node.getChildren("LinkMark").some((mark) => slice(cx, mark) === "(");
  if (inline) {
    const url = node.getChild("URL");
    return url ? unwrap(slice(cx, url)) : "";
  }
  // `[text][label]` names its definition. `[text][]` and `[text]` are named by their text.
  const reference = node.getChild("LinkLabel");
  const name =
    reference && slice(cx, reference) !== "[]" ? slice(cx, reference).slice(1, -1) : label;
  return cx.definitions.get(normalize(name)) ?? null;
}

function autolink(cx: Context, node: SyntaxNode): Inline[] {
  const url = node.getChild("URL");
  const address = url ? slice(cx, url) : slice(cx, node);
  const href = !address.includes(":") && address.includes("@") ? `mailto:${address}` : address;
  return [{ kind: "link", href, children: [literal(address)] }];
}

/** Every link reference definition, by label. The first definition of a label wins. */
function definitionsIn(doc: string, tree: Tree): Map<string, string> {
  const definitions = new Map<string, string>();
  tree.iterate({
    enter(ref) {
      if (ref.name !== "LinkReference") return;
      const label = ref.node.getChild("LinkLabel");
      const url = ref.node.getChild("URL");
      const name = label ? normalize(doc.slice(label.from + 1, label.to - 1)) : "";
      if (name && !definitions.has(name)) {
        definitions.set(name, url ? unwrap(doc.slice(url.from, url.to)) : "");
      }
      return false;
    },
  });
  return definitions;
}

/** CommonMark label matching: case-folded, with any run of whitespace as one space. */
function normalize(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase().toUpperCase();
}

/** A destination written as `<...>` may hold spaces. The angle brackets are not the address. */
function unwrap(url: string): string {
  return url.startsWith("<") && url.endsWith(">") ? url.slice(1, -1) : url;
}

/** A readable anchor from the heading's words, numbered when the same words come back. */
function uniqueId(cx: Context, text: string): string {
  const base =
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, "")
      .trim()
      .replace(/\s+/g, "-") || "section";
  let id = base;
  for (let n = 1; cx.ids.has(id); n += 1) id = `${base}-${n}`;
  cx.ids.add(id);
  return id;
}

function wordsIn(blocks: Block[]): number {
  return blocks.map(textOfBlock).join(" ").split(/\s+/).filter(Boolean).length;
}

function textOfBlock(block: Block): string {
  switch (block.kind) {
    case "heading":
    case "paragraph":
      return textOf(block.children);
    case "code":
    case "source":
      return block.text;
    case "quote":
      return block.children.map(textOfBlock).join(" ");
    case "list":
      return block.items.flatMap((item) => item.children.map(textOfBlock)).join(" ");
    case "table":
      return [block.head, ...block.rows].flat().map(textOf).join(" ");
    case "rule":
      return "";
  }
}

function plainText(inlines: Inline[]): string {
  return textOf(inlines).replace(/\s+/g, " ").trim();
}

function textOf(inlines: Inline[]): string {
  return inlines.map(textOfInline).join("");
}

function textOfInline(inline: Inline): string {
  switch (inline.kind) {
    case "text":
    case "code":
      return inline.text;
    case "image":
      return inline.alt;
    case "break":
      return " ";
    default:
      return textOf(inline.children);
  }
}

/** Adds inlines to a run, joining neighbouring text and dropping empty text. */
function append(out: Inline[], ...inlines: Inline[]): void {
  for (const inline of inlines) {
    if (inline.kind === "text" && !inline.text) continue;
    const last = out.at(-1);
    if (inline.kind === "text" && last?.kind === "text") {
      out[out.length - 1] = literal(last.text + inline.text);
    } else {
      out.push(inline);
    }
  }
}

function literal(text: string): Inline {
  return { kind: "text", text };
}

function children(node: SyntaxNode): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) out.push(child);
  return out;
}

function slice(cx: Context, node: SyntaxNode): string {
  return cx.doc.slice(node.from, node.to);
}
