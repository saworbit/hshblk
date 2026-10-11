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
  ViewPlugin,
  type ViewUpdate,
  type WidgetType,
} from "@codemirror/view";
import type { SyntaxNode, Tree } from "@lezer/common";
import { decodeHTML } from "entities";
import { type Blocks, scanNow } from "./blocks.ts";
import { pageTree, wholeBlocks } from "./complete.ts";
import { inlinesOf, plainText } from "./inlines.ts";
import { addressTooltip, linkAt, linkSpan } from "./links.ts";
import { destination, headings, type Definitions } from "./references.ts";
import { ImageWidget, TextWidget } from "./widgets.ts";

/** The source a piece of hidden syntax belongs to. A selection inside it shows the syntax. */
type Fold = { from: number; to: number };

type Page = {
  tree: Tree;
  /** What the page takes from every line. */
  blocks: Blocks;
  /** The reader's own selection. Null until they place one, so nothing opens on arrival. */
  active: EditorSelection | null;
  /**
   * The selection that opens syntax: the reader's, unless the pointer placed it. A click opens
   * nothing, so the text never moves under the pointer. The keyboard and find open what they reach.
   */
  opening: EditorSelection | null;
  /** The blocks' folds, less the ones the opening selection is in. */
  shown: DecorationSet;
};

/** The inline syntax of part of the page. */
type Painted = {
  /** Classes that hold wherever the selection is. */
  styles: DecorationSet;
  /** Syntax hidden while the selection is elsewhere. */
  folds: DecorationSet;
  /** The folds, less the ones the opening selection is in. */
  shown: DecorationSet;
};

/** The widest hanging indent, in columns. A list item indented further does not hang. */
export const HANG_LIMIT = 24;

/** Folds all the syntax again, as on arrival, until the reader next places a selection. */
export const foldAll = StateEffect.define<null>();

/**
 * A large file holds more inline syntax than the window can decorate between two frames. So it
 * is drawn for the viewport only, and again as the viewport moves.
 */
const painter = ViewPlugin.fromClass(
  class {
    painted: Painted;

    constructor(view: EditorView) {
      this.painted = paint(view.state, view.viewport);
    }

    update(update: ViewUpdate) {
      const before = update.startState.field(page);
      const now = update.state.field(page);
      if (update.viewportChanged || now.tree !== before.tree || now.blocks !== before.blocks) {
        this.painted = paint(update.state, update.view.viewport);
      } else if (now.opening !== before.opening) {
        this.painted = { ...this.painted, shown: unfold(this.painted.folds, now.opening) };
      }
    }
  },
);

/**
 * docs/hld.md §7: the presentation layer, as decorations over the source. The state holds what
 * needs every line, and `painter` draws the rest near the viewport.
 */
export const page = StateField.define<Page>({
  create: (state) => build(state, null, null),
  update(current, tr) {
    const folded = tr.effects.some((effect) => effect.is(foldAll));
    const selected = tr.selection && tr.isUserEvent("select");
    const active = folded ? null : selected ? tr.state.selection : current.active;
    const pointer = tr.isUserEvent("select.pointer");
    const opening = folded ? null : selected ? (pointer ? null : active) : current.opening;
    if (tr.docChanged || pageTree(tr.state) !== current.tree) {
      return build(tr.state, active, opening);
    }
    if (active === current.active && opening === current.opening) return current;
    return { ...current, active, opening, shown: unfold(current.blocks.folds, opening) };
  },
  provide: (field) => [
    EditorView.decorations.of((view) => view.plugin(painter)?.painted.styles ?? Decoration.none),
    EditorView.decorations.of((view) => view.plugin(painter)?.painted.shown ?? Decoration.none),
    EditorView.decorations.from(field, (current) => current.shown),
    headings.from(field, (current) => current.blocks.anchors),
    showTooltip.compute([field], (state) => {
      const { tree, blocks, active } = state.field(field);
      if (!active) return null;
      const { from, to, empty } = active.main;
      const link = linkAt(state.doc, tree, blocks.definitions, from, to);
      if (empty)
        return addressTooltip(link && link.from <= from && from <= link.to ? link : undefined);
      // A selection inside a link but not inside its words, such as a find match in its address,
      // is in syntax that never shows, so the address shows it.
      const hidden = link && (from < link.from || to > link.to) ? link : undefined;
      return addressTooltip(hidden, { text: state.sliceDoc(from, to), from });
    }),
    painter,
  ],
});

function build(
  state: EditorState,
  active: EditorSelection | null,
  opening: EditorSelection | null,
): Page {
  const tree = pageTree(state);
  // Until the whole document is parsed, the tree is only as long as CodeMirror has read.
  const blocks = wholeBlocks(state) ?? scanNow(state.doc, tree);
  return { tree, blocks, active, opening, shown: unfold(blocks.folds, opening) };
}

/** The inline syntax from `from` to `to`, whole lines, drawn from the page's tree. */
export function paint(state: EditorState, { from, to }: { from: number; to: number }): Painted {
  const { tree, blocks, opening } = state.field(page);
  const { styles, folds } = new Painter(state.doc, blocks.definitions, from, to).paint(tree);
  return { styles, folds, shown: unfold(folds, opening) };
}

