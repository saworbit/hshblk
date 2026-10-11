/**
 * docs/hld.md §9, the corpus run, the half that measures: what real markdown files hold that
 * the open decisions depend on. Each argument is a repository, or the part of one to survey.
 * Images are read as the app reads them, scoped to the repository the files are in.
 *
 *   node test/gate/corpus.ts <repo>...
 *
 * Prints a markdown report.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { Text } from "@codemirror/state";
import { filePath } from "../../src/page/assets.ts";
import { scanNow } from "../../src/page/blocks.ts";
import { dialect } from "../../src/page/dialect.ts";
import { destination } from "../../src/page/references.ts";

type Endings = "none" | "lf" | "crlf" | "mixed";

type Survey = {
  files: number;
  bytes: number;
  largest: { path: string; bytes: number };
  bom: number;
  invalidUtf8: number;
  nul: number;
  endings: Record<Endings, number>;
  rawHtml: number;
  images: {
    remote: number;
    beside: number;
    up: number;
    root: number;
    outside: number;
    unresolved: number;
  };
  filesWithUpImages: number;
};

/** The git repository a folder is in, as the app scopes a document's images, or null. */
function repository(dir: string): string | null {
  for (let at = dir; ; at = dirname(at)) {
    if (existsSync(join(at, ".git"))) return at;
    if (dirname(at) === at) return null;
  }
}

function survey(root: string): Survey {
  // The scope the app would give these files: their repository, or the folder surveyed.
  const scope = repository(root) ?? root;
  const result: Survey = {
    files: 0,
    bytes: 0,
    largest: { path: "", bytes: 0 },
    bom: 0,
    invalidUtf8: 0,
    nul: 0,
    endings: { none: 0, lf: 0, crlf: 0, mixed: 0 },
    rawHtml: 0,
    images: { remote: 0, beside: 0, up: 0, root: 0, outside: 0, unresolved: 0 },
    filesWithUpImages: 0,
  };
  for (const file of markdownFiles(root)) {
    const bytes = readFileSync(file);
    result.files += 1;
    result.bytes += bytes.length;
    if (bytes.length > result.largest.bytes)
      result.largest = { path: relative(root, file), bytes: bytes.length };
    const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
    if (bom) result.bom += 1;
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        bom ? bytes.subarray(3) : bytes,
      );
    } catch {
      result.invalidUtf8 += 1;
      text = new TextDecoder().decode(bytes);
    }
    if (text.includes("\0")) result.nul += 1;
    result.endings[endings(text)] += 1;
    const doc = Text.of(text.split(/\r\n?|\n/));
    const tree = dialect.parse(doc.toString());
    const { definitions } = scanNow(doc, tree);
    let html = false;
    let up = false;
    tree.iterate({
      enter(ref) {
        if (ref.name === "HTMLBlock" || ref.name === "HTMLTag") html = true;
        if (ref.name !== "Image") return;
        const reference = destination(doc, ref.node, definitions);
        const kind = classify(scope, file, reference);
        result.images[kind] += 1;
        if (kind === "up") up = true;
      },
    });
    if (html) result.rawHtml += 1;
    if (up) result.filesWithUpImages += 1;
  }
  return result;
}

/** Where an image points, read as the app reads it: after one leading slash, from the scope's root. */
function classify(scope: string, file: string, reference: string | null): keyof Survey["images"] {
  if (reference === null || reference === "") return "unresolved";
  if (/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(reference)) return "remote";
  const path = filePath(reference);
  const fromRoot = path.startsWith("/");
  const target = resolve(fromRoot ? scope : dirname(file), path.replace(/^\//, ""));
  if (target !== scope && !target.startsWith(scope + sep)) return "outside";
  if (fromRoot) return "root";
  return path.split("/").includes("..") ? "up" : "beside";
}

function endings(text: string): Endings {
  const crlf = text.match(/\r\n/g)?.length ?? 0;
  const cr = (text.match(/\r/g)?.length ?? 0) - crlf;
  const lf = (text.match(/\n/g)?.length ?? 0) - crlf;
  if (lf + crlf + cr === 0) return "none";
  if (crlf === 0 && cr === 0) return "lf";
  if (lf === 0 && cr === 0) return "crlf";
  return "mixed";
}

function* markdownFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* markdownFiles(path);
    else if (/\.(md|markdown)$/i.test(entry.name) && statSync(path).isFile()) yield path;
  }
}

const roots = process.argv.slice(2).map((root) => resolve(root));
if (roots.length === 0) throw new Error("usage: corpus.ts <repo>...");
const surveys = roots.map((root) => ({
  name: basename(repository(root) ?? root),
  ...survey(root),
}));
const total = surveys.reduce((sum, s) => sum + s.files, 0);
const percent = (n: number, of = total) => `${n} (${((100 * n) / of).toFixed(1)}%)`;
const sum = (pick: (s: Survey) => number) => surveys.reduce((n, s) => n + pick(s), 0);

console.log(`${total} files in ${surveys.length} repositories.\n`);
console.log(
  "| Repository | Files | Mixed endings | CRLF | BOM | Invalid UTF-8 | Raw HTML | Images beside | Images via `../` | Images from the root | Remote images | Largest |",
);
console.log("|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const s of surveys) {
  console.log(
    `| ${s.name} | ${s.files} | ${s.endings.mixed} | ${s.endings.crlf} | ${s.bom} | ${s.invalidUtf8} | ${s.rawHtml} | ${s.images.beside} | ${s.images.up} | ${s.images.root} | ${s.images.remote} | ${(s.largest.bytes / 1024).toFixed(0)} KB |`,
  );
}
const largest = surveys.reduce((a, b) => (b.largest.bytes > a.largest.bytes ? b : a));
console.log(`
- Mixed or lone-CR line endings: ${percent(sum((s) => s.endings.mixed))}. Uniform CRLF: ${percent(sum((s) => s.endings.crlf))}.
- A BOM: ${percent(sum((s) => s.bom))}. Invalid UTF-8: ${percent(sum((s) => s.invalidUtf8))}. NUL bytes: ${percent(sum((s) => s.nul))}.
- Raw HTML, as a block or inline: ${percent(sum((s) => s.rawHtml))}.
- Images: ${sum((s) => s.images.beside)} beside the file or below it, ${sum((s) => s.images.up)} via \`../\` inside the repository (in ${percent(sum((s) => s.filesWithUpImages))}), ${sum((s) => s.images.root)} from its root after a leading \`/\`, ${sum((s) => s.images.outside)} outside it, ${sum((s) => s.images.remote)} remote, ${sum((s) => s.images.unresolved)} unresolved references.
- Largest file: ${largest.name}/${largest.largest.path}, ${(largest.largest.bytes / 1024).toFixed(0)} KB.`);
