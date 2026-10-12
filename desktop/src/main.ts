import "./styles.css";
import { openSearchPanel } from "@codemirror/search";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { createSurface, printPage } from "./surface.ts";

type Opened = { name: string; readOnlyReason: string | null };

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
  });
  // The window's keys work wherever focus is: the page, the find box, or nothing at all.
  // CodeMirror goes first, and a key it took is not taken again.
  const keys: Record<string, () => void> = {
    o: pick,
    p: () => printPage(view),
    f: () => openSearchPanel(view),
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
    if (command(event) && event.key === "o") {
      event.preventDefault();
      pick();
    }
  });
}

function statusLine(opened: Opened): HTMLElement {
  const line = element("footer", "status");
  line.append(
    element("span", "status-name", opened.name),
    element("span", "", "Read only. Copy and find work on the source."),
  );
  if (opened.readOnlyReason) line.append(element("span", "status-reason", opened.readOnlyReason));
  return line;
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
  box.append(
    element("p", "welcome-mark", "#"),
    open,
    element("p", "welcome-hint", "or drop one on this window"),
  );
  return box;
}

function element(tag: string, className: string, text?: string): HTMLElement {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
}
