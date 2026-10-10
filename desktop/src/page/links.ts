import { Facet } from "@codemirror/state";
import { EditorView, type Tooltip } from "@codemirror/view";

/** A link's words in the source, and where it points. */
export type LinkSpan = { from: number; to: number; href: string };

/** What the shell does with an address the reader asks to open. Null when it opens nothing. */
export const linkOpener = Facet.define<(href: string) => void, ((href: string) => void) | null>({
  combine: (values) => values[0] ?? null,
});

/** Addresses that leave for the system browser. Anything else is only shown. */
export function opens(href: string): boolean {
  return /^(https?:\/\/|mailto:)/i.test(href);
}

/**
 * docs/hld.md §7: a link's syntax never unfolds inline, because its address would reflow the
 * line under the pointer (the click-target gate, row 3). It shows here instead, at the caret.
 */
export function addressTooltip(link: LinkSpan | undefined): Tooltip | null {
  if (!link) return null;
  return {
    pos: link.from,
    above: false,
    create: (view) => ({ dom: address(view, link.href) }),
  };
}

function address(view: EditorView, href: string): HTMLElement {
  const box = document.createElement("div");
  box.className = "pg-address";
  const url = box.appendChild(document.createElement("span"));
  url.className = "pg-address-url";
  url.textContent = href || "(no address)";
  const open = view.state.facet(linkOpener);
  if (open && opens(href)) {
    const button = box.appendChild(document.createElement("button"));
    button.type = "button";
    button.textContent = "Open";
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => open(href));
  }
  return box;
}

/** A Ctrl or Cmd click on a link opens it. A plain click places the caret in its words. */
export const modClickOpens = EditorView.domEventHandlers({
  click(event, view) {
    if (!(event.metaKey || event.ctrlKey)) return false;
    const href = (event.target as Element).closest<HTMLElement>("[data-href]")?.dataset.href;
    const open = view.state.facet(linkOpener);
    if (!href || !open || !opens(href)) return false;
    open(href);
    return true;
  },
});
