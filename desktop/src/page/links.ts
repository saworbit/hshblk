import {
  type EditorState,
  type Extension,
  Facet,
  StateEffect,
  StateField,
  type Text,
  type TransactionSpec,
} from "@codemirror/state";
import { type Command, EditorView, type Rect, showTooltip, type Tooltip } from "@codemirror/view";
import type { SyntaxNode, Tree } from "@lezer/common";
import { filePath, isLocal } from "./assets.ts";
import { autolinkHref, destination, headingAt, type Definitions } from "./references.ts";
import { htmlAt } from "./widgets.ts";

/** A link's words in the source, the whole link as written, and where it points. */
export type LinkSpan = {
  from: number;
  to: number;
  source: { from: number; to: number };
  href: string;
};

/** A Link or Autolink node's words and address. Null for a reference with no definition. */
export function linkSpan(doc: Text, definitions: Definitions, node: SyntaxNode): LinkSpan | null {
  const source = { from: node.from, to: node.to };
  if (node.name === "Autolink") {
    const url = node.getChild("URL");
    if (!url) return null;
    return {
      from: url.from,
      to: url.to,
      source,
      href: autolinkHref(doc.sliceString(url.from, url.to)),
    };
  }
  const href = destination(doc, node, definitions);
  if (href === null) return null;
  const [open, close] = node.getChildren("LinkMark");
  return { from: open.to, to: close.from, source, href };
}

/**
 * The link a selection from `from` to `to` lies in, read from the tree there. A link in a table
 * or in an image's words is drawn with them, not on the page, so it is in none.
 */
export function linkAt(
  doc: Text,
  tree: Tree,
  definitions: Definitions,
  from: number,
  to: number,
): LinkSpan | undefined {
  let found: LinkSpan | undefined;
  for (let node: SyntaxNode | null = tree.resolveInner(from, 1); node; node = node.parent) {
    if (node.name === "Table" || node.name === "Image") {
      found = undefined;
    } else if (node.name === "Link" || node.name === "Autolink") {
      if (node.from <= from && to <= node.to) found = linkSpan(doc, definitions, node) ?? found;
    }
  }
  return found;
}

/** What the shell does with an address the reader asks to open. Null when it opens nothing. */
export const linkOpener = Facet.define<(href: string) => void, ((href: string) => void) | null>({
  combine: (values) => values[0] ?? null,
});

/**
 * What the shell does with a link to a file in the repository: opens it in a window of its own
 * (#156). It is handed the file as the link names it, decoded, never a path.
 */
export const fileOpener = Facet.define<(file: string) => void, ((file: string) => void) | null>({
  combine: (values) => values[0] ?? null,
});

/** Where the shell says why a link the reader followed does not open. */
export const linkRefused = Facet.define<
  (reason: string) => void,
  ((reason: string) => void) | null
>({ combine: (values) => values[0] ?? null });

/** Addresses that leave for the system browser. Anything else is only shown. */
export function opens(href: string): boolean {
  return /^(https?:\/\/|mailto:)/i.test(href);
}

/**
 * Where a link goes: to a heading or an anchor in this document, to the browser, to a file in the
 * repository, or nowhere, with the reason why.
 */
export type Destination =
  | { heading: number }
  | { url: string }
  | { file: string }
  | { refused: string };

export function destinationOf(state: EditorState, href: string): Destination {
  const heading = headingAt(state, href);
  if (heading !== undefined) return { heading };
  if (opens(href)) return { url: href };
  if (href === "" || href === "#") return { refused: "This link has no address." };
  if (href.startsWith("#")) return { refused: `Nothing in this file is named ${href}.` };
  // Whether the file is in the repository, and opens, is the shell's to say.
  const file = filePath(href);
  if (isLocal(file)) return { file };
  return { refused: "Only web and mail links open, and links to files in the repository." };
}

/**
 * #237: what print shows after a link's words, the address it leaves for, or null. A link to a
 * heading prints as its words, and so does one whose words already are its address, as an
 * autolink's are.
 */
export function printedAddress(href: string, words: string): string | null {
  if (!opens(href)) return null;
  const address = href.replace(/^mailto:/i, "");
  return words.trim() === address || words.trim() === href ? null : address;
}

/** A find match: its text, and where it starts in the document. */
export type Found = { text: string; from: number };

/**
 * docs/hld.md §7: a link's syntax never unfolds inline, because its address would reflow the
 * line under the pointer (the click-target gate, row 3). It shows here instead, at the caret,
 * or with a find match marked in it when the match lies in the hidden syntax.
 */
export function addressTooltip(link: LinkSpan | undefined, found?: Found): Tooltip | null {
  if (!link) return null;
  return {
    pos: link.from,
    above: false,
    create: (view) => {
      const dom = address(view, link, found);
      // The address is cut to one line, so the mark is scrolled into what shows.
      const mount = () => dom.querySelector("mark")?.scrollIntoView({ block: "nearest" });
      return { dom, mount };
    },
  };
}

