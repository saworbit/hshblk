import type { Parser, Tree } from "@lezer/common";
import { highlightTree, tagHighlighter, tags } from "@lezer/highlight";

/**
 * #217: the languages a fenced code block may name, by the names it may use, and how to load
 * each one's parser. Each is a chunk of its own, loaded the first time a block names it. They
 * parse with Lezer, as the page does, and interpret no markdown.
 */
const LANGUAGES: { names: string[]; load: () => Promise<Parser> }[] = [
  {
    names: ["js", "javascript", "jsx", "mjs", "cjs"],
    load: () =>
      import("@lezer/javascript").then(({ parser }) => parser.configure({ dialect: "jsx" })),
  },
  {
    names: ["ts", "typescript", "tsx", "mts", "cts"],
    load: () =>
      import("@lezer/javascript").then(({ parser }) => parser.configure({ dialect: "ts jsx" })),
  },
  { names: ["py", "python"], load: () => import("@lezer/python").then(({ parser }) => parser) },
  { names: ["rs", "rust"], load: () => import("@lezer/rust").then(({ parser }) => parser) },
  { names: ["json", "jsonc"], load: () => import("@lezer/json").then(({ parser }) => parser) },
  {
    names: ["sh", "bash", "shell", "zsh"],
    load: () =>
      Promise.all([import("@codemirror/language"), import("@codemirror/legacy-modes/mode/shell")])
        .then(([{ StreamLanguage }, { shell }]) => StreamLanguage.define(shell).parser),
  },
  {
    names: ["diff", "patch"],
    load: () =>
      Promise.all([import("@codemirror/language"), import("@codemirror/legacy-modes/mode/diff")])
        .then(([{ StreamLanguage }, { diff }]) => StreamLanguage.define(diff).parser),
  },
];

/** Each language by every name it may go by. */
const BY_NAME = new Map(LANGUAGES.flatMap((language) => language.names.map((n) => [n, language])));

/** The parsers loaded so far, and those loading. */
const parsers = new Map<(typeof LANGUAGES)[number], Parser>();
const loading = new Map<(typeof LANGUAGES)[number], Promise<void>>();

/** The language an info string names: its first word, in any case. */
function languageOf(info: string): (typeof LANGUAGES)[number] | undefined {
  return BY_NAME.get(info.trim().split(/[\s{]/)[0].toLowerCase());
}

/**
 * The parser for a block's info string: loaded, or null when it names no language this page
 * knows, or "loading" while its parser loads, which `loadParser` waits on.
 */
export function parserFor(info: string): Parser | null | "loading" {
  const language = languageOf(info);
  if (!language) return null;
  return parsers.get(language) ?? "loading";
}

/** Loads the parser an info string names, once, and says when it is there. */
export function loadParser(info: string): Promise<void> {
  const language = languageOf(info);
  if (!language) return Promise.resolve();
  let load = loading.get(language);
  if (!load) {
    load = language.load().then((parser) => void parsers.set(language, parser));
    loading.set(language, load);
  }
  return load;
}

/** Each kind of token as a class, which the theme colours by day and by night. */
const highlighter = tagHighlighter([
  {
    tag: [
      tags.keyword,
      tags.controlKeyword,
      tags.definitionKeyword,
      tags.moduleKeyword,
      tags.operatorKeyword,
      tags.self,
    ],
    class: "pg-tok-keyword",
  },
  {
    tag: [tags.string, tags.special(tags.string), tags.regexp, tags.character],
    class: "pg-tok-string",
  },
  {
    tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment],
    class: "pg-tok-comment",
  },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], class: "pg-tok-literal" },
  {
    tag: [
      tags.function(tags.variableName),
      tags.function(tags.definition(tags.variableName)),
      tags.standard(tags.variableName),
    ],
    class: "pg-tok-function",
  },
  { tag: [tags.typeName, tags.className, tags.namespace], class: "pg-tok-type" },
  { tag: tags.inserted, class: "pg-tok-inserted" },
  { tag: tags.deleted, class: "pg-tok-deleted" },
  { tag: [tags.meta, tags.heading], class: "pg-tok-meta" },
]);

/** The code parsed last, by language and text, so painting it again parses nothing. */
const trees = new Map<string, Tree>();

/** How many blocks' trees are kept. */
const KEPT = 200;

/**
 * Each token of `code` from `from` to `to`, as its class, to `put`, by the parser `parser`.
 * Positions are within `code`.
 */
export function highlightCode(
  parser: Parser,
  code: string,
  from: number,
  to: number,
  put: (from: number, to: number, classes: string) => void,
): void {
  const key = `${LANGUAGES.findIndex((l) => parsers.get(l) === parser)}\u0000${code}`;
  let tree = trees.get(key);
  if (!tree) {
    tree = parser.parse(code);
    trees.set(key, tree);
    if (trees.size > KEPT) trees.delete(trees.keys().next().value!);
  }
  highlightTree(tree, highlighter, put, from, to);
}
