import { type Extension, StateEffect, StateField } from "@codemirror/state";
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

/** Opens or closes the `<details>` whose opening block starts here. */
export const toggleDetails = StateEffect.define<number>();

/**
 * docs/hld.md §7: a `<details>` whose body is markdown, drawn as its summary. A click, or Enter
 * with the caret on its tags, opens or closes it. The page folds the body's lines while it is
 * closed.
 */
export class SummaryWidget extends WidgetType {
  /** The summary's HTML, as written. */
  readonly summary: string;
  /** Where the details' opening block starts, which names it. */
  readonly from: number;
  readonly open: boolean;

  constructor(summary: string, from: number, open: boolean) {
    super();
    this.summary = summary;
    this.from = from;
    this.open = open;
  }

  eq(other: SummaryWidget): boolean {
    return other.summary === this.summary && other.from === this.from && other.open === this.open;
  }

  toDOM(view: EditorView): HTMLElement {
    const summary = document.createElement("div");
    summary.className = this.open ? "pg-summary pg-summary-open" : "pg-summary";
    summary.setAttribute("role", "button");
    summary.setAttribute("aria-expanded", String(this.open));
    // Its words, as a browser shows them. A parsed document runs nothing and fetches nothing.
    const words = new DOMParser().parseFromString(this.summary, "text/html").body.textContent;
    summary.textContent = words?.replace(/\s+/g, " ").trim() || "Details";
    // The press would move the caret first. Opening the details leaves it where it was.
    summary.addEventListener("mousedown", (event) => event.preventDefault());
    summary.addEventListener("click", () =>
      view.dispatch({ effects: toggleDetails.of(this.from) }),
    );
    return summary;
  }
}

/** Ticks or unticks, on the page only, the task box whose marker starts here. */
export const toggleTask = StateEffect.define<number>();

/**
 * docs/hld.md §7: a task list item's box, ticked as the file has it. A click ticks or unticks it
 * on the page. The file keeps what it says.
 */
export class TaskWidget extends WidgetType {
  /** Where the box's `[ ]` starts, which names it. */
  readonly from: number;
  readonly checked: boolean;

  constructor(from: number, checked: boolean) {
    super();
    this.from = from;
    this.checked = checked;
  }

  eq(other: TaskWidget): boolean {
    return other.from === this.from && other.checked === this.checked;
  }

  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement("span");
    box.className = this.checked ? "pg-task pg-task-ticked" : "pg-task";
    box.setAttribute("role", "checkbox");
    box.setAttribute("aria-checked", String(this.checked));
    // The press would move the caret first. Ticking the box leaves it where it was.
    box.addEventListener("mousedown", (event) => event.preventDefault());
    box.addEventListener("click", () => view.dispatch({ effects: toggleTask.of(this.from) }));
    return box;
  }
}

/** The height each HTML block last took, so its frame, drawn again, starts there. */
const htmlHeights = new Map<string, number>();

/** What measures a frame as its content changes, to let go of when the frame goes. */
const fitting = new WeakMap<HTMLElement, ResizeObserver>();

/**
 * docs/hld.md §7: a raw HTML block, drawn in a sandboxed frame. The frame shares the page's
 * origin, so the page can size it to what it holds and read what is under the pointer, and it
 * never runs script. Its policy fetches nothing the HTML names but images in the repository.
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
    frame.addEventListener("load", () => {
      this.#fit(frame, view);
      retoggle(frame, view);
    });
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
 * What is under a point in an HTML block's frame, read from the page. The page takes the pointer
 * over a frame (theme.ts), and shares its origin, so it reads the frame's document without
 * running anything in it.
 */
export function htmlAt(view: EditorView, x: number, y: number): Element | null {
  for (const frame of view.contentDOM.querySelectorAll<HTMLIFrameElement>("iframe.pg-html")) {
    const box = frame.getBoundingClientRect();
    if (x < box.left || x >= box.right || y < box.top || y >= box.bottom) continue;
    const left = box.left + frame.clientLeft;
    const top = box.top + frame.clientTop;
    return frame.contentDocument?.elementFromPoint(x - left, y - top) ?? null;
  }
  return null;
}

/** A `<details>` in an HTML block: where the block starts, and which of its details it is. */
type FrameDetails = { pos: number; index: number };

/** Opens or closes a `<details>` in an HTML block's frame. */
const toggleFrameDetails = StateEffect.define<FrameDetails>();

/**
 * The details in HTML blocks the reader opened or closed, by where each block starts, as the page
 * keeps `toggled` for a details around markdown. A frame drawn again starts as written, so it
 * takes these back when it loads.
 */
