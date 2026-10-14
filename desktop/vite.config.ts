import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

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
  // The version the welcome window shows (#238). A release checks it against the other two.
  define: { __VERSION__: JSON.stringify(version) },
});
