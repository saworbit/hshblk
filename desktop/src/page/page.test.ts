import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { showTooltip, type DecorationSet } from "@codemirror/view";
import { filePath, isSibling } from "./assets.ts";
import { markdown } from "./dialect.ts";
import { around } from "./links.ts";
import { foldAll, page } from "./page.ts";
import { headingAt, headings } from "./references.ts";
import { ImageWidget, TableWidget, TextWidget, type TableModel } from "./widgets.ts";

/** A page with its whole tree parsed, as the reader sees it once the parse is done. */
function open(doc: string): EditorState {
  const state = EditorState.create({ doc, extensions: [markdown, page] });
  ensureSyntaxTree(state, state.doc.length, 5000);
  return state.update({}).state;
}

/** The reader puts the cursor at `pos`, by pointer or key. */
function select(state: EditorState, pos: number): EditorState {
  return state.update({ selection: { anchor: pos }, userEvent: "select.pointer" }).state;
}

/** The text on the page: the source, less what is hidden, with each widget named. */
function visible(state: EditorState): string {
  const { styles, shown } = state.field(page);
  const replaced: { from: number; to: number; widget: unknown }[] = [];
  for (const set of [styles, shown]) {
    set.between(0, state.doc.length, (from, to, decoration) => {
      // A replacement is a point decoration that covers text or draws something. Marks and lines are not.
      if (decoration.point && (from < to || decoration.spec.widget))
        replaced.push({ from, to, widget: decoration.spec.widget });
    });
  }
  let out = "";
  let pos = 0;
  for (const { from, to, widget } of replaced.sort((a, b) => a.from - b.from)) {
    out += state.doc.sliceString(pos, from) + named(widget);
    pos = to;
  }
  return out + state.doc.sliceString(pos);
}

function named(widget: unknown): string {
  if (widget instanceof TextWidget) return widget.text;
  if (widget instanceof ImageWidget) return `[image ${widget.reference} · ${widget.alt}]`;
  if (widget instanceof TableWidget) return `[table ${widget.table.rows.length} rows]`;
  return "";
}

/** The classes on each line, wherever the selection is and wherever it is not. */
function lineClasses(state: EditorState, set: (state: EditorState) => DecorationSet): string[] {
  const classes = state.doc
    .toString()
    .split("\n")
    .map(() => "");
  set(state).between(0, state.doc.length, (from, to, decoration) => {
    if (from !== to || !decoration.spec.class || decoration.spec.widget) return;
    const line = state.doc.lineAt(from).number - 1;
    classes[line] = `${classes[line]} ${decoration.spec.class}`.trim();
  });
  return classes;
}

const styles = (state: EditorState) => state.field(page).styles;
const shown = (state: EditorState) => state.field(page).shown;