function unfold(folds: DecorationSet, opening: EditorSelection | null): DecorationSet {
  if (!opening) return folds;
  return folds.update({
    filter: (_from, _to, decoration) => {
      const fold: Fold = decoration.spec.fold;
      return !opening.ranges.some((range) => range.from <= fold.to && range.to >= fold.from);
    },
  });
}

/**
 * Walks the tree between two points, writing a class for each construct and a fold for its
 * syntax. A construct that runs past them is drawn only as far as they go.
 */
class Painter {
  readonly doc: Text;
  readonly definitions: Definitions;
  /** The start of the first line drawn. */
  readonly from: number;
  /** The end of the last line drawn. */
  readonly to: number;
  readonly #styles: Range<Decoration>[] = [];
  readonly #folds: Range<Decoration>[] = [];
  /** The markers drawn in a hanging item's box, which styles them. */
  readonly #hung = new Set<number>();

  constructor(doc: Text, definitions: Definitions, from: number, to: number) {
    this.doc = doc;
    this.definitions = definitions;
    this.from = doc.lineAt(from).from;
    this.to = doc.lineAt(to).to;
  }

  paint(tree: Tree) {
    tree.iterate({ from: this.from, to: this.to, enter: (ref) => this.#visit(ref.node) });
    return { styles: Decoration.set(this.#styles, true), folds: Decoration.set(this.#folds, true) };
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
      case "ATXHeading6": {
        this.#lines(node.from, node.to, `pg-heading pg-h${node.name.slice(-1)}`);
        for (const mark of node.getChildren("HeaderMark")) {
          // Opening marks take the space after them, closing marks the space before.
          if (mark.from === node.from)
            this.#hide(fold, mark.from, this.#spaceAfter(mark.to, node.to));
          else this.#hide(fold, this.#spaceBefore(mark.from, node.from), mark.to);
        }
        return;
      }
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
        this.#link(node);
        return;
      case "Image": {
        const reference = destination(this.doc, node, this.definitions);
        if (reference === null) return;
        const [open, close] = node.getChildren("LinkMark");
        const alt = plainText(inlinesOf(this.doc, this.definitions, node, open.to, close.from));
        this.#hide(fold, node.from, node.to, new ImageWidget(reference, alt, !this.#alone(node)));
        return false;
      }
      case "Autolink":
        this.#link(node);
        return false;
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
      case "LinkReference":
        // Drawn as blocks, from the state.
        return false;
    }
  }

  /**
   * A link shows its words, and its syntax stays hidden even with the caret inside: the address
   * shows at the caret instead. A reference with no definition is not a link, and is left as written.
   */
  #link(node: SyntaxNode): void {
    const link = linkSpan(this.doc, this.definitions, node);
    if (!link) return;
    const { href } = link;
    this.#style(
      Decoration.mark({ class: "pg-link", attributes: { title: href, "data-href": href } }),
      link.from,
      link.to,
    );
    this.#conceal(node.from, link.from);
    this.#conceal(link.to, node.to);
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
      for (let pos = Math.max(paragraph.from, this.from); pos <= Math.min(paragraph.to, this.to);) {
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

  /** Hides syntax for good, wherever the selection goes. */
  #conceal(from: number, to: number): void {
    if (from < to) this.#replace(this.#styles, from, to);
  }

  #wrap(node: SyntaxNode, className: string, markName: string): void {
    this.#style(Decoration.mark({ class: className }), node.from, node.to);
    const fold = { from: node.from, to: node.to };
    for (const mark of node.getChildren(markName)) this.#hide(fold, mark.from, mark.to);
  }

  #style(decoration: Decoration, from: number, to = from): void {
    this.#styles.push(decoration.range(from, to));
  }

  #hide(fold: Fold, from: number, to: number, widget?: WidgetType): void {
    if (from < to) this.#replace(this.#folds, from, to, fold, widget);
  }

  /**
   * CodeMirror takes no replacement across a line break from a view plugin. So each line's part
   * is replaced on its own, and a line replaced whole, after the first, takes no height.
   */
  #replace(into: Range<Decoration>[], from: number, to: number, fold?: Fold, widget?: WidgetType) {
    let line = this.doc.lineAt(from);
    const end = Math.min(to, line.to);
    if (from < end || widget) into.push(Decoration.replace({ fold, widget }).range(from, end));
    while (to > line.to) {
      line = this.doc.lineAt(line.to + 1);
      const part = Math.min(to, line.to);
      if (line.from < part) into.push(Decoration.replace({ fold }).range(line.from, part));
      if (part === line.to)
        into.push(Decoration.line({ class: "pg-collapsed", fold }).range(line.from));
    }
  }

  #lines(from: number, to: number, className: string): void {
    const decoration = Decoration.line({ class: className });
    for (let pos = Math.max(from, this.from); pos <= Math.min(to, this.to);) {
      const line = this.doc.lineAt(pos);
      this.#styles.push(decoration.range(line.from));
      pos = line.to + 1;
    }
  }

  #foldLine(fold: Fold, pos: number, className: string): void {
    this.#folds.push(Decoration.line({ class: className, fold }).range(this.doc.lineAt(pos).from));
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
