import { resolve } from "node:path";
import { build, type Plugin } from "vite";
import { overrideMistake } from "./override-mistake.ts";

/** The frame's script, where the page asks for it under the dev server: as Vite's worker. */
const ENTRY = "/src/page/diagram-frame.ts";

/**
 * #349: under the dev server, the frame mermaid draws in gets its script as a build gives it: one
 * classic script, mermaid's assignments rewritten (#221). Vite would serve it as a module, which a
 * frame of no origin may load only with CORS, and with mermaid pre-bundled, where the rewrite
 * never reaches. It is built as the server starts, and again after the frame's script changes.
 */
export function frameInDev(): Plugin {
  let built: Promise<string> | null = null;
  return {
    name: "hshblk-frame-in-dev",
    apply: "serve",
    configureServer(server) {
      const { root, logger } = server.config;
      const entry = resolve(root, `.${ENTRY}`);
      const rebuild = () => {
        built = bundle(root, entry);
        built.catch((error: unknown) => logger.error(`The diagram frame's script: ${error}`));
      };
      rebuild();
      server.watcher.on("change", (file) => {
        if (resolve(file) === entry) rebuild();
      });
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url ?? "/", "http://localhost");
        if (url.pathname !== ENTRY || !url.searchParams.has("worker_file") || !built) return next();
        built.then(
          (code) => {
            response.setHeader("Content-Type", "text/javascript");
            response.setHeader("Cache-Control", "no-store");
            response.end(code);
          },
          (error: unknown) => next(error),
        );
      });
    },
  };
}

/** The frame's script and what it imports, as one classic script. */
async function bundle(root: string, entry: string): Promise<string> {
  const output = await build({
    root,
    configFile: false,
    logLevel: "warn",
    mode: "development",
    plugins: [overrideMistake()],
    build: {
      write: false,
      target: "es2022",
      minify: false,
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
  throw new Error("its build gave no script.");
}