describe("the page", () => {
  it("hides heading marks, opening and closing, with their spaces", () => {
    const state = open("# Hash *Block*\n\n## Title ##");
    assert.equal(visible(state), "Hash Block\n\nTitle");
    assert.deepEqual(lineClasses(state, styles), ["pg-heading pg-h1", "", "pg-heading pg-h2"]);
  });

  it("collapses a setext underline and styles the lines above it", () => {
    const state = open("Title\nsecond line\n===\n\nBody");
    assert.equal(visible(state), "Title\nsecond line\n\n\nBody");
    assert.deepEqual(lineClasses(state, styles).slice(0, 2), [
      "pg-heading pg-h1",
      "pg-heading pg-h1",
    ]);
    assert.equal(lineClasses(state, shown)[2], "pg-collapsed");
  });

  it("hides emphasis, strong, strikethrough, and code marks", () => {
    assert.equal(visible(open("*a* **b** ~~c~~ `d` ~e~")), "a b c d ~e~");
  });

  it("shows a link's words, and leaves an unresolved reference as written", () => {
    const state = open('[up](https://x.y "T") [ref][r] [gone][nowhere]\n\n[r]: /ridge');
    assert.equal(visible(state), "up ref [gone][nowhere]\n\n");
    const titles: string[] = [];
    styles(state).between(0, state.doc.length, (_from, _to, decoration) => {
      if (decoration.spec.attributes?.title) titles.push(decoration.spec.attributes.title);
    });
    assert.deepEqual(titles, ["https://x.y", "/ridge"]);
  });

  it("names each heading by the anchor GitHub gives it", () => {
    const doc =
      "# Tables\n\n## Tables\n\nSetext *Title*\n===\n\n# Café & *Co.* #\n\n#\n\n### Ends in **bold**";
    const state = open(doc);
    assert.deepEqual(Object.fromEntries(state.facet(headings)), {
      tables: 0,
      "tables-1": doc.indexOf("## Tables"),
      "setext-title": doc.indexOf("Setext"),
      "café--co": doc.indexOf("# Café"),
      "ends-in-bold": doc.indexOf("### Ends"),
    });
    assert.equal(headingAt(state, "#tables-1"), doc.indexOf("## Tables"));
    assert.equal(headingAt(state, "#caf%C3%A9--co"), doc.indexOf("# Café"));
    assert.equal(headingAt(state, "#nothing-here"), undefined);
    assert.equal(headingAt(state, "tables"), undefined);
  });

  it("shows an autolink's address without its angle brackets", () => {
    assert.equal(visible(open("Mail <me@x.y> or <https://x.y>.")), "Mail me@x.y or https://x.y.");
  });

  it("points an email autolink at mailto:, on the page and in a table", () => {
    const state = open("Mail <me@x.y> or <https://x.y>.\n\n| a |\n|---|\n| <cell@x.y> |");
    const hrefs: string[] = [];
    let model: TableModel | undefined;
    for (const set of [styles(state), shown(state)]) {
      set.between(0, state.doc.length, (_from, _to, decoration) => {
        if (decoration.spec.attributes?.["data-href"])
          hrefs.push(decoration.spec.attributes["data-href"]);
        if (decoration.spec.widget instanceof TableWidget) model = decoration.spec.widget.table;
      });
    }
    assert.deepEqual(hrefs, ["mailto:me@x.y", "https://x.y"]);
    assert.deepEqual(model?.rows[0][0], [
      { kind: "link", href: "mailto:cell@x.y", children: [{ kind: "text", text: "cell@x.y" }] },
    ]);
  });

  it("paints escaped characters and decoded entities", () => {
    assert.equal(visible(open("\\*not\\* &amp; &copy; &bogus;")), "*not* & © &bogus;");
  });

  it("stands an image in by its reference and words", () => {
    assert.equal(
      visible(open("![ridge at *dusk*](images/ridge.png)")),
      "[image images/ridge.png · ridge at dusk]",
    );
  });

  it("keeps an image in its line, unless it is all its paragraph holds", () => {
    const state = open(
      "![alone](a.png)\n\n[![linked](b.png)](https://x.y)\n\nText ![in](c.png) line.\n\n" +
        "[![CI](d.svg)](https://x.y) [![npm](e.svg)](https://x.y)\n\n" +
        "[![gone](f.png)][nowhere]\n\n# ![heading](g.png)",
    );
    const inline: Record<string, boolean> = {};
    shown(state).between(0, state.doc.length, (_from, _to, decoration) => {
      const widget = decoration.spec.widget;
      if (widget instanceof ImageWidget) inline[widget.alt] = widget.inline;
    });
    assert.deepEqual(inline, {
      alone: false,
      linked: false,
      in: true,
      CI: true,
      npm: true,
      gone: true,
      heading: true,
    });
  });

  it("reads escapes and entities in a destination, and keeps percent escapes", () => {
    assert.equal(
      visible(open("![a](screen\\_shot.png) ![b](<a &amp; b.png>) ![c](c%20d.png)")),
      "[image screen_shot.png · a] [image a & b.png · b] [image c%20d.png · c]",
    );
    const state = open("[x][r]\n\n[r]: https://x.y/?a=1&amp;b=\\*");
    const titles: string[] = [];
    styles(state).between(0, state.doc.length, (_from, _to, decoration) => {
      if (decoration.spec.attributes?.title) titles.push(decoration.spec.attributes.title);
    });
    assert.deepEqual(titles, ["https://x.y/?a=1&b=*"]);
  });

  it("draws a table in place of its source", () => {
    const state = open("Before\n\n| a | *b* |\n|---|--:|\n| c | d |\n\nAfter");
    assert.equal(visible(state), "Before\n\n[table 1 rows]\n\nAfter");
    let model: unknown;
    shown(state).between(0, state.doc.length, (_from, _to, decoration) => {
      if (decoration.spec.widget instanceof TableWidget) model = decoration.spec.widget.table;
    });
    assert.deepEqual(model, {
      align: [null, "right"],
      head: [
        [{ kind: "text", text: "a" }],
        [{ kind: "emphasis", children: [{ kind: "text", text: "b" }] }],
      ],
      rows: [[[{ kind: "text", text: "c" }], [{ kind: "text", text: "d" }]]],
    });
  });

  it("takes the backslash off an escaped pipe in a table cell's code, and nowhere else", () => {
    const state = open("| a |\n|---|\n| `c \\| d` |\n\n`a \\| b`");
    let model: unknown;
    shown(state).between(0, state.doc.length, (_from, _to, decoration) => {
      if (decoration.spec.widget instanceof TableWidget) model = decoration.spec.widget.table;
    });
    assert.deepEqual(model, {
      align: [null],
      head: [[{ kind: "text", text: "a" }]],
      rows: [[[{ kind: "code", text: "c | d" }]]],
    });
    assert.equal(visible(state), "[table 1 rows]\n\na \\| b");
  });

  it("hides quote marks and keeps list markers as written", () => {
    const state = open("> one\n> two\n\n- a\n1. b");
    assert.equal(visible(state), "one\ntwo\n\n- a\n1. b");
    assert.deepEqual(lineClasses(state, styles).slice(0, 2), ["pg-quote", "pg-quote"]);
  });

  it("hangs a list item's lines under its text, at every level", () => {
    const doc = "- one\n  more\n- two\n  1. nested\n     deeper\nlazy\n\n> - quoted";
    const state = open(doc);
    assert.equal(
      visible(state),
      "- one\n  more\n- two\n  1. nested\n     deeper\nlazy\n\n- quoted",
    );
    assert.deepEqual(lineClasses(state, styles), [
      "pg-hang-2",
      "pg-hang-2",
      "pg-hang-2",
      "pg-hang-5",
      "pg-hang-5",
      "pg-pad-5",
      "",
      "pg-quote",
    ]);
    const boxes: string[] = [];
    styles(state).between(0, state.doc.length, (from, to, decoration) => {
      if (/pg-box|pg-list-mark/.test(decoration.spec.class ?? ""))
        boxes.push(`${JSON.stringify(state.sliceDoc(from, to))} ${decoration.spec.class}`);
    });
    assert.deepEqual(boxes, [
      '"- " pg-list-mark pg-box-2',
      '"  " pg-box-2',
      '"- " pg-list-mark pg-box-2',
      '"  " pg-box-2',
      '"1. " pg-list-mark pg-box-3',
      '"     " pg-box-5',
      '"-" pg-list-mark',
    ]);
  });

  it("leaves code, raw HTML, bare addresses, and task boxes as the source", () => {
    const doc =
      "```js\n**not bold**\n```\n\n<div>raw</div>\n\nA <b>tag</b>, https://x.y, and - [x] a box.";
    const state = open(doc);
    assert.equal(visible(state), doc);
    assert.deepEqual(lineClasses(state, styles).slice(0, 5), [
      "pg-code-block pg-fence",
      "pg-code-block",
      "pg-code-block pg-fence",
      "",
      "pg-source-block",
    ]);
  });

  it("draws a rule in place of its marks", () => {
    const state = open("a\n\n---\n\nb");
    assert.equal(visible(state), "a\n\n\n\nb");
    assert.equal(lineClasses(state, shown)[2], "pg-rule");
  });
});

