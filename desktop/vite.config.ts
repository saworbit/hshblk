import { defineConfig } from "vite";

// Tauri serves the built page from dist/, and the dev server on a fixed port it expects.
export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: "es2022", outDir: "dist" },
});
