import { resolve } from "node:path";
import { build, type Plugin } from "vite";
import { overrideMistake } from "./override-mistake.ts";

/** The module the page imports the frame's script from, as its text. */
const ID = "virtual:diagram-frame";
const RESOLVED = `\0${ID}`;

/**
 * #221 and #351: the script of the frame mermaid draws in, built on its own as one classic script,
 * mermaid's assignments rewritten, and given to the page as the text of a module of its own. The
 * page writes it into the frame, which so loads nothing: on Windows, WebView2 sends a sandboxed
 * frame's requests to the network rather than to Tauri at times. The dev server builds it the
 * same way the first time the page asks, and again after the frame's script changes (#349).
 */
export function frameScript(): Plugin {
  let root = "";
  let production = false;
  return {
    name: "hshblk-frame-script",
    configResolved(config) {
      root = config.root;
      production = config.command === "build";
    },
    resolveId(id) {
      return id === ID ? RESOLVED : null;
    },
    async load(id) {
      if (id !== RESOLVED) return null;
      const entry = resolve(root, "src/page/diagram-frame.ts");
      this.addWatchFile(entry);
      return `export default ${JSON.stringify(await bundle(root, entry, production))};`;
    },
  };
}

/** The frame's script and what it imports, as one classic script. */
async function bundle(root: string, entry: string, production: boolean): Promise<string> {
  const output = await build({
    root,
    configFile: false,
    logLevel: "warn",
    mode: production ? "production" : "development",
    plugins: [overrideMistake()],
    build: {
      write: false,
      emptyOutDir: false,
      copyPublicDir: false,
      target: "es2022",
      minify: production,
      rolldownOptions: {
        input: entry,
        output: { format: "iife" },
        // Vite's helper for a dynamic import reads `import.meta`, but mermaid's are inlined.
        checks: { emptyImportMeta: false },
      },
    },
  });
  for (const result of [output].flat()) {
    if (!("output" in result)) continue;
    for (const chunk of result.output) {
      if (chunk.type === "chunk" && chunk.isEntry) return chunk.code;
    }
  }
  throw new Error("The diagram frame's build gave no script.");
}
