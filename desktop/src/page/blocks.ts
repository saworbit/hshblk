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
};

/** The blocks that hold other blocks. The scan goes into these and no others. */
const CONTAINERS = new Set(["Document", "Blockquote", "BulletList", "OrderedList", "ListItem"]);

/** Raw HTML, drawn in a frame. A comment or an instruction draws nothing there. */
const HTML = new Set(["HTMLBlock", "CommentBlock", "ProcessingInstructionBlock"]);

/** How many blocks the scan reads between pauses. */
const STRIDE = 1000;

/**
 * Reads the blocks of `tree`, and pauses now and then so a caller can spread it over events. It
 * goes into no paragraph, heading, or code, so it costs one step a block, not one a word.
 */
export function* scan(doc: Text, tree: Tree): Generator<void, Blocks, void> {
  const definitions: Definitions = new Map();
  const headings: SyntaxNode[] = [];
  const drawn: SyntaxNode[] = [];
  const cursor = tree.cursor();
  walk: for (let read = 1; ; read += 1) {
    const name = cursor.name;
    if (name === "LinkReference") {
      define(definitions, doc, cursor.node);
      drawn.push(cursor.node);
    } else if (name === "Table" || HTML.has(name)) {
      drawn.push(cursor.node);
    } else if (name.startsWith("ATXHeading") || name.startsWith("SetextHeading")) {
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
  const folds: Range<Decoration>[] = [];
  for (const node of drawn) {
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
  return { definitions, anchors, folds: Decoration.set(folds, true) };
}

/** The scan without pauses, for a tree small enough to read at once. */
export function scanNow(doc: Text, tree: Tree): Blocks {
  const steps = scan(doc, tree);
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
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
