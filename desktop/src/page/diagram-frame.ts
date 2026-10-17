import mermaid from "mermaid";

/**
 * #221: the script of the frame mermaid draws in, which Vite bundles with mermaid into one classic
 * script. The frame is a realm of its own. Tauri freezes `Object.prototype` in the page's realm
 * only, and dayjs and d3, which mermaid takes, assign to the properties that freeze makes read
 * only, so mermaid cannot load in the page. The frame's origin is opaque, so it can reach neither
 * the page nor Rust. The page posts it a diagram's source, and it posts back the SVG, or why not.
 *
 * Its policy, the page's and its own, refuses the `<style>` and the style attributes mermaid writes
 * while it lays a diagram out, but not the styles it sets one by one. So the frame is set in
 * mermaid's own font and size, and the SVG, which keeps its `<style>` as an image, draws in the
 * same, so the labels fit.
 */
const FONT = '16px "trebuchet ms", verdana, arial, sans-serif';

/** A diagram the page asks for. */
type Asked = { id: number; source: string; dark: boolean };

document.documentElement.style.font = FONT;

let count = 0;
let queue: Promise<void> = Promise.resolve();

addEventListener("message", (event: MessageEvent<Asked>) => {
  if (event.source !== parent) return;
  const { id, source, dark } = event.data;
  // Mermaid draws one at a time.
  queue = queue.then(() => draw(id, String(source), dark === true));
});

async function draw(id: number, source: string, dark: boolean): Promise<void> {
  try {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: dark ? "dark" : "default",
      fontFamily: '"trebuchet ms", verdana, arial, sans-serif',
      htmlLabels: false,
      flowchart: { htmlLabels: false },
      suppressErrorRendering: true,
    });
    count += 1;
    const { svg } = await mermaid.render(`diagram-${count}`, source);
    parent.postMessage({ id, svg }, "*");
  } catch (error) {
    parent.postMessage({ id, error: error instanceof Error ? error.message : String(error) }, "*");
  }
}

parent.postMessage({ ready: true }, "*");
