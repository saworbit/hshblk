import "./styles.css";
import { openSearchPanel } from "@codemirror/search";
import type { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { Channel, convertFileSrc, invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { frontmatterPanel, frontmatterText, toggleFrontmatter } from "./page/frontmatter.ts";
import { sourceShown, toggleSource } from "./page/page.ts";
import { setTextSize, stepSize, textSize } from "./page/size.ts";
import { createSurface, printPage, takeText } from "./surface.ts";
import glyph from "../../brand/logo/svg/glyph-current.svg?raw";
import readme from "../../README.md?raw";
import { closeKeys, keyList, keyRows, keysPanel, toggleKeys } from "./keys.ts";
import { element } from "./page/dom.ts";

type Opened = { name: string; modified: number | null; readOnlyReason: string | null };

/** A recent file, by its name and the token Rust gave it. */
type Recent = { name: string; token: string };

const root = document.querySelector<HTMLElement>("#page")!;
const nonce = document.querySelector<HTMLMetaElement>('meta[name="style-nonce"]')?.content;

// A window shows the document its label names. Rust chose the label, and holds the path.
const handle = getCurrentWindow().label.match(/^doc-([0-9a-f]+)$/)?.[1];

const pick = () => void invoke("pick_document");
const close = () => void invoke("close_window");

// The window's keys take ⌘ on macOS and Ctrl elsewhere, as the README's key table has them. On
// macOS, Ctrl and those letters are CodeMirror's Emacs keys, even where they have nothing to move.
const mac = /Mac/.test(navigator.platform);
const command = (event: KeyboardEvent) => (mac ? event.metaKey : event.ctrlKey);

/** The keys, from the README's own table, in this system's forms (#239). */
const rows = keyRows(readme, mac);

/** F1, or Ctrl+? (⌘? on macOS), which shows the keys. */
const asksForKeys = (event: KeyboardEvent) =>
  event.key === "F1" || (command(event) && event.key === "?");

// The webview's reload keys and right-click menu are a browser's. Reload brought back the text
// Rust read when the window opened, and the menu's Save as and Print were not the app's (#161,
// #244). The find box's fields keep their menu, for paste.
document.addEventListener("keydown", (event) => {
  if (event.key === "F5" || (command(event) && event.key.toLowerCase() === "r")) {
    event.preventDefault();
  }
});
document.addEventListener("contextmenu", (event) => {
  if (!(event.target instanceof HTMLInputElement)) event.preventDefault();
});

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
    // A failed load says nothing, so Rust checks the file again and says why (#231).
    imageRefusal: (file) => invoke<string | null>("image_refusal", { reference: file }),
    nonce: nonce && !nonce.startsWith("__TAURI") ? nonce : undefined,
    // A link that does not open says why, in the status line.
    openLink: (url) => void invoke("open_url", { url }).catch((error) => say(status, `${error}`)),
    // Rust finds the file from this window's document, and opens it in a window of its own (#156).
    openFile: (reference) =>
      void invoke("open_link", { reference }).catch((error) => say(status, `${error}`)),
    linkRefused: (reason) => say(status, reason),
    extensions: [
      EditorView.updateListener.of((update) => reflect(status, update.state)),
      keysPanel(rows),
    ],
  });
  reflect(status, view.state);
  status
    .querySelector(".status-frontmatter")
    ?.addEventListener("click", () => toggleFrontmatter(view));
  // WKWebView ignores window.print(), so on macOS Rust opens the print panel (#191).
  const print = () =>
    void printPage(view, mac ? () => invoke("print_page") : undefined).catch((error) =>
      say(status, `${error}`),
    );
  const find = () => openSearchPanel(view);
  const size = (step: -1 | 0 | 1) => setTextSize(view, stepSize(textSize(view), step));
  // The window's keys work wherever focus is: the page, the find box, or nothing at all.
  // CodeMirror goes first, and a key it took is not taken again.
  const keys: Record<string, () => void> = {
    // On macOS, ⌘O, ⌘P, ⌘F, and ⌘W are the menu bar's (lib.rs), so the page leaves them be.
    ...(mac ? {} : { o: pick, p: print, f: find, w: close }),
    "/": () => toggleSource(view),
    // Shift and M.
    M: () => toggleFrontmatter(view),
    // The text size (#164). Shift and = is +, as on the numeric keypad.
    "=": () => size(1),
    "+": () => size(1),
    "-": () => size(-1),
    "0": () => size(0),
  };
  document.addEventListener("keydown", (event) => {
    if (event.defaultPrevented) return;
    // The keys' panel opens from F1 or Ctrl+?, and closes from either or Escape (#239).
    if (asksForKeys(event) || (event.key === "Escape" && closeKeys(view))) {
      event.preventDefault();
      if (event.key !== "Escape") toggleKeys(view);
      return;
    }
    const run = keys[event.key];
    if (!run || !command(event) || event.altKey) return;
    event.preventDefault();
    run();
  });
  // #199: Rust watches the file, and says when it has new text, which the page takes where it
  // differs, or why it cannot, as when the file has gone.
  const watch = new Channel<string>();
  watch.onmessage = (message) => {
    if (message !== "changed") return say(status, message);
    void Promise.all([invoke<Opened>("open_document"), invoke<ArrayBuffer>("document_text")])
      .then(([again, bytes]) => {
        takeText(view, new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes));
        restate(status, again);
        status.querySelector(".status-said")?.remove();
      })
      .catch((error) => say(status, `${error}`));
  };
  void invoke("watch_document", { channel: watch });
  if (mac) {
    // The menu bar's Find and Print are the page's to do. The page takes no events, so Rust sends
    // them down a channel (#182).
    const actions: Record<string, () => void> = { find, print };
    const menu = new Channel<string>();
    menu.onmessage = (action) => actions[action]?.();
    void invoke("watch_menu", { channel: menu });
  }
  root.append(status);
  view.focus();
} else {
  root.append(welcome());
  document.addEventListener("keydown", (event) => {
    if (asksForKeys(event)) {
      event.preventDefault();
      const keys = document.querySelector<HTMLDetailsElement>(".welcome-keys");
      if (keys) keys.open = !keys.open;
      return;
    }
    const run = mac ? undefined : { o: pick, w: close }[event.key];
    if (run && command(event)) {
      event.preventDefault();
      run();
    }
  });
}

