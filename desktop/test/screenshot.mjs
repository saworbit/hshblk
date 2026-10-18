/**
 * The README's screenshot, light and dark: the app on test/screenshot/moving-day.md, read over
 * WebView2's DevTools port as test/webview2.mjs reads it. Windows.
 *
 *   node test/screenshot.mjs <app binary>
 *
 * Writes docs/images/screenshot-light.png and screenshot-dark.png. The page is laid out WIDTH
 * wide and as tall as the whole file, and drawn at twice that, for a screen with twice the
 * pixels. Run it on a debug build, which keeps a data folder of its own, so the sample joins no
 * installed reader's recent files.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { launch, START } from "./devtools.mjs";

const WIDTH = 960;

if (!process.argv[2]) throw new Error("usage: screenshot.mjs <app binary>");
if (process.platform !== "win32") throw new Error("WebView2 runs on Windows only.");
const app = resolve(process.argv[2]);
const file = fileURLToPath(new URL("screenshot/moving-day.md", import.meta.url));
const images = fileURLToPath(new URL("../../docs/images/", import.meta.url));

/**
 * Whether the page is drawn in `scheme`: its maths, and its diagram drawn again since the last
 * scheme, which the page keeps as `window.lastDiagram`. Sent as source, so it takes the scheme.
 */
const drawn = (scheme) => `() => {
  if (!matchMedia("(prefers-color-scheme: ${scheme})").matches) return null;
  const error = document.querySelector(".pg-diagram-error")?.textContent;
  if (error) throw new Error(error);
  const image = document.querySelector(".pg-diagram-image");
  if (!image?.complete || !image.naturalWidth || image.src === window.lastDiagram) return null;
  if (!document.querySelector(".katex")) return null;
  window.lastDiagram = image.src;
  return true;
}`;

/**
 * How tall the window must be to show the whole file, with as much room under its last line as
 * over its first, and the status line. The page's own room under the last line is left out.
 */
const fit = () => {
  const scroller = document.querySelector(".cm-scroller");
  const content = document.querySelector(".cm-content");
  const top = content.firstElementChild.getBoundingClientRect().top;
  const bottom = content.lastElementChild.getBoundingClientRect().bottom;
  return Math.ceil(bottom + top + innerHeight - scroller.clientHeight);
};

const profile = mkdtempSync(join(tmpdir(), "hshblk-screenshot-"));
const page = await launch(app, file, profile);
const size = (height) =>
  page.send("Emulation.setDeviceMetricsOverride", {
    width: WIDTH,
    height,
    deviceScaleFactor: 2,
    mobile: false,
  });
try {
  await page.until(() => !!document.querySelector(".pg-h1"), START);
  // The window stops short of the room the page leaves under the last line, so the page would
  // scroll, and its scroll bar would show.
  await page.run(() => (document.querySelector(".cm-scroller").style.scrollbarWidth = "none"));
  await size(600);
  for (const scheme of ["light", "dark"]) {
    await page.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-color-scheme", value: scheme }],
    });
    await page.until(drawn(scheme), 60);
    // The diagram and the maths take their height once drawn, so the window is sized after. In a
    // short window CodeMirror has not yet laid out the last lines, so it is measured again in
    // the new one, until the height holds.
    let height = 0;
    for (let tries = 0; tries < 5; tries += 1) {
      const fits = await page.run(fit);
      if (fits === height) break;
      height = fits;
      await size(height);
      await page.run(
        () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
      );
    }
    const { data } = await page.send("Page.captureScreenshot", { format: "png" });
    const out = join(images, `screenshot-${scheme}.png`);
    writeFileSync(out, Buffer.from(data, "base64"));
    console.log(`Wrote ${out}`);
  }
} finally {
  await page.close();
  rmSync(profile, { recursive: true, force: true, maxRetries: 10 });
}
