import { Facet } from "@codemirror/state";
import { EditorView, type Tooltip } from "@codemirror/view";
import { headingAt } from "./references.ts";

/** A link's words in the source, the whole link as written, and where it points. */
export type LinkSpan = {
  from: number;
  to: number;
  source: { from: number; to: number };
  href: string;
};

/** What the shell does with an address the reader asks to open. Null when it opens nothing. */
export const linkOpener = Facet.define<(href: string) => void, ((href: string) => void) | null>({
  combine: (values) => values[0] ?? null,
});

/** Addresses that leave for the system browser. Anything else is only shown. */
export function opens(href: string): boolean {
  return /^(https?:\/\/|mailto:)/i.test(href);
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
  if (go) {
    const button = box.appendChild(document.createElement("button"));
    button.type = "button";
    button.textContent = headingAt(view.state, href) === undefined ? "Open" : "Go to";
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", go);
  }
  return box;
}

function marked(text: string): HTMLElement {
  return Object.assign(document.createElement("mark"), { textContent: text });
}

/** Where a link goes: to a heading in this document, to the browser, or nowhere. */
function follow(view: EditorView, href: string): (() => void) | null {
  const heading = headingAt(view.state, href);
  if (heading !== undefined) {
    return () => {
      view.dispatch({
        selection: { anchor: heading },
        effects: EditorView.scrollIntoView(heading, { y: "start" }),
        userEvent: "select",
      });
      view.focus();
    };
  }
  const open = view.state.facet(linkOpener);
  return open && opens(href) ? () => open(href) : null;
}

/** A Ctrl or Cmd click on a link follows it. A plain click places the caret in its words. */
export const modClickOpens = EditorView.domEventHandlers({
  // The press would place the caret first, and a caret in a table unfolds its links away.
  mousedown: (event, view) => following(event, view) !== null,
  click(event, view) {
    const go = following(event, view);
    go?.();
    return go !== null;
  },
});

/** What a Ctrl or Cmd click on a link does, or null when the click follows nothing. */
function following(event: MouseEvent, view: EditorView): (() => void) | null {
  if (!(event.metaKey || event.ctrlKey)) return null;
  const href = (event.target as Element).closest<HTMLElement>("[data-href]")?.dataset.href;
  return href ? follow(view, href) : null;
}
