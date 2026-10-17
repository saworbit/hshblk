import {
  countColumn,
  type EditorSelection,
  type EditorState,
  type Range,
  type StateCommand,
  StateEffect,
  StateField,
  type Text,
} from "@codemirror/state";
import {
  type Command,
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
import { type Blocks, type Footnote, scanNow } from "./blocks.ts";
import { pageTree, wholeBlocks } from "./complete.ts";
import { highlightCode, loadParser, parserFor } from "./code.ts";
import { emojiOf } from "./emoji.ts";
import { inlinesOf, plainText } from "./inlines.ts";
import { addressTooltip, linkAt, linkSpan, printedAddress } from "./links.ts";
import {
  addressOf,
  destination,
  headings,
  isBareAddress,
  titleOf,
  type Definitions,
} from "./references.ts";
import {
  type Alert,
  AlertWidget,
  ImageWidget,
  NoteMarkWidget,
  NoteReferenceWidget,
  SummaryWidget,
  TaskWidget,
  TextWidget,
  toggleDetails,
  toggleTask,
} from "./widgets.ts";

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
  /** The `<details>` the reader opened or closed, by where each starts. */
  toggled: ReadonlySet<number>;
  /** The task boxes the reader ticked or unticked, by where each marker starts. */
  ticked: ReadonlySet<number>;
  /** Whether the page is printing, which opens every `<details>`. */
  printing: boolean;
  /** Whether the page shows the whole file as written, with no syntax folded. */
  source: boolean;
  /** The blocks' folds, less the ones the opening selection is in, and the details. */
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
  /** The info strings of code blocks whose language's parser has not loaded yet (#217). */
  wanted: ReadonlySet<string>;
};

/** A code block's language has loaded, so the page draws again. */
const codeLoaded = StateEffect.define<null>();

/** The widest hanging indent, in columns. A list item indented further does not hang. */
export const HANG_LIMIT = 24;

/** The deepest quote with a rule of its own. A quote nested further draws as this one. */
export const QUOTE_LIMIT = 6;

/** The blocks in a list item that step in to its text, as its paragraphs hang there (#213). */
const STEPPED = new Set(["FencedCode", "CodeBlock", "Blockquote"]);

/** How long an image's address may be before it opens cut short, and how much of it shows (#204). */
const ADDRESS_LIMIT = 200;
const ADDRESS_KEPT = 40;

/** Folds all the syntax again, as on arrival, until the reader next places a selection. */
export const foldAll = StateEffect.define<null>();

/** Opens every `<details>` while the page prints, and puts them back after. */
export const printing = StateEffect.define<boolean>();

/** Shows every construct's syntax at once, or folds it all again. */
const showSource = StateEffect.define<boolean>();

/**
 * Shows the whole file as written, every construct's syntax in place, links' included, or folds
 * it all again. It is the same text in the same view, so the caret, find, and copy stay put.
 */
export const toggleSource: StateCommand = ({ state, dispatch }) => {
  dispatch(state.update({ effects: showSource.of(!sourceShown(state)) }));
  return true;
};

/**
 * Where the caret starts: the first line after the frontmatter, or the top. The frontmatter
 * folds away, and a caret inside it would open it on the first key.
 */
export function startOfPage(state: EditorState): number {
  const front = state.field(page).blocks.frontmatter;
  if (!front) return 0;
  const after = state.doc.lineAt(front.to).number + 1;
  return after <= state.doc.lines ? state.doc.line(after).from : front.to;
}

/** Whether the page shows the whole file as written. */
export function sourceShown(state: EditorState): boolean {
  return state.field(page).source;
}

/**
 * Opens or closes the `<details>` whose opening tags hold the caret, as a click on its summary
 * does, whether the summary shows or its source. The page is read-only, so Enter is free for it.
 */
export const toggleDetailsAtCaret: StateCommand = ({ state, dispatch }) => {
  const caret = state.selection.main.head;
  const { blocks, source } = state.field(page);
  // With the source shown, the details is its tags, so opening it would show nothing.
  if (source) return false;
  const details = blocks.details.find(
    ({ head }) => head.lines.from <= caret && caret <= head.lines.to,
  );
  if (!details) return false;
  dispatch(state.update({ effects: toggleDetails.of(details.head.source.from) }));
  return true;
};

