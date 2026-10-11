import {
  countColumn,
  type EditorSelection,
  type EditorState,
  type Range,
  StateEffect,
  StateField,
  type Text,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  showTooltip,
  type WidgetType,
} from "@codemirror/view";
import type { SyntaxNode, Tree } from "@lezer/common";
import { decodeHTML } from "entities";
import { pageTree } from "./complete.ts";
import { inlinesOf, plainText, type Inline } from "./inlines.ts";
import { addressTooltip, type LinkSpan } from "./links.ts";
import { definitionsIn, destination, type Definitions } from "./references.ts";
import { ImageWidget, TableWidget, TextWidget, type Align, type TableModel } from "./widgets.ts";

/** The source a piece of hidden syntax belongs to. A selection inside it shows the syntax. */
type Fold = { from: number; to: number };

type Page = {
  tree: Tree;
  /** Classes that hold wherever the selection is. */
  styles: DecorationSet;
  /** Syntax hidden while the selection is elsewhere. */
  folds: DecorationSet;
  /** The reader's own selection. Null until they place one, so nothing opens on arrival. */
  active: EditorSelection | null;
  /** The folds, less the ones the active selection is in. */
  shown: DecorationSet;
  /** Every link's words, in order, for the address shown at the caret. */
  links: LinkSpan[];
};

/** The widest hanging indent, in columns. A list item indented further does not hang. */
export const HANG_LIMIT = 24;

/** Folds all the syntax again, as on arrival, until the reader next places a selection. */
export const foldAll = StateEffect.define<null>();

/** docs/hld.md §7: the presentation layer, as decorations over the source. */
export const page = StateField.define<Page>({
  create: (state) => build(state, null),
  update(current, tr) {
    const active = tr.effects.some((effect) => effect.is(foldAll))
      ? null
      : tr.selection && tr.isUserEvent("select")
        ? tr.state.selection
        : current.active;
    if (tr.docChanged || pageTree(tr.state) !== current.tree) return build(tr.state, active);
    if (active === current.active) return current;
    return { ...current, active, shown: unfold(current.folds, active) };
  },
  provide: (field) => [
    EditorView.decorations.from(field, (current) => current.styles),
    EditorView.decorations.from(field, (current) => current.shown),
    showTooltip.compute([field], (state) => {
      const { active, links } = state.field(field);
      if (!active) return null;
      const { from, to, empty } = active.main;
      if (empty) return addressTooltip(links.find((link) => link.from <= from && from <= link.to));
      // A selection inside a link but not inside its words, such as a find match in its address,
      // is in syntax that never shows, so the address shows it.
      const hidden = links.find(
        (link) =>
          link.source.from <= from && to <= link.source.to && (from < link.from || to > link.to),
      );
      return addressTooltip(hidden, state.sliceDoc(from, to));
    }),
  ],
});

function build(state: EditorState, active: EditorSelection | null): Page {
  const tree = pageTree(state);
  const { styles, hidden, links } = new Painter(state.doc, definitionsIn(state.doc, tree)).paint(
    tree,
  );
  return { tree, styles, folds: hidden, active, shown: unfold(hidden, active), links };
}

function unfold(folds: DecorationSet, active: EditorSelection | null): DecorationSet {
  if (!active) return folds;
  return folds.update({
    filter: (_from, _to, decoration) => {
      const fold: Fold = decoration.spec.fold;
      return !active.ranges.some((range) => range.from <= fold.to && range.to >= fold.from);
    },
  });
}

/** Walks the tree once, writing a class for each construct and a fold for its syntax. */
class Painter {
  readonly doc: Text;
  readonly definitions: Definitions;
  readonly #styles: Range<Decoration>[] = [];
  readonly #hidden: Range<Decoration>[] = [];
  readonly #links: LinkSpan[] = [];
  /** The markers drawn in a hanging item's box, which styles them. */
  readonly #hung = new Set<number>();

  constructor(doc: Text, definitions: Definitions) {
    this.doc = doc;
    this.definitions = definitions;
  }

