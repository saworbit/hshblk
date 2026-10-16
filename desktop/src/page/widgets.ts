import { type Extension, StateEffect, StateField } from "@codemirror/state";
import { EditorView, WidgetType } from "@codemirror/view";
import { imageUrl, refusalOf, unloaded } from "./assets.ts";
import { element } from "./dom.ts";
import { type Inline, plainText } from "./inlines.ts";
import { printedAddress } from "./links.ts";

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

/** The five alerts GitHub draws, by the word in their marker, `> [!NOTE]`. */
export const ALERTS = ["note", "tip", "important", "warning", "caution"] as const;

export type Alert = (typeof ALERTS)[number];

/**
 * Each alert's icon, drawn here in strokes of the label's colour: a circled i, a bulb, a speech
 * bubble with a mark, a triangle with one, and an octagon with one.
 */
const ALERT_ICONS: Record<Alert, string[]> = {
  note: ["M8 1.75a6.25 6.25 0 1 0 0 12.5a6.25 6.25 0 1 0 0-12.5z", "M8 7.25v4", "M8 4.75v.01"],
  tip: ["M5.5 10.5a4.25 4.25 0 1 1 5 0V12h-5z", "M6.25 14.25h3.5"],
  important: ["M2.25 2.75h11.5v8h-6.5l-3.5 2.75v-2.75h-1.5z", "M8 4.75v3", "M8 9.25v.01"],
  warning: ["M8 1.75l6.5 12h-13z", "M8 6.25v3.5", "M8 11.75v.01"],
  caution: ["M5.4 1.75h5.2l3.65 3.65v5.2l-3.65 3.65H5.4l-3.65-3.65V5.4z", "M8 4.75v4", "M8 11v.01"],
};

/** An alert's marker, `[!WARNING]`, drawn as its name and icon: "Warning". */
export class AlertWidget extends WidgetType {
  readonly kind: Alert;

  constructor(kind: Alert) {
    super();
    this.kind = kind;
  }

  eq(other: AlertWidget): boolean {
    return other.kind === this.kind;
  }

