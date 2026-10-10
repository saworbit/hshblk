import {
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
      const caret = active?.main.empty ? active.main.head : -1;
      return addressTooltip(links.find((link) => link.from <= caret && caret <= link.to));
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
        this.#hide(fold, node.from, node.to, new ImageWidget(reference, alt));
        return false;
      }
      case "Autolink": {
        const url = node.getChild("URL");
        if (!url) return false;
        this.#linkWords(url.from, url.to, this.doc.sliceString(url.from, url.to));
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
      case "ListMark":
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
    this.#linkWords(open.to, close.from, href);
    this.#conceal(node.from, open.to);
    this.#conceal(close.from, node.to);
  }

  #linkWords(from: number, to: number, href: string): void {
    this.#style(
      Decoration.mark({ class: "pg-link", attributes: { title: href, "data-href": href } }),
      from,
      to,
    );
    this.#links.push({ from, to, href });
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
