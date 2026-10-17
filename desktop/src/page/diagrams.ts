import { Facet } from "@codemirror/state";

/**
 * #221: a fenced block of `mermaid` is its diagram. Mermaid draws in a hidden frame of its own,
 * made the first time a page shows a diagram: sandboxed with scripts but not the page's origin,
 * so it reaches neither the page nor Rust, under a policy that runs only its one script and lets
 * it fetch nothing. Mermaid there works at the strictest of its security levels: its labels are
 * sanitised, and a diagram's clicks and links do nothing. The page sends it a block's source, and
 * shows the SVG it sends back as an image, in which nothing runs and which fetches nothing.
 * `diagram-frame.ts` is the frame's side.
 */

/** Where the frame's script is, which the shell names, as Vite builds it. Without one, no diagram. */
export const diagramFrame = Facet.define<string, string | null>({
  combine: (values) => values[0] ?? null,
});

/** A diagram as an SVG image's address and size, or why it could not be drawn. */
export type Diagram = { url: string; width: number; height: number } | { error: string };

/** What the frame sends back for a diagram. */
type Answer = { id: number; svg?: string; error?: string };

/** How long the frame may take to start, or to draw one diagram, before the page says so. */
const PATIENCE = 30_000;

/**
 * How many frames the page makes before it says the frame did not start, and how long one that
 * has loaded may take to say it is ready.
 */
const STARTS = 4;
const GRACE = 1_000;

const NOT_STARTED = "The diagram frame did not start.";

/** Each diagram drawn, by its theme and source, so a block scrolled back into view is not redrawn. */
const drawn = new Map<string, Promise<Diagram>>();

/** The diagrams the frame has been asked for and has not answered, by their ids. */
const waiting = new Map<number, (answer: Answer) => void>();

let frame: Promise<Window> | null = null;
let asked = 0;

/** A diagram drawn from its source, light or dark as the page is. */
export function drawDiagram(script: string, source: string, dark: boolean): Promise<Diagram> {
  const key = `${dark ? "dark" : "light"}\n${source}`;
  let diagram = drawn.get(key);
  if (!diagram) {
    diagram = draw(script, source, dark);
    drawn.set(key, diagram);
  }
  return diagram;
}

async function draw(script: string, source: string, dark: boolean): Promise<Diagram> {
  try {
    const into = await (frame ??= start(script));
    asked += 1;
    const id = asked;
    const answer = await within(
      new Promise<Answer>((resolve) => {
        waiting.set(id, resolve);
        into.postMessage({ id, source, dark }, "*");
      }),
      "Mermaid took too long to draw it.",
    ).finally(() => waiting.delete(id));
    if (typeof answer.svg === "string") return image(answer.svg);
    return { error: answer.error ?? "Mermaid drew no diagram." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Makes the frame, and makes it again while it loads with no script. On Windows, WebView2 sends
 * the script's request from a window's first sandboxed frame to the network at times, where
 * nothing answers, rather than to Tauri. A frame made after it gets its script (#351).
 */
async function start(script: string): Promise<Window> {
  try {
    for (let tries = 1; tries <= STARTS; tries += 1) {
      const into = await open(script);
      if (into) return into;
      await new Promise((resolve) => setTimeout(resolve, 250 * tries));
    }
    throw new Error(NOT_STARTED);
  } catch (error) {
    frame = null;
    throw error;
  }
}

/**
 * A frame, and its window once its script says it is ready, or null if it loaded with no script:
 * one whose script ran says so before it loads. Its own policy names the app's origin for
 * scripts, since `'self'` in a frame of no origin names nothing.
 */
function open(script: string): Promise<Window | null> {
  const url = new URL(script, location.href);
  const box = document.createElement("iframe");
  box.className = "pg-diagram-frame";
  box.setAttribute("sandbox", "allow-scripts");
  box.setAttribute("aria-hidden", "true");
  box.tabIndex = -1;
  const policy = `default-src 'none'; script-src ${url.origin}`;
  // In development Vite serves the script as a module. Only a build is tested.
  const kind = import.meta.env.DEV ? ' type="module"' : "";
  box.srcdoc =
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="${policy}"></head>` +
    `<body><script${kind} src="${url.href}"></script></body></html>`;
  let hear: (event: MessageEvent) => void = () => {};
  const ready = new Promise<Window | null>((resolve) => {
    hear = (event) => {
      if (event.source !== box.contentWindow) return;
      const data = event.data as Partial<Answer> & { ready?: boolean };
      if (data.ready && box.contentWindow) {
        resolve(box.contentWindow);
      } else if (typeof data.id === "number") {
        waiting.get(data.id)?.(data as Answer);
      }
    };
    // A frame whose script ran is ready before it loads. One that loads and is not ready soon
    // after never will be.
    box.addEventListener("load", () => setTimeout(() => resolve(null), GRACE), { once: true });
  });
  addEventListener("message", hear);
  document.body.append(box);
  const drop = () => {
    removeEventListener("message", hear);
    box.remove();
  };
  return within(ready, NOT_STARTED).then(
    (into) => {
      if (!into) drop();
      return into;
    },
    (error: unknown) => {
      drop();
      throw error;
    },
  );
}

/** The promise's value, or an error with `why` if it takes longer than the page waits. */
function within<T>(promise: Promise<T>, why: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(why)), PATIENCE);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/**
 * The SVG as an image's address, at the size its viewBox gives. Mermaid sizes it to its box,
 * which an image does not have. It came from the frame, so it is parsed as data, never shown as
 * markup.
 */
function image(svg: string): Diagram {
  const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = parsed.documentElement;
  const box = (root.getAttribute("viewBox") ?? "")
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  const [width, height] = [box[2], box[3]];
  if (root.localName !== "svg" || !(width > 0) || !(height > 0)) {
    return { error: "Mermaid drew no diagram." };
  }
  root.setAttribute("width", String(width));
  root.setAttribute("height", String(height));
  root.removeAttribute("style");
  const text = new XMLSerializer().serializeToString(root);
  return { url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`, width, height };
}