/**
 * Ticks or unticks the box of the task item whose text holds the selection, as a click on the
 * box does. The box stays drawn while the selection is in the text, so the change shows. On the
 * box's `[ ]` its source shows, and Enter is left to the keymap.
 */
export const toggleTaskAtCaret: StateCommand = ({ state, dispatch }) => {
  const { tree, blocks, source } = state.field(page);
  // With the source shown, the box is its `[ ]`, so ticking it would show nothing.
  if (source) return false;
  const { from, to } = state.selection.main;
  for (let node: SyntaxNode | null = tree.resolveInner(to, -1); node; node = node.parent) {
    if (node.name !== "Task") continue;
    const marker = node.getChild("TaskMarker");
    // Frontmatter is not markdown, so a `[ ]` in it is no box.
    if (!marker || from <= marker.to || node.to <= (blocks.frontmatter?.to ?? -1)) return false;
    dispatch(state.update({ effects: toggleTask.of(marker.from) }));
    return true;
  }
  return false;
};

/**
 * Up or Down, stopping on a table, an HTML block, or a `<details>`' summary, so the keys open its
 * source as Left and Right do. CodeMirror's own motion goes past a block drawn in place of its
 * source. Lines hidden with nothing drawn, such as a definition or a closed body, are still passed.
 */
export function cursorLineOnto(forward: boolean): Command {
  return (view) => {
    const { state } = view;
    const caret = state.selection.main;
    if (!caret.empty) return false;
    const line = state.doc.lineAt(caret.head);
    const target = view.moveVertically(caret, forward).head;
    // Between the caret's line and where CodeMirror would put it. The nearest block wins.
    const low = forward ? line.to + 1 : target;
    const high = forward ? target : line.from - 1;
    let stop: number | undefined;
    for (const at = state.field(page).shown.iter(low); at.value && at.from <= high; at.next()) {
      const { widget, block } = at.value.spec;
      const fold: Fold = at.value.spec.fold;
      const edge = forward ? at.from : at.to;
      if (!widget || !block || edge < low || edge > high) continue;
      stop = forward ? fold.from : fold.to;
      if (forward) break;
    }
    if (stop === undefined) return false;
    view.dispatch({ selection: { anchor: stop }, scrollIntoView: true, userEvent: "select" });
    return true;
  };
}

/**
 * A large file holds more inline syntax than the window can decorate between two frames. So it
 * is drawn for the viewport only, and again as the viewport moves.
 */
const painter = ViewPlugin.fromClass(
  class {
    painted: Painted;
    readonly #view: EditorView;
    /** The languages asked for, each once. */
    readonly #asked = new Set<string>();
    #gone = false;

    constructor(view: EditorView) {
      this.#view = view;
      this.painted = paint(view.state, view.viewport);
      this.#load();
    }

    update(update: ViewUpdate) {
      const before = update.startState.field(page);
      const now = update.state.field(page);
      const repaint = now.tree !== before.tree || now.blocks !== before.blocks;
      const redraw = now.ticked !== before.ticked || now.source !== before.source;
      const loaded = update.transactions.some((tr) => tr.effects.some((e) => e.is(codeLoaded)));
      if (update.viewportChanged || repaint || redraw || loaded) {
        this.painted = paint(update.state, update.view.viewport);
        this.#load();
      } else if (now.opening !== before.opening && !now.source) {
        this.painted = { ...this.painted, shown: unfold(this.painted.folds, now.opening) };
      }
    }

    destroy() {
      this.#gone = true;
    }

    /** Loads each language a code block in view names, and draws again once it is there. */
    #load() {
      for (const info of this.painted.wanted) {
        if (this.#asked.has(info)) continue;
        this.#asked.add(info);
        void loadParser(info).then(
          () => this.#gone || this.#view.dispatch({ effects: codeLoaded.of(null) }),
          (error: unknown) => console.warn(`A code block's language did not load: ${error}`),
        );
      }
    }
  },
);

/**
 * docs/hld.md §7: the presentation layer, as decorations over the source. The state holds what
 * needs every line, and `painter` draws the rest near the viewport.
 */
