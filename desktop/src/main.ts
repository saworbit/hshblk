import "./styles.css";
import { openSearchPanel } from "@codemirror/search";
import type { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { frontmatterPanel, frontmatterText, toggleFrontmatter } from "./page/frontmatter.ts";
import { sourceShown, toggleSource } from "./page/page.ts";
import { createSurface, printPage } from "./surface.ts";
import glyph from "../../brand/logo/svg/glyph-current.svg?raw";

type Opened = { name: string; modified: number | null; readOnlyReason: string | null };

const root = document.querySelector<HTMLElement>("#page")!;
const nonce = document.querySelector<HTMLMetaElement>('meta[name="style-nonce"]')?.content;

// A window shows the document its label names. Rust chose the label, and holds the path.
const handle = getCurrentWindow().label.match(/^doc-([0-9a-f]+)$/)?.[1];

const pick = () => void invoke("pick_document");

// The window's keys take ⌘ on macOS and Ctrl elsewhere, as the README's key table has them. On
// macOS, Ctrl and those letters are CodeMirror's Emacs keys, even where they have nothing to move.
const mac = /Mac/.test(navigator.platform);
const command = (event: KeyboardEvent) => (mac ? event.metaKey : event.ctrlKey);

if (handle) {
  // The text comes as bytes, which cross faster than a long string as JSON. As Rust holds it:
  // a byte order mark at its start, if one is there, is part of the text.
  const [opened, text] = await Promise.all([
    invoke<Opened>("open_document"),
    invoke<ArrayBuffer>("document_text").then((bytes) =>
      new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes),
    ),
  ]);
  // docs/hld.md §8, item 3, from here to the engine's first-contentful-paint: the page's share.
  performance.mark("document-opened");
  document.title = opened.name;
  const status = statusLine(opened);
  const view = createSurface(root, text, {
    assets: (file) => convertFileSrc(`${handle}/${file}`, "doc-asset"),
    nonce: nonce && !nonce.startsWith("__TAURI") ? nonce : undefined,
    // A link that does not open says why, in the status line.
    openLink: (url) => void invoke("open_url", { url }).catch((error) => say(status, `${error}`)),
    extensions: EditorView.updateListener.of((update) => reflect(status, update.state)),
  });
  reflect(status, view.state);
  status
    .querySelector(".status-frontmatter")
    ?.addEventListener("click", () => toggleFrontmatter(view));
  // The window's keys work wherever focus is: the page, the find box, or nothing at all.
  // CodeMirror goes first, and a key it took is not taken again.
  const keys: Record<string, () => void> = {
    // On macOS, ⌘O is the File menu's (lib.rs), so the page leaves it be.
    ...(mac ? {} : { o: pick }),
    // WKWebView ignores window.print(), so on macOS Rust opens the print panel (#191).
    p: () =>
      void printPage(view, mac ? () => invoke("print_page") : undefined).catch((error) =>
        say(status, `${error}`),
      ),
    f: () => openSearchPanel(view),
    "/": () => toggleSource(view),
    // Shift and M.
    M: () => toggleFrontmatter(view),
  };
  document.addEventListener("keydown", (event) => {
    const run = keys[event.key];
    if (!run || event.defaultPrevented || !command(event) || event.altKey) return;
    event.preventDefault();
    run();
  });
  root.append(status);
  view.focus();
} else {
  root.append(welcome());
  document.addEventListener("keydown", (event) => {
    if (!mac && command(event) && event.key === "o") {
      event.preventDefault();
      pick();
    }
  });
}

function statusLine(opened: Opened): HTMLElement {
  const line = element("footer", "status");
  line.append(element("span", "status-name", opened.name));
  if (opened.modified !== null) {
    const when = new Date(opened.modified).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
    line.append(element("span", "", `Modified ${when}`));
  }
  // Shown only for a file with frontmatter, which folds away on the page.
  const front = element("button", "status-frontmatter", "Frontmatter");
  front.setAttribute("type", "button");
  front.title = `Show the frontmatter (${mac ? "⌘⇧M" : "Ctrl+Shift+M"})`;
  front.hidden = true;
  line.append(front);
  line.append(element("span", "", "Read only. Copy and find work on the source."));
  const source = element(
    "span",
    "status-source",
    `Showing the source. ${mac ? "⌘/" : "Ctrl+/"} hides it.`,
  );
  source.hidden = true;
  line.append(source);
  if (opened.readOnlyReason) line.append(element("span", "status-reason", opened.readOnlyReason));
  return line;
}

/** What the status line says of the page: its frontmatter, and whether the source shows. */
function reflect(line: HTMLElement, state: EditorState): void {
  const front = line.querySelector<HTMLElement>(".status-frontmatter");
  if (front) {
    front.hidden = frontmatterText(state) === null;
    front.setAttribute("aria-expanded", String(state.field(frontmatterPanel).open));
  }
  const source = line.querySelector<HTMLElement>(".status-source");
  if (source) source.hidden = !sourceShown(state);
}

/** Says in the status line what went wrong, until something else does. */
function say(line: HTMLElement, message: string): void {
  const said =
    line.querySelector(".status-said") ??
    line.appendChild(element("span", "status-reason status-said"));
  said.textContent = message;
}

function welcome(): HTMLElement {
  const box = element("section", "welcome");
  const open = element("button", "welcome-open", "Open a markdown file");
  open.addEventListener("click", pick);
  box.append(mark(), open, element("p", "welcome-hint", "or drop one on this window"));
  return box;
}

/**
 * The mark, brand/logo/svg/glyph-current.svg, inline so the CSP has nothing to fetch. It fills
 * with currentColor, and the stylesheet gives it the accent.
 */
function mark(): Element {
  const svg = new DOMParser().parseFromString(glyph, "image/svg+xml").documentElement;
  svg.classList.add("welcome-mark");
  return document.adoptNode(svg);
}

function element(tag: string, className: string, text?: string): HTMLElement {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
}
