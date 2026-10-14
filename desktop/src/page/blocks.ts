import type { Range, Text } from "@codemirror/state";
import { Decoration, type DecorationSet } from "@codemirror/view";
import type { SyntaxNode, Tree } from "@lezer/common";
import { inlinesOf, plainText, unescapePipes, type Inline } from "./inlines.ts";
import { anchorOf, define, type Definitions } from "./references.ts";
import { HtmlWidget, TableWidget, type Align, type TableModel } from "./widgets.ts";

/**
 * What the page takes from every line, not only the lines in view: the definitions links name,
 * each heading's anchor, and the constructs drawn as blocks, which CodeMirror takes only from
 * the state.
 */
export type Blocks = {
  definitions: Definitions;
  /** Each heading's GitHub anchor, to where it starts, for a link to it. */
  anchors: Map<string, number>;
  /** Tables and raw HTML, drawn in place of their source, and definitions, not drawn at all. */
  folds: DecorationSet;
  /** Each `<details>` written as its own blocks around a markdown body. The page draws these. */
  details: Details[];
  /** The file's frontmatter, which shows as written, or null when it has none. */
  frontmatter: Span | null;
};

type Span = { from: number; to: number };

/**
 * A `<details>` whose opening and closing tags are raw HTML blocks of their own, with markdown
 * between them, as a README writes it. Each block's source, and the whole lines it is on.
 */
export type Details = {
  /** The summary's HTML, empty when there is none. */
  summary: string;
  /** Written `<details open>`. */
  open: boolean;
  head: { source: Span; lines: Span };
  /** The lines between the two tags, or null when there are none. */
  body: Span | null;
  tail: { source: Span; lines: Span };
};

/** The blocks that hold other blocks. The scan goes into these and no others. */
const CONTAINERS = new Set(["Document", "Blockquote", "BulletList", "OrderedList", "ListItem"]);

/** Raw HTML, drawn in a frame. A comment or an instruction draws nothing there. */
const HTML = new Set(["HTMLBlock", "CommentBlock", "ProcessingInstructionBlock"]);

/** How far down the file a frontmatter's closing line may be. */
const FRONTMATTER_LINES = 1000;

/** How many blocks the scan reads between pauses. */
const STRIDE = 1000;

/** A block that opens a `<details>`, and its summary, if that is all the block holds. */
const OPENS = /^<details(\s[^>]*)?>\s*(?:<summary(?:\s[^>]*)?>([\s\S]*?)<\/summary\s*>\s*)?$/i;

/** A block that closes one, and holds nothing else. */
const CLOSES = /^<\/details\s*>$/i;

/**
 * Reads the blocks of `tree`, and pauses now and then so a caller can spread it over events. It
 * goes into no paragraph, heading, or code, so it costs one step a block, not one a word.
 */
export function* scan(doc: Text, tree: Tree): Generator<void, Blocks, void> {
  const definitions: Definitions = new Map();
  const headings: SyntaxNode[] = [];
  const drawn: SyntaxNode[] = [];
  const front = frontmatter(doc);
  const cursor = tree.cursor();
  walk: for (let read = 1; ; read += 1) {
    const name = cursor.name;
    // Lezer reads frontmatter as a rule and a heading. The page notes nothing in it.
    const noted = !front || cursor.to > front.to;
    if (noted && name === "LinkReference") {
      define(definitions, doc, cursor.node);
      drawn.push(cursor.node);
    } else if (noted && (name === "Table" || HTML.has(name))) {
      drawn.push(cursor.node);
    } else if (noted && (name.startsWith("ATXHeading") || name.startsWith("SetextHeading"))) {
      headings.push(cursor.node);
    }
    if (read % STRIDE === 0) yield;
    if (CONTAINERS.has(name) && cursor.firstChild()) continue;
    for (;;) {
      if (cursor.nextSibling()) continue walk;
      if (!cursor.parent()) break walk;
    }
  }
  // A heading or a table may hold a link that a definition further on names.
  const anchors = new Map<string, number>();
  for (const heading of headings) {
    const [from, to] = headingWords(heading);
    const words = plainText(inlinesOf(doc, definitions, heading, from, to));
    if (words) anchors.set(anchorOf(words, anchors), heading.from);
    yield;
  }
  // #228: an id or a name in the document's HTML is a place a link can go, after the headings.
  for (const [from, name] of htmlAnchors(doc, tree))
    if (!anchors.has(name)) anchors.set(name, from);
  const details = pairDetails(doc, drawn);
  // A details' own tags are drawn by the page, not in frames.
  const tags = new Set(details.flatMap(({ head, tail }) => [head.source.from, tail.source.from]));
  const folds: Range<Decoration>[] = [];
  for (const node of drawn) {
    if (tags.has(node.from)) continue;
    // A definition is not drawn: the links that use it carry its address.
    const widget =
      node.name === "Table"
        ? new TableWidget(table(doc, definitions, node))
        : HTML.has(node.name)
          ? new HtmlWidget(htmlOf(doc, node))
          : undefined;
    const fold = { from: node.from, to: node.to };
    const lines = { from: doc.lineAt(node.from).from, to: doc.lineAt(node.to).to };
    folds.push(Decoration.replace({ fold, widget, block: true }).range(lines.from, lines.to));
    yield;
  }
  return { definitions, anchors, folds: Decoration.set(folds, true), details, frontmatter: front };
}

/**
 * YAML frontmatter, as Obsidian and static site generators write it: `---` alone on the first
 * line, through the next line that is `---` or `...`. CommonMark reads it as a rule and a heading.
 * Lezer can look only one line ahead, so the page finds it here, where the whole text is. A `---`
 * with a blank line after it is a rule, as Pandoc reads it (#196).
 */
