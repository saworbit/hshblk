import { WidgetType, type EditorView } from "@codemirror/view";
import { assetUrl, filePath, isSibling } from "./assets.ts";
import type { Inline } from "./inlines.ts";

export type Align = "left" | "center" | "right" | null;

export type TableModel = { align: Align[]; head: Inline[][]; rows: Inline[][][] };

/** A character an entity names, shown where the entity is written. */
export class TextWidget extends WidgetType {
  readonly text: string;

  constructor(text: string) {
    super();
    this.text = text;
  }

  eq(other: TextWidget): boolean {
    return other.text === this.text;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.textContent = this.text;
    return span;
  }
}

/**
 * A sibling image, or the words meant to stand in for one that may not load. An image in a
 * line of text stays in the line. One alone in its paragraph is a block.
 */
export class ImageWidget extends WidgetType {
  readonly reference: string;
  readonly alt: string;
  readonly inline: boolean;

  constructor(reference: string, alt: string, inline: boolean) {
    super();
    this.reference = reference;
    this.alt = alt;
    this.inline = inline;
  }

  eq(other: ImageWidget): boolean {
    return (
      other.reference === this.reference && other.alt === this.alt && other.inline === this.inline
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const file = filePath(this.reference);
    const url = isSibling(file) ? view.state.facet(assetUrl)(file) : null;
    if (!url) return placeholder("Image not loaded", this.alt, this.inline);
    // CodeMirror puts back a widget's own element if it goes, but leaves what is inside it alone.
    // So a refused image gives way to its placeholder inside a frame that stays.
    const frame = document.createElement("span");
    frame.className = this.inline ? "pg-figure-inline" : "pg-figure";
    const image = frame.appendChild(document.createElement("img"));
    image.className = "pg-image";
    image.alt = this.alt;
    image.addEventListener("error", () =>
      image.replaceWith(placeholder("Image not shown", this.alt, this.inline)),
    );
    image.src = url;
    return frame;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/** A GFM table, drawn until the selection enters it and unfolds the source. */
export class TableWidget extends WidgetType {
  readonly table: TableModel;
  readonly #key: string;

  constructor(table: TableModel) {
    super();
    this.table = table;
    this.#key = JSON.stringify(table);
  }

  eq(other: TableWidget): boolean {
    return other.#key === this.#key;
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "pg-table";
    const table = wrap.appendChild(document.createElement("table"));
    if (this.table.head.length > 0) {
      row(
        table.appendChild(document.createElement("thead")),
        "th",
        this.table.head,
        this.table.align,
      );
    }
    const body = table.appendChild(document.createElement("tbody"));
    for (const cells of this.table.rows) row(body, "td", cells, this.table.align);
    return wrap;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

function row(parent: HTMLElement, tag: "th" | "td", cells: Inline[][], align: Align[]): void {
  const tr = parent.appendChild(document.createElement("tr"));
  cells.forEach((cell, i) => {
    const td = tr.appendChild(document.createElement(tag));
    if (align[i]) td.style.textAlign = align[i];
    td.append(...cell.map(paint));
  });
}

function paint(inline: Inline): Node {
  switch (inline.kind) {
    case "text":
      return document.createTextNode(inline.text);
    case "code":
      return element("code", "pg-code", [document.createTextNode(inline.text)]);
    case "emphasis":
      return element("em", "", inline.children.map(paint));
    case "strong":
      return element("strong", "", inline.children.map(paint));
    case "strikethrough":
      return element("s", "pg-strike", inline.children.map(paint));
    case "link": {
      const link = element("span", "pg-link", inline.children.map(paint));
      link.title = inline.href;
      return link;
    }
  }
}

function element(tag: string, className: string, children: Node[]): HTMLElement {
  const el = document.createElement(tag);
  if (className) el.className = className;
  el.append(...children);
  return el;
}

/** Why an image does not show, and its words. In a line, a chip of its words says why on hover. */
function placeholder(what: string, alt: string, inline: boolean): HTMLElement {
  const span = document.createElement("span");
  const said = `${what} · ${alt || "untitled"}`;
  span.className = inline ? "pg-image-missing pg-image-chip" : "pg-image-missing";
  span.textContent = inline ? alt || "untitled" : said;
  if (inline) span.title = said;
  return span;
}
