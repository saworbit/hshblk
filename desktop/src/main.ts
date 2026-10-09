import { EditorState } from "@codemirror/state";
import { EditorView, Decoration, type DecorationSet, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { LRLanguage, syntaxTree } from "@codemirror/language";
import { parser as markdownParser } from "@lezer/markdown";
import "./app.css";

const markdownLanguage = LRLanguage.define({
  name: "markdown",
  parser: markdownParser.configure([]) as never,
});

const SAMPLE = `# Hash Block

A page, not a buffer. Syntax stays in the file and hides on the page.

Emphasis is *italic* and **bold**. A \`name\` stays monospaced.

- headings are hash blocks
- the file is not rewritten
- remote images do not load

> Raw HTML is source, not a widget.

\`\`\`
# this fence is still text
\`\`\`
`;

function decorate(view: EditorView): DecorationSet {
  const marks: ReturnType<Decoration["range"]>[] = [];
  const tree = syntaxTree(view.state);
  for (const cursor = tree.cursor(); cursor.next(); ) {
    const name = cursor.name;
    const from = cursor.from;
    const to = cursor.to;
    if (name === "HeaderMark" || name === "EmphasisMark" || name === "CodeMark" || name === "LinkMark" || name === "QuoteMark") {
      marks.push(Decoration.mark({ class: "hsh-hidden" }).range(from, to));
    } else if (name === "ATXHeading1") {
      marks.push(Decoration.mark({ class: "hsh-h1" }).range(from, to));
    } else if (name === "ATXHeading2") {
      marks.push(Decoration.mark({ class: "hsh-h2" }).range(from, to));
    } else if (name === "ATXHeading3" || name === "ATXHeading4" || name === "ATXHeading5" || name === "ATXHeading6") {
      marks.push(Decoration.mark({ class: "hsh-h3" }).range(from, to));
    } else if (name === "Emphasis") {
      marks.push(Decoration.mark({ class: "hsh-em" }).range(from, to));
    } else if (name === "StrongEmphasis") {
      marks.push(Decoration.mark({ class: "hsh-strong" }).range(from, to));
    } else if (name === "InlineCode") {
      marks.push(Decoration.mark({ class: "hsh-code" }).range(from, to));
    } else if (name === "FencedCode" || name === "CodeBlock") {
      marks.push(Decoration.mark({ class: "hsh-fence" }).range(from, to));
    } else if (name === "Link") {
      marks.push(Decoration.mark({ class: "hsh-link" }).range(from, to));
    } else if (name === "Blockquote") {
      marks.push(Decoration.mark({ class: "hsh-quote" }).range(from, to));
    }
  }
  marks.sort((a, b) => a.from - b.from || a.to - b.to);
  return Decoration.set(marks, true);
}

const page = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = decorate(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) this.decorations = decorate(update.view);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

const theme = EditorView.theme({
  "&": { background: "transparent" },
  ".cm-content": { fontFamily: "inherit" },
});

function mount(doc: string, name: string) {
  const stage = document.querySelector("#stage");
  if (!stage) return;
  stage.replaceChildren();
  const title = document.querySelector("header span");
  if (title) title.textContent = name;
  new EditorView({
    parent: stage,
    state: EditorState.create({
      doc,
      extensions: [
        EditorState.readOnly.of(true),
        markdownLanguage,
        page,
        theme,
        EditorView.lineWrapping,
        EditorView.editable.of(false),
      ],
    }),
  });
}

function shell() {
  const app = document.querySelector("#app");
  if (!app) return;
  app.innerHTML = `
    <header>
      <strong>hshblk</strong>
      <span>no file</span>
      <button type="button" id="open">Open</button>
    </header>
    <div id="stage"></div>
  `;
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".md,.markdown,text/markdown";
  input.hidden = true;
  document.body.append(input);
  document.querySelector("#open")?.addEventListener("click", () => input.click());
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file) void read(file);
  });
  window.addEventListener("dragover", (event) => event.preventDefault());
  window.addEventListener("drop", (event) => {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if (file) void read(file);
  });
  mount(SAMPLE, "sample");
}

async function read(file: File) {
  mount(await file.text(), file.name);
}

shell();
