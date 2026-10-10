import "./styles.css";
import { keymap } from "@codemirror/view";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { createSurface, printPage } from "./surface.ts";

type Opened = { text: string; name: string; readOnlyReason: string | null };

const root = document.querySelector<HTMLElement>("#page")!;
const nonce = document.querySelector<HTMLMetaElement>('meta[name="style-nonce"]')?.content;

// A window shows the document its label names. Rust chose the label, and holds the path.
const handle = getCurrentWindow().label.match(/^doc-([0-9a-f]+)$/)?.[1];

const pick = () => void invoke("pick_document");

if (handle) {
  const opened = await invoke<Opened>("open_document");
  // docs/hld.md §8, item 3, from here to the engine's first-contentful-paint: the page's share.
  performance.mark("document-opened");
  document.title = opened.name;
  const view = createSurface(root, opened.text, {
    assets: (file) => convertFileSrc(`${handle}/${file}`, "doc-asset"),
    nonce: nonce && !nonce.startsWith("__TAURI") ? nonce : undefined,
    openLink: (url) => void invoke("open_url", { url }),
    extensions: keymap.of([
      { key: "Mod-o", run: () => (pick(), true) },
      { key: "Mod-p", run: (view) => (printPage(view), true) },
    ]),
  });
  root.append(statusLine(opened));
  view.focus();
} else {
  root.append(welcome());
  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "o") {
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
