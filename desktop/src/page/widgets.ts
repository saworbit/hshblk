import { EditorView, WidgetType } from "@codemirror/view";
import { assetUrl, filePath, isLocal } from "./assets.ts";
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
 * An image in the repository, or the words meant to stand in for one that may not load. An image
 * in a line of text stays in the line. One alone in its paragraph is a block.
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
    const url = isLocal(file) ? view.state.facet(assetUrl)(file) : null;
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

/** A GFM table, drawn until the keys or find enter it and open its source. */
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

/** The height each HTML block last took, so its frame, drawn again, starts there. */
const htmlHeights = new Map<string, number>();

/** What measures a frame as its content changes, to let go of when the frame goes. */
const fitting = new WeakMap<HTMLElement, ResizeObserver>();

/**
 * docs/hld.md §7: a raw HTML block, drawn in a sandboxed frame. The frame shares the page's
 * origin, so the page can size it to what it holds, and it never runs script. Its policy fetches
 * nothing the HTML names.
 */
export class HtmlWidget extends WidgetType {
  readonly html: string;

  constructor(html: string) {
    super();
    this.html = html;
  }

  eq(other: HtmlWidget): boolean {
    return other.html === this.html;
  }

  get estimatedHeight(): number {
    return htmlHeights.get(this.html) ?? -1;
  }

  toDOM(view: EditorView): HTMLElement {
    const frame = document.createElement("iframe");
    frame.className = "pg-html";
    // No allow-scripts, so nothing in the frame runs. The same origin lets the page measure it.
    frame.setAttribute("sandbox", "allow-same-origin");
    frame.title = "HTML";
    const height = htmlHeights.get(this.html);
    if (height !== undefined) frame.style.height = `${height}px`;
    frame.srcdoc = framed(this.html, view);
    frame.addEventListener("load", () => this.#fit(frame, view));
    return frame;
  }

  destroy(dom: HTMLElement): void {
    fitting.get(dom)?.disconnect();
  }

  #fit(frame: HTMLIFrameElement, view: EditorView): void {
    const body = frame.contentDocument?.body;
    const root = frame.contentDocument?.documentElement;
    if (!body || !root) return;
    // The page's size is read once it shows. The first frames are made before it does.
    const text = getComputedStyle(view.contentDOM);
    body.style.fontSize = text.fontSize;
    body.style.lineHeight = text.lineHeight;
    const fit = () => {
      const height = Math.ceil(root.getBoundingClientRect().height);
      htmlHeights.set(this.html, height);
      if (frame.style.height === `${height}px`) return;
      frame.style.height = `${height}px`;
      view.requestMeasure();
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(root);
    fitting.set(frame, observer);
  }
}

/**
 * The frame's document. Its policy loads the page's own fonts and nothing else, and refuses the
 * HTML's styles. Its faces are the page's: the fonts and colours are copied from the page.
 */
function framed(html: string, view: EditorView): string {
  const nonce = view.state.facet(EditorView.cspNonce);
  const styles = nonce ? `'nonce-${nonce}'` : "'none'";
  const policy = `default-src 'none'; style-src ${styles}; font-src 'self'; base-uri 'none'; form-action 'none'`;
  // The blank lines around the block space it, as they space the page's paragraphs.
  const faces = `html, body { margin: 0; background: transparent; }
body > :first-child { margin-top: 0; }
body > :last-child { margin-bottom: 0; }
body { color: var(--ink); font-family: var(--serif); overflow-wrap: break-word; }
a { color: var(--accent); }
code, kbd, pre, samp { font-family: var(--mono); font-size: 0.86em; }
img { max-width: 100%; }`;
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${policy}">` +
    '<meta http-equiv="x-dns-prefetch-control" content="off">' +
    `<style nonce="${nonce}">${pageRules()}${faces}</style>` +
    `</head><body>${html}</body></html>`
  );
}

/** The page's fonts, and its colour variables by day, by night, and in print. */
function pageRules(): string {
  const copy = (rules: CSSRuleList): string =>
    [...rules]
      .map((rule) => {
        if (rule instanceof CSSFontFaceRule) return rule.cssText;
        if (rule instanceof CSSStyleRule && rule.selectorText === ":root") return rule.cssText;
        if (rule instanceof CSSMediaRule) {
          const inner = copy(rule.cssRules);
          return inner && `@media ${rule.media.mediaText} { ${inner} }`;
        }
        return "";
      })
      .join("\n");
  return [...document.styleSheets].map((sheet) => copy(sheet.cssRules)).join("\n");
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
      link.dataset.href = inline.href;
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