  paint(tree: Tree): { styles: DecorationSet; hidden: DecorationSet; links: LinkSpan[] } {
    tree.iterate({ enter: (ref) => this.#visit(ref.node) });
    return {
      styles: Decoration.set(this.#styles, true),
      hidden: Decoration.set(this.#hidden, true),
      links: this.#links,
    };
  }

  /** Returns false where the construct's children are drawn by it, not decorated one by one. */
  #visit(node: SyntaxNode): boolean | void {
    const fold = { from: node.from, to: node.to };
    switch (node.name) {
      case "ATXHeading1":
      case "ATXHeading2":
      case "ATXHeading3":
      case "ATXHeading4":
      case "ATXHeading5":
      case "ATXHeading6":
        this.#lines(node.from, node.to, `pg-heading pg-h${node.name.slice(-1)}`);
        for (const mark of node.getChildren("HeaderMark")) {
          // Opening marks take the space after them, closing marks the space before.
          if (mark.from === node.from)
            this.#hide(fold, mark.from, this.#spaceAfter(mark.to, node.to));
          else this.#hide(fold, this.#spaceBefore(mark.from, node.from), mark.to);
        }
        return;
      case "SetextHeading1":
      case "SetextHeading2": {
        const underline = node.getChild("HeaderMark");
        const end = underline ? underline.from - 1 : node.to;
        this.#lines(node.from, end, `pg-heading pg-h${node.name.slice(-1)}`);
        if (underline) {
          this.#hide(fold, underline.from, underline.to);
          this.#foldLine(fold, underline.from, "pg-collapsed");
        }
        return;
      }
      case "Emphasis":
        return this.#wrap(node, "pg-em", "EmphasisMark");
      case "StrongEmphasis":
        return this.#wrap(node, "pg-strong", "EmphasisMark");
      case "Strikethrough":
        return this.#wrap(node, "pg-strike", "StrikethroughMark");
      case "InlineCode":
        this.#wrap(node, "pg-code", "CodeMark");
        return false;
      case "Link":
        return this.#link(node);
      case "Image": {
        const reference = destination(this.doc, node, this.definitions);
        if (reference === null) return;
        const [open, close] = node.getChildren("LinkMark");
        const alt = plainText(inlinesOf(this.doc, this.definitions, node, open.to, close.from));
        this.#hide(fold, node.from, node.to, new ImageWidget(reference, alt, !this.#alone(node)));
        return false;
      }
      case "Autolink": {
        const url = node.getChild("URL");
        if (!url) return false;
        this.#linkWords(url.from, url.to, this.doc.sliceString(url.from, url.to), node);
        this.#conceal(node.from, url.from);
        this.#conceal(url.to, node.to);
        return false;
      }
      case "Escape":
        this.#hide(fold, node.from, node.from + 1);
        return false;
      case "Entity":
        this.#hide(fold, node.from, node.to, new TextWidget(decodeHTML(this.#slice(node))));
        return false;
      case "HardBreak":
        if (this.#slice(node).startsWith("\\")) this.#hide(fold, node.from, node.from + 1);
        return false;
      case "Blockquote":
        this.#lines(node.from, node.to, "pg-quote");
        return;
      case "QuoteMark": {
        const line = this.doc.lineAt(node.from);
        this.#hide(
          { from: line.from, to: line.to },
          node.from,
          this.#spaceAfter(node.to, line.to, 1),
        );
        return false;
      }
      case "ListItem":
        this.#hang(node);
        return;
      case "ListMark":
        if (!this.#hung.has(node.from))
          this.#style(Decoration.mark({ class: "pg-list-mark" }), node.from, node.to);
        return false;
      case "FencedCode":
        this.#lines(node.from, node.to, "pg-code-block");
        this.#lines(node.from, node.from, "pg-fence");
        if (node.lastChild?.name === "CodeMark" && node.lastChild.from > node.from) {
          this.#lines(node.lastChild.from, node.lastChild.from, "pg-fence");
        }
        return false;
      case "CodeBlock":
        this.#lines(node.from, node.to, "pg-code-block");
        return false;
      case "HTMLBlock":
      case "CommentBlock":
      case "ProcessingInstructionBlock":
        this.#lines(node.from, node.to, "pg-source-block");
        return false;
      case "HorizontalRule":
        this.#foldLine(fold, node.from, "pg-rule");
        this.#hide(fold, node.from, node.to);
        return false;
      case "Table":
        this.#hideLines(fold, node, new TableWidget(this.#table(node)));
        return false;
      case "LinkReference":
        // A definition. The links that use it carry its address, so its lines do not paint.
        this.#hideLines(fold, node);
        return false;
    }
  }

  /**
   * A link shows its words, and its syntax stays hidden even with the caret inside: the address
   * shows at the caret instead. A reference with no definition is not a link, and is left as written.
   */
  #link(node: SyntaxNode): boolean | void {
    const href = destination(this.doc, node, this.definitions);
    if (href === null) return;
    const [open, close] = node.getChildren("LinkMark");
    this.#linkWords(open.to, close.from, href, node);
    this.#conceal(node.from, open.to);
    this.#conceal(close.from, node.to);
  }

  /**
   * A list item's wrapped lines start under its text, not its marker. Each line of its
   * paragraphs hangs by the columns before its text, and what fills them, the indent and the
   * marker as written, is drawn that many columns wide, so the first line meets the rest.
   */
  #hang(item: SyntaxNode): void {
    const mark = item.getChild("ListMark");
    const first = item.getChild("Paragraph");
    // A quote's marks are hidden, so they take no columns. Its items stay as they were.
    for (let up = item.parent; up; up = up.parent) if (up.name === "Blockquote") return;
    if (!mark || !first) return;
    const column = (from: number, to: number) => countColumn(this.doc.sliceString(from, to), 4);
    const text = column(this.doc.lineAt(first.from).from, first.from);
    if (text < 1 || text > HANG_LIMIT) return;
    const box = (from: number, to: number, width: number, className = "") =>
      this.#style(Decoration.mark({ class: `${className} pg-box-${width}`.trim() }), from, to);
    for (const paragraph of item.getChildren("Paragraph")) {
      for (let pos = paragraph.from; pos <= paragraph.to;) {
        const line = this.doc.lineAt(pos);
        pos = line.to + 1;
        const indent = /^[ \t]*/.exec(line.text)![0].length;
        if (line.from <= mark.from && mark.from <= line.to) {
          if (indent !== mark.from - line.from || first.from > line.to) continue;
          const before = column(line.from, mark.from);
          if (before > 0) box(line.from, mark.from, before);
          box(mark.from, first.from, text - before, "pg-list-mark");
          this.#hung.add(mark.from);
          this.#lines(line.from, line.from, `pg-hang-${text}`);
        } else if (indent > 0) {
          box(line.from, line.from + indent, text);
          this.#lines(line.from, line.from, `pg-hang-${text}`);
        } else {
          this.#lines(line.from, line.from, `pg-pad-${text}`);
        }
      }
    }
  }

  /** Whether an image is all its paragraph holds, inside any links that hold only it. */
  #alone(image: SyntaxNode): boolean {
    let top = image;
    for (let link = top.parent; link?.name === "Link"; link = top.parent) {
      const [open, close] = link.getChildren("LinkMark");
      if (open.to !== top.from || close.from !== top.to) return false;
      if (destination(this.doc, link, this.definitions) === null) return false;
      top = link;
    }
    const block = top.parent;
    return (
      block?.name === "Paragraph" &&
      !this.doc.sliceString(block.from, top.from).trim() &&
      !this.doc.sliceString(top.to, block.to).trim()
    );
  }

  #linkWords(from: number, to: number, href: string, source: SyntaxNode): void {
    this.#style(
      Decoration.mark({ class: "pg-link", attributes: { title: href, "data-href": href } }),
      from,
      to,
    );
    this.#links.push({ from, to, source: { from: source.from, to: source.to }, href });
  }

  /** Hides syntax for good, wherever the selection goes. */
  #conceal(from: number, to: number): void {
    if (from < to) this.#styles.push(Decoration.replace({}).range(from, to));
  }

  #wrap(node: SyntaxNode, className: string, markName: string): void {
    this.#style(Decoration.mark({ class: className }), node.from, node.to);
    const fold = { from: node.from, to: node.to };
    for (const mark of node.getChildren(markName)) this.#hide(fold, mark.from, mark.to);
  }

  #table(node: SyntaxNode): TableModel {
    const delimiter = node.getChild("TableDelimiter");
    const align = delimiter ? alignments(this.#slice(delimiter)) : [];
    const fit = (cells: Inline[][]) => align.map((_, i) => cells[i] ?? []);
    const header = node.getChild("TableHeader");
    return {
      align,
      head: header ? fit(this.#cells(header)) : [],
      rows: node.getChildren("TableRow").map((row) => fit(this.#cells(row))),
    };
  }

  /** A row's cells in order. Two pipes with nothing between them are an empty cell. */
  #cells(row: SyntaxNode): Inline[][] {
    const cells: Inline[][] = [];
    let cell: Inline[] | null = row.firstChild?.name === "TableDelimiter" ? null : [];
    for (let child = row.firstChild; child; child = child.nextSibling) {
      if (child.name === "TableCell") {
        cell = inlinesOf(this.doc, this.definitions, child);
      } else if (child.name === "TableDelimiter") {
        if (cell) cells.push(cell);
        cell = [];
      }
    }
    if (cell && row.lastChild?.name !== "TableDelimiter") cells.push(cell);
    return cells;
  }

  #style(decoration: Decoration, from: number, to = from): void {
    this.#styles.push(decoration.range(from, to));
  }

  #hide(fold: Fold, from: number, to: number, widget?: WidgetType): void {
    if (from < to) this.#hidden.push(Decoration.replace({ fold, widget }).range(from, to));
  }

  /** Replaces whole lines, for the constructs the page draws as a block or not at all. */
  #hideLines(fold: Fold, node: SyntaxNode, widget?: WidgetType): void {
    const from = this.doc.lineAt(node.from).from;
    const to = this.doc.lineAt(node.to).to;
    this.#hidden.push(Decoration.replace({ fold, widget, block: true }).range(from, to));
  }

  #lines(from: number, to: number, className: string): void {
    const decoration = Decoration.line({ class: className });
    for (let pos = from; pos <= to;) {
      const line = this.doc.lineAt(pos);
      this.#styles.push(decoration.range(line.from));
      pos = line.to + 1;
    }
  }

  #foldLine(fold: Fold, pos: number, className: string): void {
    this.#hidden.push(Decoration.line({ class: className, fold }).range(this.doc.lineAt(pos).from));
  }

  #spaceAfter(pos: number, limit: number, most = Infinity): number {
    let end = pos;
    while (end < limit && end - pos < most && this.doc.sliceString(end, end + 1) === " ") end += 1;
    return end;
  }

  #spaceBefore(pos: number, limit: number): number {
    let start = pos;
    while (start > limit && this.doc.sliceString(start - 1, start) === " ") start -= 1;
    return start;
  }

  #slice(node: SyntaxNode): string {
    return this.doc.sliceString(node.from, node.to);
  }
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