const frameToggled = StateField.define<ReadonlyMap<number, ReadonlySet<number>>>({
  create: () => new Map(),
  update(toggled, tr) {
    let next = tr.docChanged
      ? new Map([...toggled].map(([pos, indexes]) => [tr.changes.mapPos(pos), indexes]))
      : toggled;
    for (const effect of tr.effects) {
      if (!effect.is(toggleFrameDetails)) continue;
      const { pos, index } = effect.value;
      const indexes = new Set(next.get(pos));
      if (!indexes.delete(index)) indexes.add(index);
      next = new Map(next).set(pos, indexes);
    }
    return next;
  },
});

/** Opens or closes again the details in a frame that the reader toggled before it was drawn. */
function retoggle(frame: HTMLIFrameElement, view: EditorView): void {
  const toggled = view.state.field(frameToggled, false);
  if (!toggled?.size) return;
  const indexes = toggled.get(view.posAtDOM(frame)) ?? [];
  const details = frame.contentDocument?.querySelectorAll("details");
  for (const index of indexes) {
    const one = details?.[index];
    if (one) one.open = !one.open;
  }
}

/**
 * A click on a summary in an HTML block opens or closes its details, as the frame would if it
 * had the pointer. The page keeps which, so the frame drawn again shows it as the reader left it.
 */
export const summaryToggles: Extension = [
  frameToggled,
  EditorView.domEventHandlers({
    click(event, view) {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey)
        return false;
      const summary = htmlAt(view, event.clientX, event.clientY)?.closest("summary");
      const details = summary?.parentElement;
      // The frame's elements are of its own window, so they are known by name, not by class.
      if (details?.localName !== "details" || details.querySelector(":scope > summary") !== summary)
        return false;
      (details as HTMLDetailsElement).open = !(details as HTMLDetailsElement).open;
      const frame = details.ownerDocument.defaultView?.frameElement;
      if (frame) {
        const all = details.ownerDocument.querySelectorAll<HTMLElement>("details");
        const index = [...all].indexOf(details);
        view.dispatch({ effects: toggleFrameDetails.of({ pos: view.posAtDOM(frame), index }) });
      }
      return true;
    },
  }),
];

/** Where a frame's images come from: the resource channel, as in the page's own policy. */
const IMAGES = "doc-asset: http://doc-asset.localhost";

/** The namespace of SVG's older `xlink:href`, which an SVG `<image>` may still name a file by. */
const XLINK = "http://www.w3.org/1999/xlink";

/**
 * The frame's document. Its policy loads the page's own fonts, and images from the resource
 * channel, and nothing else, and refuses the HTML's styles. Its faces are the page's: the fonts
 * and colours are copied from the page.
 */
function framed(html: string, view: EditorView): string {
  const nonce = view.state.facet(EditorView.cspNonce);
  const styles = nonce ? `'nonce-${nonce}'` : "'none'";
  const policy = `default-src 'none'; img-src ${IMAGES}; style-src ${styles}; font-src 'self'; base-uri 'none'; form-action 'none'`;
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
    `</head><body>${withImages(html, view)}</body></html>`
  );
}

/**
 * docs/hld.md §7: the HTML with its images pointed at the resource channel before the frame reads
 * it. An `<img src>` that names a file in the repository asks for it as a markdown image does, and
 * the channel checks it the same way. Any other src goes, and every other place an image can be
 * named: a srcset, a poster, a background, and an href on anything but a link, such as an SVG
 * `<image>`. So the frame asks for nothing the page did not name. The parser loads and runs none
 * of the HTML.
 */
function withImages(html: string, view: EditorView): string {
  if (!/src|href|poster|background/i.test(html)) return html;
  const parsed = new DOMParser().parseFromString(html, "text/html");
  for (const element of parsed.querySelectorAll("*")) {
    for (const name of ["srcset", "poster", "background"]) element.removeAttribute(name);
    const tag = element.localName;
    if (tag !== "img") element.removeAttribute("src");
    if (tag !== "a" && tag !== "area") {
      element.removeAttribute("href");
      element.removeAttributeNS(XLINK, "href");
    }
  }
  for (const image of parsed.querySelectorAll("img")) {
    const file = filePath(image.getAttribute("src")?.trim() ?? "");
    const url = isLocal(file) ? view.state.facet(assetUrl)(file) : null;
    if (url) image.setAttribute("src", url);
    else image.removeAttribute("src");
  }
  // The parser puts what may lead a document, such as a <meta>, in its head. The frame has it all.
  return parsed.head.innerHTML + parsed.body.innerHTML;
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