/** The address split around the first place `found` is in it, or null when it is not there. */
export function around(href: string, found: string): [string, string, string] | null {
  const at = found ? href.indexOf(found) : -1;
  return at < 0 ? null : [href.slice(0, at), found, href.slice(at + found.length)];
}

function address(view: EditorView, link: LinkSpan, found?: Found): HTMLElement {
  const { href } = link;
  const box = document.createElement("div");
  box.className = "pg-address";
  const lines = box.appendChild(document.createElement("span"));
  lines.className = "pg-address-lines";
  const url = lines.appendChild(document.createElement("span"));
  url.className = "pg-address-url";
  const parts = found ? around(href, found.text) : null;
  if (parts) {
    url.append(parts[0], marked(parts[1]), parts[2]);
  } else {
    url.textContent = href || "(no address)";
  }
  // A match elsewhere in the hidden syntax, such as the title, shows in the link as written.
  if (found && !parts) {
    const source = view.state.sliceDoc(link.source.from, link.source.to);
    const at = found.from - link.source.from;
    const line = lines.appendChild(document.createElement("span"));
    line.className = "pg-address-url pg-address-source";
    line.append(source.slice(0, at), marked(found.text), source.slice(at + found.text.length));
  }
  const go = follow(view, href);
  if (typeof go === "function") {
    const button = box.appendChild(document.createElement("button"));
    button.type = "button";
    button.textContent = headingAt(view.state, href) === undefined ? "Open" : "Go to";
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", go);
  } else if (go) {
    // A link that cannot open says why where its button would be (#156).
    const why = lines.appendChild(document.createElement("span"));
    why.className = "pg-address-why";
    why.textContent = go;
  }
  return box;
}

function marked(text: string): HTMLElement {
  return Object.assign(document.createElement("mark"), { textContent: text });
}

/**
 * What following a link does: go to a heading in this document, hand the address or the file to
 * the shell, or, as a string, why it does not open. Null when the shell opens nothing at all.
 */
function follow(view: EditorView, href: string): (() => void) | string | null {
  const to = destinationOf(view.state, href);
  if ("heading" in to) {
    return () => {
      view.dispatch(jumpTo(view.state, placeOf(view), to.heading));
      view.focus();
    };
  }
  if ("refused" in to) return to.refused;
  const open = "url" in to ? view.state.facet(linkOpener) : view.state.facet(fileOpener);
  const target = "url" in to ? to.url : to.file;
  return open ? () => open(target) : null;
}

/** A place on the page: where the caret is, and where the line at the top of the window starts. */
export type Place = { caret: number; top: number };

/** The places the reader left by a link to a heading, to go back to, and forward again (#235). */
type Jumps = { back: readonly Place[]; forward: readonly Place[] };

const NO_JUMPS: Jumps = { back: [], forward: [] };

/** How many places back the page keeps. */
const MAX_JUMPS = 100;

const jumped = StateEffect.define<Jumps>();

const jumps = StateField.define<Jumps>({
  create: () => NO_JUMPS,
  update: (value, tr) => tr.effects.reduce((v, e) => (e.is(jumped) ? e.value : v), value),
});

/** Goes to a place, with the jumps as they stand after it. */
function goTo(place: Place, after: Jumps): TransactionSpec {
  return {
    selection: { anchor: place.caret },
    effects: [EditorView.scrollIntoView(place.top, { y: "start" }), jumped.of(after)],
    userEvent: "select",
  };
}

/** Follows a link from `here` to the heading at `heading`, which `here` can come back to. */
export function jumpTo(state: EditorState, here: Place, heading: number): TransactionSpec {
  const { back } = state.field(jumps, false) ?? NO_JUMPS;
  const place = { caret: heading, top: heading };
  return goTo(place, { back: [...back, here].slice(-MAX_JUMPS), forward: [] });
}

/** Back to where the last jump left from, or null when there is none to go back to. */
export function jumpBack(state: EditorState, here: Place): TransactionSpec | null {
  const { back, forward } = state.field(jumps, false) ?? NO_JUMPS;
  const to = back.at(-1);
  return to ? goTo(to, { back: back.slice(0, -1), forward: [...forward, here] }) : null;
}

/** Forward again to where going back left from, or null when there is none. */
export function jumpForward(state: EditorState, here: Place): TransactionSpec | null {
  const { back, forward } = state.field(jumps, false) ?? NO_JUMPS;
  const to = forward.at(-1);
  return to ? goTo(to, { back: [...back, here], forward: forward.slice(0, -1) }) : null;
}