describe("unfolding", () => {
  const doc = "# Title\n\nSome **bold** words.";

  it("opens nothing on arrival, though the cursor starts in the title", () => {
    assert.equal(visible(open(doc)), "Title\n\nSome bold words.");
  });

  it("shows the syntax of what the reader selects, and hides it again when they leave", () => {
    const inBold = select(open(doc), doc.indexOf("bold"));
    assert.equal(visible(inBold), "Title\n\nSome **bold** words.");
    const inTitle = select(inBold, 3);
    assert.equal(visible(inTitle), "# Title\n\nSome bold words.");
  });

  it("never unfolds a link: its address shows at the caret instead", () => {
    const linked = "See [the ridge](https://x.y/ridge) today.";
    const inLink = select(open(linked), linked.indexOf("ridge"));
    assert.equal(visible(inLink), "See the ridge today.");
    const tooltips = inLink.facet(showTooltip).filter(Boolean);
    assert.equal(tooltips.length, 1);
    assert.equal(tooltips[0]?.pos, linked.indexOf("the ridge"));
    assert.deepEqual(select(inLink, 1).facet(showTooltip).filter(Boolean), []);
  });

  it("shows a link's address when a find match lies in its hidden syntax", () => {
    const linked = "See [the ridge](https://x.y/ridge) today.";
    const at = linked.indexOf("x.y");
    const found = open(linked).update({
      selection: { anchor: at, head: at + 3 },
      userEvent: "select.search",
    }).state;
    assert.equal(visible(found), "See the ridge today.");
    const tooltips = found.facet(showTooltip).filter(Boolean);
    assert.equal(tooltips.length, 1);
    assert.equal(tooltips[0]?.pos, linked.indexOf("the ridge"));
    // A match in the words shows on the page, and a selection past the link is not in it.
    for (const [anchor, head] of [
      [linked.indexOf("ridge"), linked.indexOf("ridge") + 5],
      [0, linked.length],
    ]) {
      const selected = found.update({ selection: { anchor, head }, userEvent: "select" }).state;
      assert.deepEqual(selected.facet(showTooltip).filter(Boolean), []);
    }
  });

  it("marks the found text in the address, where it is there", () => {
    assert.deepEqual(around("https://x.y/ridge", "x.y"), ["https://", "x.y", "/ridge"]);
    assert.equal(around("https://x.y/ridge", "](https"), null);
    assert.equal(around("https://x.y/ridge", ""), null);
  });

  it("unfolds a table to its source when the selection enters it", () => {
    const table = "| a |\n|---|\n| b |";
    assert.equal(visible(select(open(table), 2)), table);
  });

  it("folds everything again for print, until the reader selects once more", () => {
    const inBold = select(open(doc), doc.indexOf("bold"));
    const folded = inBold.update({ effects: foldAll.of(null) }).state;
    assert.equal(visible(folded), "Title\n\nSome bold words.");
    assert.equal(visible(select(folded, doc.indexOf("bold"))), "Title\n\nSome **bold** words.");
  });
});

