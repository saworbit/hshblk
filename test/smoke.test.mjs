/**
 * The built page in a real browser. Run `npm run build` first, then `npm run test:smoke`.
 *
 * Each test leaves a screenshot in test-results/, so a failure in CI can be seen.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { after, afterEach, before, describe, it } from "node:test";
import { chromium } from "playwright";

const PORT = 4317;
const PAGE = `http://127.0.0.1:${PORT}/`;
const RESULTS = "test-results";

const HOSTILE = `# Hostile

<script>window.ran = true</script>

<img src="https://smoke.invalid/raw.png" onerror="window.ran = true">

![remote](https://smoke.invalid/image.png) and [a link](https://smoke.invalid/link).
`;

let server;
let browser;
let page;
let problems;
let hosts;

before(async () => {
  mkdirSync(RESULTS, { recursive: true });
  server = spawn("npm", ["run", "preview", "--", "--port", String(PORT), "--strictPort"], {
    detached: true,
    stdio: "ignore",
    // Without the platform's own script, which loads from grok.com, the page is only the reader.
    env: { ...process.env, VITE_GROK_EXTENSIONS: "0" },
  });
  await reachable(PAGE);
  // CHROMIUM_PATH points at a browser installed outside Playwright, when there is one.
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
});

after(async () => {
  await browser?.close();
  if (server) process.kill(-server.pid);
});

afterEach(async (t) => {
  await page?.screenshot({ path: `${RESULTS}/${t.name.replace(/\W+/g, "-")}.png`, fullPage: true });
  await page?.close();
});

describe("the built page", () => {
  it("paints the sample from this server alone, with nothing logged as an error", async () => {
    await open();
    assert.equal(await page.locator("h1").first().textContent(), "Hash Block");
    assert.deepEqual(problems, []);
    assert.deepEqual([...new Set(hosts)], ["127.0.0.1"]);
  });

  it("reads a hostile file without running it or fetching for it", async () => {
    await open();
    await give("hostile.md", HOSTILE);
    await page.getByRole("heading", { name: "Hostile" }).waitFor();
    assert.equal(await page.evaluate(() => window.ran), undefined);
    assert.ok(await page.getByText("Image not loaded · remote").isVisible());
    assert.deepEqual([...new Set(hosts)], ["127.0.0.1"]);
  });

  it("switches to source with s, and steps the theme with t", async () => {
    await open();
    await page.keyboard.press("s");
    assert.match(await page.locator("main pre").first().textContent(), /^# Hash Block/);
    await page.keyboard.press("s");
    await page.locator("h1").first().waitFor();
    await page.keyboard.press("t");
    assert.equal(await theme(), "paper");
    await page.keyboard.press("t");
    assert.equal(await theme(), "flexoki-light");
  });

  it("keeps the file and the theme across a reload", async () => {
    await open();
    await give("kept.md", "# Kept\n");
    await page.selectOption("select", "tokyo-night");
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Kept" }).waitFor();
    assert.equal(await theme(), "tokyo-night");
    assert.equal(await background(), "rgb(26, 27, 38)");
  });

  it("follows a dark system with Ink", async () => {
    await open({ colorScheme: "dark" });
    assert.equal(await theme(), undefined);
    assert.equal(await background(), "rgb(28, 25, 21)");
  });
});

async function open(options = {}) {
  page = await browser.newPage(options);
  problems = [];
  hosts = [];
  page.on("request", (request) => hosts.push(new URL(request.url()).hostname));
  page.on("pageerror", (error) => problems.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(message.text());
  });
  await page.goto(PAGE, { waitUntil: "networkidle" });
}

async function give(name, text) {
  await page.setInputFiles("input[type=file]", {
    name,
    mimeType: "text/markdown",
    buffer: Buffer.from(text),
  });
}

function theme() {
  return page.evaluate(() => document.documentElement.dataset.theme);
}

function background() {
  return page.evaluate(() => getComputedStyle(document.body).backgroundColor);
}

async function reachable(url, deadline = Date.now() + 60_000) {
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${url} did not answer within a minute`);
}