/** Where the reader is now: the caret, and the line at the top of the window. */
function placeOf(view: EditorView): Place {
  const top = view.scrollDOM.getBoundingClientRect().top - view.documentTop;
  const line = view.lineBlockAtHeight(Math.max(top, 0));
  return { caret: view.state.selection.main.head, top: line.from };
}

function jumping(move: typeof jumpBack): Command {
  return (view) => {
    const spec = move(view.state, placeOf(view));
    if (spec) view.dispatch(spec);
    return spec !== null;
  };
}

/** Alt+Left, or ⌘[ on macOS: back to where the last link to a heading was followed from. */
export const goBack = jumping(jumpBack);

/** Alt+Right, or ⌘] on macOS: forward again. */
export const goForward = jumping(jumpForward);

/** A link in an HTML block: where the block starts, which of its links it is, and its address. */
export type FrameLink = { pos: number; index: number; href: string };

/** Shows the address of a link in an HTML block, or with null, hides it. */
export const showFrameLink = StateEffect.define<FrameLink | null>();

/**
 * The link in an HTML block that a plain click landed on. Its address shows as a page link's
 * does, under its words, until the selection moves.
 */
const frameLink = StateField.define<FrameLink | null>({
  create: () => null,
  update(link, tr) {
    for (const effect of tr.effects) if (effect.is(showFrameLink)) return effect.value;
    return tr.selection || tr.docChanged ? null : link;
  },
  provide: (field) =>
    showTooltip.from(field, (link): Tooltip | null => {
      if (!link) return null;
      const span = { from: link.pos, to: link.pos, source: { from: link.pos, to: link.pos } };
      return {
        pos: link.pos,
        above: false,
        create: (view) => ({
          dom: address(view, { ...span, href: link.href }),
          // CodeMirror hides a tooltip placed outside the editor, as when the frame is not drawn.
          getCoords: () => frameLinkBox(view, link),
        }),
      };
    }),
});

/** A place above the window, outside the editor. */
const NOWHERE: Rect = { left: 0, right: 0, top: -10000, bottom: -10000 };

/** Where a link in an HTML block's frame starts on the screen, or nowhere when it is not drawn. */
function frameLinkBox(view: EditorView, { pos, index }: FrameLink): Rect {
  for (const frame of view.contentDOM.querySelectorAll<HTMLIFrameElement>("iframe.pg-html")) {
    if (view.posAtDOM(frame) !== pos) continue;
    const link = frame.contentDocument?.querySelectorAll("a[href]")[index];
    const words = link?.getClientRects()[0];
    if (!words) return NOWHERE;
    const box = frame.getBoundingClientRect();
    const left = box.left + frame.clientLeft;
    const top = box.top + frame.clientTop;
    return {
      left: left + words.left,
      right: left + words.right,
      top: top + words.top,
      bottom: top + words.bottom,
    };
  }
  return NOWHERE;
}

/**
 * A Ctrl or Cmd click on a link follows it. A plain click places the caret in its words, or on a
 * link in an HTML block, which has no words in the source to place it in, shows its address.
 * The places a link to a heading leaves are kept, for `goBack` and `goForward`.
 */
export const modClickOpens: Extension = [
  frameLink,
  jumps,
  EditorView.domEventHandlers({
    // The press would move the caret first. Following a link leaves it where it was.
    mousedown: (event, view) => following(event, view) !== null,
    click(event, view) {
      const go = following(event, view);
      go?.();
      return go !== null || showsFrameLink(event, view);
    },
  }),
];

/** Shows the address of the link in an HTML block under a plain click, if there is one. */
function showsFrameLink(event: MouseEvent, view: EditorView): boolean {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey)
    return false;
  const link = htmlAt(view, event.clientX, event.clientY)?.closest("a[href]");
  const frame = link?.ownerDocument.defaultView?.frameElement;
  const href = link?.getAttribute("href")?.trim();
  if (!link || !frame || !href) return false;
  const index = [...link.ownerDocument.querySelectorAll("a[href]")].indexOf(link);
  view.dispatch({ effects: showFrameLink.of({ pos: view.posAtDOM(frame), index, href }) });
  return true;
}

/**
 * What a Ctrl or Cmd click on a link does, or null when the click lands on no link. A link in an
 * HTML block's frame follows the same way as one on the page. One that does not open says why.
 */
function following(event: MouseEvent, view: EditorView): (() => void) | null {
  if (!(event.metaKey || event.ctrlKey)) return null;
  const href =
    (event.target as Element).closest<HTMLElement>("[data-href]")?.dataset.href ??
    htmlAt(view, event.clientX, event.clientY)?.closest("a[href]")?.getAttribute("href")?.trim();
  if (href === undefined) return null;
  const go = follow(view, href);
  if (typeof go !== "string") return go;
  const say = view.state.facet(linkRefused);
  return say ? () => say(go) : null;
}