function frontmatter(doc: Text): Span | null {
  if (!/^---[ \t]*$/.test(doc.line(1).text)) return null;
  if (doc.lines > 1 && !doc.line(2).text.trim()) return null;
  for (let n = 2; n <= Math.min(doc.lines, FRONTMATTER_LINES); n += 1) {
    const line = doc.line(n);
    if (/^(---|\.\.\.)[ \t]*$/.test(line.text)) return { from: 0, to: line.to };
  }
  return null;
}

/** An opening tag's `id` or `name`, its value quoted either way or bare. */
const ANCHOR = /<[A-Za-z][^<>]*?\s(?:id|name)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;

/**
 * The ids and names the document's HTML gives, with where each tag starts: `<a id="top">` and
 * `<a name="install">`, inline or in a block, as READMEs mark places. In code they are not HTML.
 */
function htmlAnchors(doc: Text, tree: Tree): [number, string][] {
  const found: [number, string][] = [];
  for (const match of doc.toString().matchAll(ANCHOR)) {
    const name = match[1] ?? match[2] ?? match[3];
    const node = tree.resolveInner(match.index, 1);
    if (name && (node.name === "HTMLTag" || node.name === "HTMLBlock")) {
      found.push([match.index, name]);
    }
  }
  return found;
}

/** The scan without pauses, for a tree small enough to read at once. */
export function scanNow(doc: Text, tree: Tree): Blocks {
  const steps = scan(doc, tree);
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}

/**
 * Pairs each block that opens a `<details>` with the block that closes it, in the same container,
 * as tags nest. One with no partner stays a frame.
 */
function pairDetails(doc: Text, drawn: SyntaxNode[]): Details[] {
  const opened: { node: SyntaxNode; tag: RegExpExecArray }[] = [];
  const paired: Details[] = [];
  for (const node of drawn) {
    if (node.name !== "HTMLBlock") continue;
    const html = htmlOf(doc, node).trim();
    const tag = OPENS.exec(html);
    if (tag) {
      opened.push({ node, tag });
      continue;
    }
    if (!CLOSES.test(html)) continue;
    let at = opened.length - 1;
    while (at >= 0 && !sameContainer(opened[at].node, node)) at -= 1;
    if (at < 0) continue;
    // Any opened after it, in a container now closed, has no partner.
    const [{ node: head, tag: written }] = opened.splice(at);
    paired.push(detailsOf(doc, head, written, node));
  }
  return paired.sort((a, b) => a.head.source.from - b.head.source.from);
}

function sameContainer(a: SyntaxNode, b: SyntaxNode): boolean {
  return a.parent?.name === b.parent?.name && a.parent?.from === b.parent?.from;
}

function detailsOf(doc: Text, head: SyntaxNode, tag: RegExpExecArray, tail: SyntaxNode): Details {
  const lines = (node: SyntaxNode) => ({
    from: doc.lineAt(node.from).from,
    to: doc.lineAt(node.to).to,
  });
  const first = doc.lineAt(head.to).number + 1;
  const last = doc.lineAt(tail.from).number - 1;
  return {
    summary: tag[2] ?? "",
    open: /(^|\s)open(\s|=|$)/i.test(tag[1] ?? ""),
    head: { source: { from: head.from, to: head.to }, lines: lines(head) },
    body: first <= last ? { from: doc.line(first).from, to: doc.line(last).to } : null,
    tail: { source: { from: tail.from, to: tail.to }, lines: lines(tail) },
  };
}

/** A raw HTML block as written, less the marks of the quote it is in. */
function htmlOf(doc: Text, node: SyntaxNode): string {
  let html = "";
  let pos = node.from;
  for (const mark of node.getChildren("QuoteMark")) {
    html += doc.sliceString(pos, mark.from);
    pos = doc.sliceString(mark.to, mark.to + 1) === " " ? mark.to + 1 : mark.to;
  }
  return html + doc.sliceString(pos, node.to);
}

/** Where a heading's words are: between its marks, or above its underline. */
function headingWords(heading: SyntaxNode): [number, number] {
  const marks = heading.getChildren("HeaderMark");
  if (heading.name.startsWith("Setext")) return [heading.from, marks[0]?.from ?? heading.to];
  const closing = marks.length > 1 ? marks.at(-1) : undefined;
  return [marks[0]?.to ?? heading.from, closing?.from ?? heading.to];
}

function table(doc: Text, definitions: Definitions, node: SyntaxNode): TableModel {
  const delimiter = node.getChild("TableDelimiter");
  const align = delimiter ? alignments(doc.sliceString(delimiter.from, delimiter.to)) : [];
  const fit = (cells: Inline[][]) => align.map((_, i) => cells[i] ?? []);
  const header = node.getChild("TableHeader");
  return {
    align,
    head: header ? fit(cells(doc, definitions, header)) : [],
    rows: node.getChildren("TableRow").map((row) => fit(cells(doc, definitions, row))),
  };
}

/** A row's cells in order. Two pipes with nothing between them are an empty cell. */
function cells(doc: Text, definitions: Definitions, row: SyntaxNode): Inline[][] {
  const out: Inline[][] = [];
  let cell: Inline[] | null = row.firstChild?.name === "TableDelimiter" ? null : [];
  for (let child = row.firstChild; child; child = child.nextSibling) {
    if (child.name === "TableCell") {
      cell = unescapePipes(inlinesOf(doc, definitions, child));
    } else if (child.name === "TableDelimiter") {
      if (cell) out.push(cell);
      cell = [];
    }
  }
  if (cell && row.lastChild?.name !== "TableDelimiter") out.push(cell);
  return out;
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