export const page = StateField.define<Page>({
  create: (state) => build(state, null, null, new Set(), new Set(), false, false),
  update(current, tr) {
    const folded = tr.effects.some((effect) => effect.is(foldAll));
    const selected = tr.selection && tr.isUserEvent("select");
    // The file's new text moves what the reader had selected with it (#199).
    const kept = (selection: EditorSelection | null) =>
      selection && tr.docChanged ? selection.map(tr.changes) : selection;
    const active = folded ? null : selected ? tr.state.selection : kept(current.active);
    const pointer = tr.isUserEvent("select.pointer");
    const opening = folded ? null : selected ? (pointer ? null : active) : kept(current.opening);
    let toggled = current.toggled;
    let ticked = current.ticked;
    let printed = current.printing;
    let source = current.source;
    const flip = (set: ReadonlySet<number>, from: number) => {
      const next = new Set(set);
      if (!next.delete(from)) next.add(from);
      return next;
    };
    for (const effect of tr.effects) {
      if (effect.is(toggleDetails)) toggled = flip(toggled, effect.value);
      else if (effect.is(toggleTask)) ticked = flip(ticked, effect.value);
      else if (effect.is(printing)) printed = effect.value;
      else if (effect.is(showSource)) source = effect.value;
    }
    if (tr.docChanged) {
      toggled = new Set([...toggled].map((from) => tr.changes.mapPos(from)));
      ticked = new Set([...ticked].map((from) => tr.changes.mapPos(from)));
    }
    if (tr.docChanged || pageTree(tr.state) !== current.tree) {
      return build(tr.state, active, opening, toggled, ticked, printed, source);
    }
    const same =
      active === current.active &&
      opening === current.opening &&
      toggled === current.toggled &&
      ticked === current.ticked &&
      printed === current.printing &&
      source === current.source;
    if (same) return current;
    const shown = draw(current.blocks, opening, toggled, printed, source);
    return { ...current, active, opening, toggled, ticked, printing: printed, source, shown };
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
  toggled: ReadonlySet<number>,
  ticked: ReadonlySet<number>,
  printing: boolean,
  source: boolean,
): Page {
  const tree = pageTree(state);
  // Until the whole document is parsed, the tree is only as long as CodeMirror has read.
  const blocks = wholeBlocks(state) ?? scanNow(state.doc, tree);
  const shown = draw(blocks, opening, toggled, printing, source);
  return { tree, blocks, active, opening, toggled, ticked, printing, source, shown };
}

/**
 * The blocks as drawn: their folds, less the ones the opening selection is in, and each
 * `<details>` as its summary, its body folded while it is closed. Find or the keys in a closed
 * body open it while they are there, and print opens them all. With the source shown, none is.
 */
function draw(
  blocks: Blocks,
  opening: EditorSelection | null,
  toggled: ReadonlySet<number>,
  printing: boolean,
  source: boolean,
): DecorationSet {
  if (source) return Decoration.none;
  const folds = unfold(blocks.folds, opening);
  const { frontmatter } = blocks;
  if (blocks.details.length === 0 && blocks.aligned.length === 0 && !frontmatter) return folds;
  const reached = (span: Fold) =>
    opening?.ranges.some((range) => range.from <= span.to && range.to >= span.from) ?? false;
  const add: Range<Decoration>[] = [];
  // The frontmatter folds away. The status line's indicator says it is there, and its panel
  // shows it. The keys and find show its source where they reach it.
  if (frontmatter && !reached(frontmatter)) {
    add.push(Decoration.replace({ block: true }).range(frontmatter.from, frontmatter.to));
  }
  for (const { summary, open, head, body, tail } of blocks.details) {
    const from = head.source.from;
    const shown = printing || open !== toggled.has(from) || (body !== null && reached(body));
    if (!reached(head.source)) {
      const widget = new SummaryWidget(summary, from, shown);
      const fold = head.source;
      add.push(
        Decoration.replace({ widget, block: true, fold }).range(head.lines.from, head.lines.to),
      );
    }
    if (body && !shown) add.push(Decoration.replace({ block: true }).range(body.from, body.to));
    if (!reached(tail.source)) {
      add.push(Decoration.replace({ block: true }).range(tail.lines.from, tail.lines.to));
    }
  }
  // #225: a `<div align>` or a `<p align>` around markdown aligns it, and its tags fold away.
  for (const { align, head, starts, tail } of blocks.aligned) {
    for (const tag of [head, tail]) {
      if (reached(tag.source)) continue;
      add.push(Decoration.replace({ block: true }).range(tag.lines.from, tag.lines.to));
    }
    const line = Decoration.line({ class: `pg-align-${align}` });
    for (const start of starts) add.push(line.range(start));
  }
  return folds.update({ add, sort: true });
}

/** The inline syntax from `from` to `to`, whole lines, drawn from the page's tree. */
export function paint(state: EditorState, { from, to }: { from: number; to: number }): Painted {
  const { tree, blocks, opening, ticked, source } = state.field(page);
  const skip = blocks.frontmatter?.to ?? -1;
  const painter = new Painter(state.doc, blocks, ticked, skip, source, from, to);
  const { styles, folds } = painter.paint(tree);
  const shown = source ? Decoration.none : unfold(folds, opening);
  return { styles, folds, shown, wanted: painter.wanted };
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

/** A heading's line, to a screen reader: a heading of its level (#157). */
function heading(node: SyntaxNode): Record<string, string> {
  return { role: "heading", "aria-level": node.name.slice(-1) };
}

/** An alert's marker, alone on the first line of a quote. GitHub takes it in any case. */
const ALERT_MARKER = /^\[!(note|tip|important|warning|caution)\][ \t]*$/i;

/**
 * #219: the alert a quote is, as GitHub draws `> [!NOTE]` and its four siblings, and where its
 * marker is. A quote in a quote is not one, and neither is a marker with words after it.
 */
function alertOf(doc: Text, quote: SyntaxNode): (Fold & { kind: Alert }) | null {
  const first = quote.getChild("Paragraph");
  if (!first || quote.parent?.name !== "Document") return null;
  const line = doc.lineAt(first.from);
  const match = ALERT_MARKER.exec(doc.sliceString(first.from, line.to));
  if (!match) return null;
  // GitHub draws an alert only with a body: more of its paragraph, or a block after it (#316).
  let body = first.to > line.to;
  for (let next = first.nextSibling; next && !body; next = next.nextSibling) {
    body = next.name !== "QuoteMark";
  }
  if (!body) return null;
  const kind = match[1].toLowerCase() as Alert;
  return { kind, from: first.from, to: first.from + match[0].trimEnd().length };
}

/**
 * Walks the tree between two points, writing a class for each construct and a fold for its
 * syntax. A construct that runs past them is drawn only as far as they go.
 */
class Painter {
  readonly doc: Text;
  readonly definitions: Definitions;
  /** Each footnote a reference uses, by label, and by where each starts (#218). */
  readonly footnotes: ReadonlyMap<string, Footnote>;
  readonly #notes = new Map<number, [string, Footnote]>();
  /** The task boxes the reader ticked or unticked. */
  readonly ticked: ReadonlySet<number>;
  /** Where the frontmatter ends. It shows as written, and nothing in it is markdown. */
  readonly skip: number;
  /** Whether the page shows the whole file as written, so no syntax is concealed. */
  readonly source: boolean;
  /** The start of the first line drawn. */
  readonly from: number;
  /** The end of the last line drawn. */
  readonly to: number;
  readonly #styles: Range<Decoration>[] = [];
  readonly #folds: Range<Decoration>[] = [];
  /** The info strings of code blocks whose language's parser has not loaded yet. */
  readonly wanted = new Set<string>();
  /** The markers drawn in a hanging item's box, which styles them. */
  readonly #hung = new Set<number>();

  constructor(
    doc: Text,
    blocks: Pick<Blocks, "definitions" | "footnotes">,
    ticked: ReadonlySet<number>,
    skip: number,
    source: boolean,
    from: number,
    to: number,
  ) {
    this.doc = doc;
    this.definitions = blocks.definitions;
    this.footnotes = blocks.footnotes;
    for (const [label, note] of blocks.footnotes) this.#notes.set(note.from, [label, note]);
    this.ticked = ticked;
    this.skip = skip;
    this.source = source;
    this.from = doc.lineAt(from).from;
    this.to = doc.lineAt(to).to;
  }

  paint(tree: Tree) {
    if (this.skip >= 0) this.#lines(0, this.skip, "pg-code-block pg-frontmatter");
    tree.iterate({
      from: this.from,
      to: this.to,
      enter: (ref) => (ref.to <= this.skip ? false : this.#visit(ref.node)),
    });
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
        this.#lines(node.from, node.to, `pg-heading pg-h${node.name.slice(-1)}`, heading(node));
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
        this.#lines(node.from, end, `pg-heading pg-h${node.name.slice(-1)}`, heading(node));
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
        this.#codePadding(node, fold);
        return false;
      case "Link":
        if (this.#noteReference(node)) return false;
        this.#link(node);
        return;
      case "Footnote":
        this.#note(node);
        return;
      case "Image": {
        const reference = destination(this.doc, node, this.definitions);
        if (reference === null) return;
        const [open, close] = node.getChildren("LinkMark");
        const alt = plainText(inlinesOf(this.doc, this.definitions, node, open.to, close.from));
        const title = titleOf(this.doc, node, this.definitions);
        const image = new ImageWidget(reference, alt, !this.#alone(node), title);
        this.#hide(fold, node.from, node.to, image);
        this.#cutAddress(node);
        return false;
      }
      case "Autolink":
        this.#link(node);
        return false;
      case "URL":
        // #201: a bare address, as GFM links it. A link's own URL is drawn by the link.
        if (isBareAddress(node)) this.#link(node);
        return false;
      case "Escape":
        this.#hide(fold, node.from, node.from + 1);
        return false;
      case "Emoji": {
        // #222: a shortcode GitHub knows shows its emoji. The keys and find show it as written.
        const emoji = emojiOf(this.#slice(node).slice(1, -1));
        if (emoji) this.#hide(fold, node.from, node.to, new TextWidget(emoji));
        return false;
      }
      case "Comment": {
        // #224: a comment in a line is written not to be seen. A space before it goes with it,
        // when a space or the line's end follows, so the words around it keep one between them.
        const before = this.doc.sliceString(node.from - 1, node.from) === " ";
        const after = this.doc.sliceString(node.to, node.to + 1);
        const spaced = before && (after === " " || after === "\n" || node.to === this.doc.length);
        this.#hide(fold, spaced ? node.from - 1 : node.from, node.to);
        return false;
      }
      case "Entity":
        this.#hide(fold, node.from, node.to, new TextWidget(decodeHTML(this.#slice(node))));
        return false;
      case "HardBreak":
        if (this.#slice(node).startsWith("\\")) this.#hide(fold, node.from, node.from + 1);
        return false;
      case "Blockquote": {
        // The outer quote marks every line. A quote inside it adds its level, which draws a rule.
        let depth = 1;
        for (let up = node.parent; up; up = up.parent) if (up.name === "Blockquote") depth++;
        const alert = depth === 1 ? alertOf(this.doc, node) : null;
        if (alert) {
          this.#lines(node.from, node.to, `pg-quote pg-alert pg-alert-${alert.kind}`);
          this.#hide(alert, alert.from, alert.to, new AlertWidget(alert.kind));
          return;
        }
        this.#lines(
          node.from,
          node.to,
          depth > 1 ? `pg-quote-${Math.min(depth, QUOTE_LIMIT)}` : "pg-quote",
        );
        return;
      }
      case "QuoteMark":
        this.#quoteMark(node);
        return false;
      case "ListItem":
        this.#hang(node);
        return;
      case "TaskMarker": {
        // `[x]` and `[X]` are ticked, as GFM reads them.
        const written = this.#slice(node) !== "[ ]";
        const box = new TaskWidget(node.from, written !== this.ticked.has(node.from));
        // #212: a bullet's task shows its box where the bullet was, as GitHub draws it, as wide
        // as the bullet and its spaces, and its `[ ]` folds away with the space after it. Both
        // open together. A number stays, and its box takes the place of its `[ ]`.
        const item = node.parent?.parent;
        const bullet = item?.parent?.name === "BulletList" ? item.getChild("ListMark") : null;
        if (!bullet) {
          this.#hide(fold, node.from, node.to, box);
          return false;
        }
        const line = this.doc.lineAt(node.from);
        const column = (pos: number) => countColumn(this.doc.sliceString(line.from, pos), 4);
        const columns = Math.min(column(node.from) - column(bullet.from), HANG_LIMIT);
        const both = { from: bullet.from, to: node.to };
        this.#hide(both, bullet.from, node.from, new TaskWidget(box.from, box.checked, columns));
        this.#hide(both, node.from, this.#spaceAfter(node.to, line.to, 1));
        return false;
      }
      case "ListMark":
        if (!this.#hung.has(node.from))
          this.#style(Decoration.mark({ class: "pg-list-mark" }), node.from, node.to);
        return false;
      case "FencedCode":
        this.#lines(node.from, node.to, "pg-code-block");
        this.#highlight(node);
        this.#fences(node);
        this.#quoteMarks(node);
        return false;
      case "CodeBlock":
        this.#lines(node.from, node.to, "pg-code-block");
        this.#quoteMarks(node);
        this.#codeIndent(node);
        return false;
      case "HTMLBlock":
      case "CommentBlock":
      case "ProcessingInstructionBlock":
        this.#lines(node.from, node.to, "pg-source-block");
        this.#quoteMarks(node);
        return false;
      case "HorizontalRule":
        this.#foldLine(fold, node.from, "pg-rule");
        this.#hide(fold, node.from, node.to);
        return false;
      case "LinkReference":
        // A definition is drawn as a block, from the state.
        this.#quoteMarks(node);
        return false;
      case "Table":
        // Drawn as a block, from the state. Its source shows when the selection opens it.
        this.#quoteMarks(node);
        return false;
    }
  }

  /**
   * #218: a reference to a footnote shows its number, raised. Its source shows when the keys or
   * find reach it. A footnote's own opening is drawn by `#note`, not here.
   */
  #noteReference(node: SyntaxNode): boolean {
    const label = /^\[\^([^\]\s]+)\]$/.exec(this.#slice(node))?.[1].toLowerCase();
    const note = label === undefined ? undefined : this.footnotes.get(label);
    if (!label || !note) return false;
    const widget = new NoteReferenceWidget(label, note.number, note.text);
    this.#hide({ from: node.from, to: node.to }, node.from, node.to, widget);
    return true;
  }

  /**
   * #218: a footnote, `[^1]: Its words.`, shows its number in place of its opening, small and
   * quiet, and a way back to its first reference after its words. The first has a rule above
   * it, as GitHub sets its footnotes apart. Its opening shows when the keys or find reach it.
   * The blocks it runs on to are indented under it, and their indent folds away a line at a
   * time, as a list item's does (#284).
   */
  #note(node: SyntaxNode): void {
    const [label, note] = this.#notes.get(node.from) ?? [];
    if (!label || !note) return;
    const opening = { from: node.from, to: note.words - 1 };
    this.#hide(opening, node.from, note.words, new NoteMarkWidget(label, note.number));
    const back = new NoteMarkWidget(label, null);
    this.#folds.push(Decoration.widget({ widget: back, side: 1, fold: opening }).range(note.to));
    this.#lines(node.from, note.to, note.first ? "pg-note pg-note-first" : "pg-note");
    const after = this.doc.lineAt(node.from).to + 1;
    for (let pos = Math.max(after, this.from); pos <= Math.min(note.to, this.to); ) {
      const line = this.doc.lineAt(pos);
      pos = line.to + 1;
      const column = (to: number) => countColumn(this.doc.sliceString(line.from, to), 4);
      let end = line.from;
      while (end < line.to && /[ \t]/.test(line.text[end - line.from]) && column(end + 1) <= 4) {
        end += 1;
      }
      this.#hide({ from: line.from, to: line.to }, line.from, end);
    }
  }

  /**
   * #217: a fenced block that names a language the page knows has its tokens coloured, as far
   * as the lines drawn. In a quote its lines carry the quote's marks, which the language would
   * misread, so there it stays one colour.
   */
  #highlight(block: SyntaxNode): void {
    const info = block.getChild("CodeInfo");
    const text = block.getChild("CodeText");
    if (!info || !text) return;
    for (let up = block.parent; up; up = up.parent) if (up.name === "Blockquote") return;
    const named = this.#slice(info);
    const parser = parserFor(named);
    if (parser === "loading") this.wanted.add(named);
    if (!parser || parser === "loading") return;
    const from = Math.max(this.from - text.from, 0);
    const to = Math.min(this.to, text.to) - text.from;
    highlightCode(parser, this.#slice(text), from, to, (start, end, classes) =>
      this.#style(Decoration.mark({ class: classes }), text.from + start, text.from + end),
    );
  }

  /**
   * #215: a fenced block's fences fold away, as other syntax does, until the keys or find reach
   * one, when it shows muted. Meanwhile the block's first and last lines take the room the fences
   * gave, and the info string's first word, its language, is a quiet label at its top right. A
   * block with nothing between its fences keeps its first as an empty line.
   */
  #fences(block: SyntaxNode): void {
    const open = this.doc.lineAt(block.from);
    const mark = block.lastChild;
    const close =
      mark?.name === "CodeMark" && mark.from > open.to ? this.doc.lineAt(mark.from) : null;
    const opening = { from: open.from, to: open.to };
    const closing = close && { from: close.from, to: close.to };
    for (const fence of [opening, closing]) {
      if (fence) this.#lines(fence.from, fence.from, "pg-fence");
    }
    const text = block.getChild("CodeText");
    const first = text ? this.doc.lineAt(text.from) : open;
    const last = text ? this.doc.lineAt(text.to) : open;
    const info = block.getChild("CodeInfo");
    const language = info && this.#slice(info).split(/\s/)[0];
    const attributes = language ? { "data-language": language } : undefined;
    // Only the lines asked for are drawn, as a block can run past them.
    const drawn = (pos: number) => this.from <= pos && pos <= this.to;
    if (drawn(open.from)) this.#hide(opening, open.from, open.to);
    if (text) this.#foldLine(opening, open.from, "pg-collapsed");
    this.#foldLine(opening, first.from, "pg-code-first", attributes);
    if (!closing) return;
    if (drawn(close.from)) this.#hide(closing, close.from, close.to);
    this.#foldLine(closing, close.from, "pg-collapsed");
    this.#foldLine(closing, last.from, "pg-code-last");
  }

  /** A quote's mark, and the space after it, hidden while the selection is off its line. */
  #quoteMark(mark: SyntaxNode): void {
    const line = this.doc.lineAt(mark.from);
    this.#hide({ from: line.from, to: line.to }, mark.from, this.#spaceAfter(mark.to, line.to, 1));
  }

  /**
   * An indented code block's four columns of indent are syntax, as CommonMark reads them, so its
   * text starts where a fenced block's does (#216). Each line's shows while the selection is on it,
   * as a quote's marks do. A list item's or a quote's own indent stays.
   */
  #codeIndent(block: SyntaxNode): void {
    const first = block.childAfter(Math.max(block.from, this.from));
    for (let text = first; text && text.from <= this.to; text = text.nextSibling) {
      if (text.name !== "CodeText") continue;
      const line = this.doc.lineAt(text.from);
      const column = (pos: number) => countColumn(this.doc.sliceString(line.from, pos), 4);
      const start = column(text.from) - 4;
      let from = text.from;
      while (from > line.from && /[ \t]/.test(this.doc.sliceString(from - 1, from))) {
        if (column(from - 1) < start) break;
        from -= 1;
      }
      this.#hide({ from: line.from, to: line.to }, from, text.from);
    }
  }

  /** The quote marks inside a construct whose children are not decorated one by one. */
  #quoteMarks(node: SyntaxNode): void {
    const cursor = node.cursor();
    while (cursor.next() && cursor.from < node.to) {
      if (cursor.name === "QuoteMark") this.#quoteMark(cursor.node);
    }
  }

  /**
   * A link shows its words, and its syntax stays hidden even with the caret inside: the address
   * shows at the caret instead. A reference with no definition is not a link, and is left as written.
   * A link with no words shows nothing, as on GitHub. CodeMirror takes no empty mark (#151).
   */
  #link(node: SyntaxNode): void {
    const link = linkSpan(this.doc, this.definitions, node);
    if (!link) return;
    const { href } = link;
    // A hover shows the link's title, as on GitHub, or its address when it has none (#229).
    const title = (node.name === "Link" && titleOf(this.doc, node, this.definitions)) || href;
    if (link.from < link.to) {
      // Print shows the address after the words, since paper has no popover (#237).
      const printed = printedAddress(href, this.doc.sliceString(link.from, link.to));
      // To a screen reader, a link (#157).
      const attributes: Record<string, string> = { title, "data-href": href, role: "link" };
      if (printed) attributes["data-print"] = printed;
      this.#style(Decoration.mark({ class: "pg-link", attributes }), link.from, link.to);
    }
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
    // A task item's first paragraph is a Task, which holds its box.
    const first = item.getChild("Task") ?? item.getChild("Paragraph");
    // A quote's marks are hidden, so they take no columns. Its items stay as they were.
    for (let up = item.parent; up; up = up.parent) if (up.name === "Blockquote") return;
    if (!mark || !first) return;
    const column = (from: number, to: number) => countColumn(this.doc.sliceString(from, to), 4);
    const text = column(this.doc.lineAt(first.from).from, first.from);
    if (text < 1 || text > HANG_LIMIT) return;
    const box = (from: number, to: number, width: number, className = "") =>
      this.#style(Decoration.mark({ class: `${className} pg-box-${width}`.trim() }), from, to);
    for (const paragraph of [...item.getChildren("Task"), ...item.getChildren("Paragraph")]) {
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
    // #213: a code block or a quote in the item starts where its text does, not at the page's
    // edge, its background and its rule too. Its lines step in by the item's columns, and the
    // indent that puts them in the item folds away a line at a time, as a quote's marks do.
    if (this.source) return;
    for (let block = item.firstChild; block; block = block.nextSibling) {
      if (!STEPPED.has(block.name)) continue;
      for (let pos = Math.max(block.from, this.from); pos <= Math.min(block.to, this.to);) {
        const line = this.doc.lineAt(pos);
        pos = line.to + 1;
        this.#lines(line.from, line.from, `pg-in-${text}`);
        let end = line.from;
        while (end < line.to && /[ \t]/.test(this.doc.sliceString(end, end + 1))) {
          if (column(line.from, end + 1) > text) break;
          end += 1;
        }
        this.#hide({ from: line.from, to: line.to }, line.from, end);
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
    // In a list item it stays beside the marker, as on GitHub, not below it (#214). In a
    // footnote, beside its number.
    return (
      block?.name === "Paragraph" &&
      block.parent?.name !== "ListItem" &&
      block.parent?.name !== "Footnote" &&
      !this.doc.sliceString(block.from, top.from).trim() &&
      !this.doc.sliceString(top.to, block.to).trim()
    );
  }

  /** Hides syntax for good, wherever the selection goes, unless the source shows. */
  #conceal(from: number, to: number): void {
    if (from < to && !this.source) this.#replace(this.#styles, from, to);
  }

  /**
   * #204: an image's address too long to read, as an embedded data: image's is, shows its start
   * and an ellipsis when its syntax opens, with the keys, find, or Ctrl+/. Drawn whole, 2 MB of
   * base64 held the window for seconds. Copy still takes it all.
   */
  #cutAddress(image: SyntaxNode): void {
    const url = addressOf(this.doc, image);
    if (!url || url.to - url.from <= ADDRESS_LIMIT) return;
    const line = this.doc.lineAt(url.from);
    const from = url.from + ADDRESS_KEPT;
    this.#replace(this.#styles, from, Math.min(url.to, line.to), undefined, new TextWidget("…"));
  }

  /**
   * CommonMark takes one space off each end of a code span when both ends have one and it is not
   * all spaces, so a backtick can sit at its edge (#210). A line break at an end stays a break.
   */
  #codePadding(node: SyntaxNode, fold: Fold): void {
    const open = node.firstChild?.to ?? node.from;
    const close = node.lastChild?.from ?? node.to;
    const content = this.doc.sliceString(open, close).replace(/\n/g, " ");
    if (!/^ .*[^ ].* $/s.test(content)) return;
    if (this.doc.sliceString(open, open + 1) === " ") this.#hide(fold, open, open + 1);
    if (this.doc.sliceString(close - 1, close) === " ") this.#hide(fold, close - 1, close);
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

  #lines(from: number, to: number, className: string, attributes?: Record<string, string>) {
    const decoration = Decoration.line({ class: className, attributes });
    for (let pos = Math.max(from, this.from); pos <= Math.min(to, this.to);) {
      const line = this.doc.lineAt(pos);
      this.#styles.push(decoration.range(line.from));
      pos = line.to + 1;
    }
  }

  #foldLine(fold: Fold, pos: number, className: string, attributes?: Record<string, string>) {
    if (pos < this.from || pos > this.to) return;
    const line = Decoration.line({ class: className, attributes, fold });
    this.#folds.push(line.range(this.doc.lineAt(pos).from));
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