  toDOM(): HTMLElement {
    const label = element("span", "pg-alert-label");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("aria-hidden", "true");
    for (const d of ALERT_ICONS[this.kind]) {
      const path = svg.appendChild(document.createElementNS("http://www.w3.org/2000/svg", "path"));
      path.setAttribute("d", d);
    }
    label.append(svg, this.kind[0].toUpperCase() + this.kind.slice(1));
    return label;
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
  /** What a hover shows, as on GitHub (#229). */
  readonly title: string | null;

  constructor(reference: string, alt: string, inline: boolean, title: string | null = null) {
    super();
    this.reference = reference;
    this.alt = alt;
    this.inline = inline;
    this.title = title;
  }

  eq(other: ImageWidget): boolean {
    return (
      other.reference === this.reference &&
      other.alt === this.alt &&
      other.inline === this.inline &&
      other.title === this.title
    );
  }

  toDOM(view: EditorView): HTMLElement {
    return imageNode(view, this.reference, this.alt, this.inline, this.title);
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/**
 * An image, through the resource channel when it is in the repository, or the page's placeholder
 * for it. CodeMirror puts back a widget's own element if it goes, but leaves what is inside it
 * alone. So a refused image gives way to its placeholder inside a frame that stays.
 */
function imageNode(
  view: EditorView,
  reference: string,
  alt: string,
  inline: boolean,
  title: string | null = null,
): HTMLElement {
  const url = imageUrl(view.state, reference);
  if (!url) return placeholder(unloaded(reference), alt, inline);
  const frame = document.createElement("span");
  frame.className = inline ? "pg-figure-inline" : "pg-figure";
  const image = frame.appendChild(document.createElement("img"));
  image.className = "pg-image";
  image.alt = alt;
  if (title) image.title = title;
  // The chip says why, once the shell has asked (#231). Until then the broken image is hidden.
  image.addEventListener("error", () => {
    image.hidden = true;
    void refusalOf(view.state, reference).then((why) =>
      image.replaceWith(placeholder(why, alt, inline)),
    );
  });
  image.src = url;
  return frame;
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

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "pg-table";
    const table = wrap.appendChild(document.createElement("table"));
    if (this.table.head.length > 0) {
      row(
        view,
        table.appendChild(document.createElement("thead")),
        "th",
        this.table.head,
        this.table.align,
      );
    }
    const body = table.appendChild(document.createElement("tbody"));
    const { rows, align } = this.table;
    let drawn = 0;
    const draw = (count: number): boolean => {
      const end = Math.min(rows.length, drawn + count);
      for (; drawn < end; drawn += 1) row(view, body, "td", rows[drawn], align);
      return drawn === rows.length;
    };
    // Print takes the whole table now. On screen the rest follows a chunk at a time, each a table
    // of its own under the first, with the first's columns, fixed. A row added to a table lays out
    // every row before it again, and 20,000 rows took 1.7 s each time.
    if (draw(printed.has(view) ? Infinity : FIRST_ROWS)) return wrap;
    let columns: { widths: string[]; width: string } | null = null;
    const fixed = (into: HTMLTableElement) => {
      into.style.tableLayout = "fixed";
      into.style.width = columns!.width;
      const cols = columns!.widths.map((width) => {
        const col = document.createElement("col");
        col.style.width = width;
        return col;
      });
      into.prepend(element("colgroup", "", cols));
    };
    // The first table's columns, as shares of its width, once it is laid out.
    const measure = (): boolean => {
      const cells = table.rows[0]?.cells;
      const whole = table.getBoundingClientRect().width;
      if (!cells || whole === 0) return false;
      const share = (cell: Element) => (cell.getBoundingClientRect().width / whole) * 100;
      const widths = [...cells].map((cell) => `${share(cell)}%`);
      columns = { widths, width: whole > wrap.clientWidth + 1 ? `${whole}px` : "100%" };
      fixed(table);
      return true;
    };
    const chunk = (count: number): boolean => {
      // Off the screen, a chunk is neither laid out nor painted, and holds its rows' height.
      const block = wrap.appendChild(element("div", "pg-table-chunk"));
      const more = block.appendChild(document.createElement("table"));
      fixed(more);
      const end = Math.min(rows.length, drawn + count);
      const into = more.appendChild(document.createElement("tbody"));
      const height = (table.tBodies[0]?.getBoundingClientRect().height ?? 0) / FIRST_ROWS;
      block.style.containIntrinsicSize = `auto ${Math.round(height * (end - drawn))}px`;
      for (; drawn < end; drawn += 1) row(view, into, "td", rows[drawn], align);
      return drawn === rows.length;
    };
    const next = () => {
      if (!unbuilt.has(wrap)) return;
      if ((columns || measure()) && chunk(ROW_CHUNK)) unbuilt.delete(wrap);
      else setTimeout(next);
      view.requestMeasure();
    };
    unbuilt.set(wrap, () => {
      if (columns || measure()) chunk(Infinity);
      else draw(Infinity);
    });
    setTimeout(next);
    return wrap;
  }

  destroy(dom: HTMLElement): void {
    unbuilt.delete(dom);
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/**
 * #173: how many of a table's rows draw with it, and how many follow at a time after, so a table
 * of thousands of rows holds up no first paint. All 20,001 rows of one took 1.7 s to first paint.
 */
const FIRST_ROWS = 200;
const ROW_CHUNK = 1000;

/** What draws the rest of each table still being drawn, to stop when it goes or for print. */
const unbuilt = new Map<HTMLElement, () => void>();

/** Draws every row of each table in the page still being drawn, for print. */
function finishTables(view: EditorView): void {
  for (const [wrap, rest] of unbuilt) {
    if (!view.contentDOM.contains(wrap)) continue;
    rest();
    unbuilt.delete(wrap);
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
    // Its words, as a browser shows them, in the faces the page has: bold, italic, and code
    // (#232). A parsed document runs nothing and fetches nothing.
    const parsed = new DOMParser().parseFromString(this.summary, "text/html").body;
    if (parsed.textContent?.trim()) summary.append(...faced(parsed));
    else summary.textContent = "Details";
    // White space reads as a browser reads it (theme.ts), with none at either end.
    const texts: Text[] = [];
    const walk = document.createTreeWalker(summary, NodeFilter.SHOW_TEXT);
    while (walk.nextNode()) texts.push(walk.currentNode as Text);
    if (texts.length > 0) {
      texts[0].data = texts[0].data.trimStart();
      texts[texts.length - 1].data = texts[texts.length - 1].data.trimEnd();
    }
    // The press would move the caret first. Opening the details leaves it where it was.
    summary.addEventListener("mousedown", (event) => event.preventDefault());
    summary.addEventListener("click", () =>
      view.dispatch({ effects: toggleDetails.of(this.from) }),
    );
    return summary;
  }
}

/** The faces a summary keeps, as the page's own classes, so they look as on the page. */
const FACES: Record<string, [string, string]> = {
  b: ["strong", "pg-strong"],
  strong: ["strong", "pg-strong"],
  i: ["em", "pg-em"],
  em: ["em", "pg-em"],
  code: ["code", "pg-code"],
  kbd: ["kbd", "pg-code"],
};

/** A parsed summary's words, made afresh, with its faces and nothing else of its markup. */
function faced(parent: Node): Node[] {
  return [...parent.childNodes].flatMap((node): Node[] => {
    if (node.nodeType === Node.TEXT_NODE) return [document.createTextNode(node.textContent ?? "")];
    if (!(node instanceof Element)) return [];
    const face = FACES[node.localName];
    if (!face) return faced(node);
    const element = document.createElement(face[0]);
    element.className = face[1];
    element.append(...faced(node));
    return [element];
  });
}

/** Ticks or unticks, on the page only, the task box whose marker starts here. */
export const toggleTask = StateEffect.define<number>();

/**
 * docs/hld.md §7: a task list item's box, ticked as the file has it. A click, or Enter in its
 * text, ticks or unticks it on the page. The file keeps what it says.
 */
export class TaskWidget extends WidgetType {
  /** Where the box's `[ ]` starts, which names it. */
  readonly from: number;
  readonly checked: boolean;
  /**
   * The columns of the bullet it is drawn in place of, so the text after it starts where a plain
   * item's does (#212). Null where it takes the place of its `[ ]`.
   */
  readonly columns: number | null;

  constructor(from: number, checked: boolean, columns: number | null = null) {
    super();
    this.from = from;
    this.checked = checked;
    this.columns = columns;
  }

  eq(other: TaskWidget): boolean {
    return (
      other.from === this.from && other.checked === this.checked && other.columns === this.columns
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement("span");
    box.className = this.checked ? "pg-task pg-task-ticked" : "pg-task";
    box.setAttribute("role", "checkbox");
    box.setAttribute("aria-checked", String(this.checked));
    // The press would move the caret first. Ticking the box leaves it where it was.
    box.addEventListener("mousedown", (event) => event.preventDefault());
    box.addEventListener("click", () => view.dispatch({ effects: toggleTask.of(this.from) }));
    if (this.columns === null) return box;
    return element("span", `pg-task-place pg-box-${this.columns}`, [box]);
  }
}

/** The height each HTML block last took, so its frame, drawn again, starts there. */
const htmlHeights = new Map<string, number>();

/** What measures a frame as its content changes, to let go of when the frame goes. */
const fitting = new WeakMap<HTMLElement, ResizeObserver>();

/** What sizes a frame to what it holds, for when it cannot wait for its observer. */
const fits = new WeakMap<HTMLIFrameElement, () => void>();

/** The frames whose HTML has loaded. A frame starts on a blank document, so its own cannot say. */
const loaded = new WeakSet<HTMLIFrameElement>();

/** For a page that is printing, the details in its frames that print opened, and how each was. */
const printed = new WeakMap<EditorView, Map<HTMLDetailsElement, boolean>>();

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
    // Tab passes it by, as it passes the page's other drawn blocks (#165).
    frame.tabIndex = -1;
    // Until it loads, a frame is a line tall, as the block it stands for would be. At no height,
    // CodeMirror took the line after it for the top of the page, and kept that line in place as
    // the frame grew, so a file that starts with one opened scrolled past it (#152).
    const height = htmlHeights.get(this.html);
    frame.style.height = height === undefined ? "1.7em" : `${height}px`;
    frame.srcdoc = framed(this.html, view);
    frame.addEventListener("load", () => {
      loaded.add(frame);
      chipRefused(frame, view);
      this.#fit(frame, view);
      retoggle(frame, view);
      openForPrint(frame, view);
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
    matchPage(frame, view);
    const fit = () => {
      // What spills out of the body counts too, so the frame never scrolls (#227).
      const height = Math.ceil(Math.max(root.getBoundingClientRect().height, body.scrollHeight));
      htmlHeights.set(this.html, height);
      if (frame.style.height === `${height}px`) return;
      frame.style.height = `${height}px`;
      view.requestMeasure();
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(root);
    fitting.set(frame, observer);
    fits.set(frame, fit);
  }
}

/**
 * #267: an `<img>` the resource channel refused is the page's chip of its words, not the engine's
 * broken image. No script runs in a frame, so the page swaps each one when the frame has loaded,
 * which is once its images have settled, and asks the shell why, as for a markdown image.
 */
function chipRefused(frame: HTMLIFrameElement, view: EditorView): void {
  const doc = frame.contentDocument;
  if (!doc) return;
  for (const image of [...doc.images]) {
    if (!image.complete || image.naturalWidth > 0) continue;
    const alt = image.getAttribute("alt") ?? "";
    const chip = placeholder("Image not shown", alt, true, doc);
    image.replaceWith(chip);
    const reference = image.getAttribute("data-reference");
    if (!reference) continue;
    void refusalOf(view.state, reference).then((why) =>
      chip.replaceWith(placeholder(why, alt, true, doc)),
    );
  }
}

/**
 * Gives a frame the page's text size, and its line height as the page's ratio, not a length, so a
 * heading in the frame takes a line of its own size, not the page's, and is not cut off (#227).
 */
function matchPage(frame: HTMLIFrameElement, view: EditorView): void {
  const body = frame.contentDocument?.body;
  if (!body) return;
  const text = getComputedStyle(view.contentDOM);
  const ratio = parseFloat(text.lineHeight) / parseFloat(text.fontSize);
  body.style.fontSize = text.fontSize;
  body.style.lineHeight = Number.isFinite(ratio) ? ratio.toFixed(3) : "normal";
}

/** Gives every drawn frame the page's text size again, after the reader changed it. */
export function matchFrames(view: EditorView): void {
  for (const frame of frames(view)) matchPage(frame, view);
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

/** The page's HTML blocks, as drawn now. */
function frames(view: EditorView): HTMLIFrameElement[] {
  return [...view.contentDOM.querySelectorAll<HTMLIFrameElement>("iframe.pg-html")];
}

/**
 * Resolves once every HTML block CodeMirror draws in its next frame has loaded, or after `wait`
 * milliseconds, so neither a frame that never loads nor a window that never paints holds print up.
 */
export function framesLoaded(view: EditorView, wait: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, wait);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    // CodeMirror's measure, which draws, is already waiting for this frame, so it runs first.
    requestAnimationFrame(() => {
      const pending = frames(view).filter((frame) => !loaded.has(frame));
      let left = pending.length;
      if (left === 0) return done();
      const one = () => {
        left -= 1;
        if (left === 0) done();
      };
      for (const frame of pending) frame.addEventListener("load", one, { once: true });
    });
  });
}

/**
 * Opens every details in the page's HTML blocks while it prints, as print opens a details around
 * markdown. A frame that loads while it prints opens its own. Off, each goes back as it was.
 */
export function printFrames(view: EditorView, on: boolean): void {
  if (!on) {
    for (const [details, open] of printed.get(view) ?? []) details.open = open;
    printed.delete(view);
    return;
  }
  if (!printed.has(view)) printed.set(view, new Map());
  for (const frame of frames(view)) openForPrint(frame, view);
  // A table drawn while print waits is drawn whole, and one still being drawn is finished (#173).
  finishTables(view);
}

function openForPrint(frame: HTMLIFrameElement, view: EditorView): void {
  const opened = printed.get(view);
  if (!opened) return;
  for (const details of frame.contentDocument?.querySelectorAll("details") ?? []) {
    if (!opened.has(details)) opened.set(details, details.open);
    details.open = true;
  }
  // The frame takes its open height now. Its observer would size it after print had begun, and
  // the body would print cut off.
  fits.get(frame)?.();
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
  // The blank lines around the block space it, as they space the page's paragraphs. A table,
  // a heading, and a summary are drawn as the page draws its own (#226, #227, #170). A frame in
  // the HTML loads nothing, so it draws nothing, as on GitHub, and an image that cannot load is
  // the page's chip of its words.
  const faces = `html, body { margin: 0; background: transparent; }
html { overflow-y: hidden; }
body > :first-child { margin-top: 0; }
body > :last-child { margin-bottom: 0; }
body { color: var(--ink); font-family: var(--serif); overflow-wrap: break-word; }
a { color: var(--accent); }
code, kbd, pre, samp { font-family: var(--mono); font-size: 0.86em; }
img { max-width: 100%; }
h1, h2, h3, h4, h5, h6 { font-weight: 560; line-height: 1.3; }
table { border-collapse: collapse; font-size: 0.95em; }
th, td { padding: 0.4em 1em 0.4em 0; border-bottom: 1px solid var(--rule); }
th { font-weight: 560; }
th:not([align]) { text-align: left; }
iframe, embed, object { display: none; }
summary { cursor: pointer; list-style: none; }
summary::-webkit-details-marker { display: none; }
summary::before { content: "▸"; display: inline-block; width: 1.2em; }
details[open] > summary::before { content: "▾"; }
.pg-image-chip { display: inline-block; padding: 0 0.4em; border: 1px solid var(--rule);
  border-radius: 4px; background: var(--code); color: var(--muted); font-size: 0.85em;
  line-height: 1.5; }`;
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${policy}">` +
    '<meta http-equiv="x-dns-prefetch-control" content="off">' +
    `<style nonce="${nonce}">${pageRules()}${faces}</style>` +
    `</head><body>${prepared(html, view)}</body></html>`
  );
}

/**
 * docs/hld.md §7: the HTML with its images pointed at the resource channel before the frame reads
 * it. An `<img src>` that names a file in the repository asks for it as a markdown image does, and
 * the channel checks it the same way. Any other src goes, and every other place an image can be
 * named: a srcset, a poster, a background, and an href on anything but a link, such as an SVG
 * `<image>`. So the frame asks for nothing the page did not name. An image left with nothing to
 * load is the page's chip of its words, not the engine's broken image (#170). Nothing in the frame
 * takes the keyboard: the keys reach its details and links through the page, and a form's field
 * takes no typing on a read-only page (#165). The parser loads and runs none of the HTML.
 */
function prepared(html: string, view: EditorView): string {
  const acts =
    /src|href|poster|background|tabindex|contenteditable|<(input|textarea|select|button|summary)\b/i;
  if (!acts.test(html)) return html;
  const parsed = new DOMParser().parseFromString(html, "text/html");
  // #171: a picture's source that names one file in the repository, as a README's dark-mode mark
  // does, asks the resource channel for it, as an <img src> does. The engine picks it by its
  // media query. Every other srcset goes.
  const sources = new Map<Element, string>();
  for (const source of parsed.querySelectorAll("picture > source[srcset]")) {
    const one = /^\s*(\S+?)(?:\s+1x)?\s*$/.exec(source.getAttribute("srcset") ?? "");
    const url = one ? imageUrl(view.state, one[1]) : null;
    if (url) sources.set(source, url);
  }
  for (const element of parsed.querySelectorAll("*")) {
    for (const name of ["srcset", "poster", "background"]) element.removeAttribute(name);
    const tag = element.localName;
    if (tag !== "img") element.removeAttribute("src");
    if (tag !== "a" && tag !== "area") {
      element.removeAttribute("href");
      element.removeAttributeNS(XLINK, "href");
    }
    element.removeAttribute("contenteditable");
    if (element.matches("a[href], area[href], summary, [tabindex]")) {
      element.setAttribute("tabindex", "-1");
    }
    if (element.matches("input, textarea, select, button")) element.setAttribute("disabled", "");
  }
  for (const image of parsed.querySelectorAll("img")) {
    const reference = image.getAttribute("src")?.trim() ?? "";
    const url = imageUrl(view.state, reference);
    if (url) {
      image.setAttribute("src", url);
      // What the page asked for, so a chip in its place can ask why it was refused (#267).
      image.setAttribute("data-reference", reference);
      continue;
    }
    // The page's chip, made in the frame's document (#257).
    image.replaceWith(
      placeholder(unloaded(reference), image.getAttribute("alt") ?? "", true, parsed),
    );
  }
  for (const [source, url] of sources) source.setAttribute("srcset", url);
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

function row(
  view: EditorView,
  parent: HTMLElement,
  tag: "th" | "td",
  cells: Inline[][],
  align: Align[],
): void {
  const tr = parent.appendChild(document.createElement("tr"));
  cells.forEach((cell, i) => {
    const td = tr.appendChild(document.createElement(tag));
    if (align[i]) td.style.textAlign = align[i];
    td.append(...cell.map((inline) => paint(view, inline)));
  });
}

function paint(view: EditorView, inline: Inline): Node {
  const all = (inlines: Inline[]) => inlines.map((child) => paint(view, child));
  switch (inline.kind) {
    case "text":
      return document.createTextNode(inline.text);
    case "code":
      return element("code", "pg-code", [document.createTextNode(inline.text)]);
    case "emphasis":
      return element("em", "", all(inline.children));
    case "strong":
      return element("strong", "", all(inline.children));
    case "strikethrough":
      return element("s", "pg-strike", all(inline.children));
    case "image":
      return imageNode(view, inline.reference, inline.alt, true, inline.title);
    case "link": {
      const link = element("span", "pg-link", all(inline.children));
      link.title = inline.title ?? inline.href;
      link.dataset.href = inline.href;
      link.setAttribute("role", "link");
      const printed = printedAddress(inline.href, plainText(inline.children));
      if (printed) link.dataset.print = printed;
      return link;
    }
  }
}

/**
 * Why an image does not show, and its words. In a line, a chip of its words says why on hover.
 * The page's and a frame's are one chip, made in the document that shows it (#257).
 */
function placeholder(what: string, alt: string, inline: boolean, owner = document): HTMLElement {
  const said = `${what} · ${alt || "untitled"}`;
  const className = inline ? "pg-image-missing pg-image-chip" : "pg-image-missing";
  const span = element("span", className, inline ? alt || "untitled" : said, owner);
  if (inline) span.title = said;
  return span;
}
