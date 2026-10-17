import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import { overrideMistake } from "./src/build/override-mistake.ts";

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
  build: { target: "es2022", outDir: "dist" },
  // The frame mermaid draws in loads its script as a classic one, from no origin of its own, which
  // a module could not be, and Vite builds a worker's script that way, its imports inlined. Its
  // dependencies' assignments the frozen prototype would refuse are rewritten (#221).
  worker: { format: "iife", plugins: () => [overrideMistake()] },
  // The version the welcome window shows (#238). A release checks it against the other two.
  define: { __VERSION__: JSON.stringify(version) },
});