function statusLine(opened: Opened): HTMLElement {
  const line = element("footer", "status");
  const name = line.appendChild(element("span", "status-name", opened.name));
  // A long name ends in an ellipsis, and its tooltip has all of it (#162).
  name.title = opened.name;
  line.append(element("span", "status-modified"));
  // Shown only for a file with frontmatter, which folds away on the page.
  const front = element("button", "status-frontmatter", "Frontmatter");
  front.setAttribute("type", "button");
  front.title = `Show the frontmatter (${mac ? "⌘⇧M" : "Ctrl+Shift+M"})`;
  front.hidden = true;
  line.append(front);
  line.append(element("span", "status-note", "Read only. Copy and find work on the source."));
  const source = element(
    "span",
    "status-source",
    `Showing the source. ${mac ? "⌘/" : "Ctrl+/"} hides it.`,
  );
  source.hidden = true;
  line.append(source);
  line.append(element("span", "status-reason status-read-only"));
  restate(line, opened);
  return line;
}

/**
 * What the status line says of the file as Rust last read it: when it was modified, and why the
 * editor will not change it. Again when the file changes on disk (#199).
 */
function restate(line: HTMLElement, opened: Opened): void {
  const modified = line.querySelector<HTMLElement>(".status-modified")!;
  modified.hidden = opened.modified === null;
  modified.textContent =
    opened.modified === null
      ? ""
      : `Modified ${new Date(opened.modified).toLocaleString(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
        })}`;
  const reason = line.querySelector<HTMLElement>(".status-read-only")!;
  reason.hidden = !opened.readOnlyReason;
  reason.textContent = opened.readOnlyReason ?? "";
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
  // #242: the files opened last, by name, each a click away. Rust keeps their paths.
  const recent = element("nav", "welcome-recent");
  recent.setAttribute("aria-label", "Recent files");
  recent.hidden = true;
  void invoke<Recent[]>("recent_files").then((files) => {
    if (files.length === 0) return;
    const list = element("ul");
    for (const { name, token } of files) {
      const file = element("button", "welcome-file", name);
      file.setAttribute("type", "button");
      file.addEventListener("click", () => void invoke("open_recent", { token }));
      list.append(element("li", "", [file]));
    }
    recent.replaceChildren(element("h2", "", "Recent"), list);
    recent.hidden = false;
  });
  // #239: the keys, where a new reader looks first. F1 opens them too.
  const keys = element("details", "welcome-keys", [element("summary", "", "Keys"), keyList(rows)]);
  box.append(
    mark(),
    open,
    element("p", "welcome-hint", "or drop one on this window"),
    recent,
    keys,
    // Which one is running, for a bug report or the release page. There is no updater (#238).
    element("p", "welcome-version", `Version ${__VERSION__}`),
  );
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
