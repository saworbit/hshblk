import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import { frameScript } from "./src/build/frame-script.ts";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

// Tauri serves the built page from dist/, and the dev server on a fixed port it expects.
export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    // The welcome screen imports the mark from brand/, a folder up from this one.
    fs: { allow: [".."] },
  },
  // The diagram frame's script, mermaid whole, is one chunk of 3.4 MB. The page's own are far less.
  build: { target: "es2022", outDir: "dist", chunkSizeWarningLimit: 3_600 },
  // The frame mermaid draws in runs one classic script, its imports inlined and the assignments
  // the frozen prototype would refuse rewritten (#221), which the page writes into it (#351).
  plugins: [frameScript()],
  // The version the welcome window shows (#238). A release checks it against the other two.
  define: { __VERSION__: JSON.stringify(version) },
});