describe("line endings", () => {
  it("paints a CRLF file as it paints an LF one", () => {
    const lf = "# Title\n\n| a |\n|---|\n| b |\n\n*x*";
    assert.equal(visible(open(lf.replace(/\n/g, "\r\n"))), visible(open(lf)));
  });
});

describe("an image's file", () => {
  it("is the destination decoded once, less its query and fragment", () => {
    assert.equal(filePath("screen%20shot.png"), "screen shot.png");
    assert.equal(filePath("caf%C3%A9.png?v=2#top"), "café.png");
    assert.equal(filePath("./near.png?v=2"), "./near.png");
    assert.equal(filePath("c%23.png"), "c#.png");
    assert.equal(filePath("100%25.png"), "100%.png");
  });

  it("is the destination as written when a percent sign escapes nothing", () => {
    assert.equal(filePath("100%.png"), "100%.png");
    assert.equal(filePath("%FF.png"), "%FF.png");
  });

  it("is checked once decoded, so an escaped slash cannot make it absolute", () => {
    assert.equal(filePath("..%2F..%2Fsecret.png"), "../../secret.png");
    assert.equal(isSibling(filePath("%2Fetc%2Fhostname")), false);
    assert.equal(isSibling(filePath("file%3Asecret.png")), false);
  });
});
