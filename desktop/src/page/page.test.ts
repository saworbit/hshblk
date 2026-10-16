import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState, RangeSet, type StateCommand } from "@codemirror/state";
import { showTooltip, type DecorationSet } from "@codemirror/view";
import {
  assetUrl,
  filePath,
  imageRefusal,
  imageUrl,
  isLocal,
  refusalOf,
  unloaded,
} from "./assets.ts";
import { markdown } from "./dialect.ts";
import { emojiOf, loadEmoji } from "./emoji.ts";
import {
  around,
  destinationOf,
  jumpBack,
  jumpForward,
  jumpTo,
  modClickOpens,
  printedAddress,
  showFrameLink,
} from "./links.ts";
import { scan, scanNow } from "./blocks.ts";
import {
  foldAll,
  page,
  paint,
  printing,
  sourceShown,
  startOfPage,
  toggleDetailsAtCaret,
  toggleSource,
  toggleTaskAtCaret,
} from "./page.ts";
import { headingAt, headings } from "./references.ts";
import {
  AlertWidget,
  HtmlWidget,
  ImageWidget,
  NoteMarkWidget,
  NoteReferenceWidget,
  SummaryWidget,
  TableWidget,
  TaskWidget,
  TextWidget,
  toggleDetails,
  toggleTask,
  type TableModel,
} from "./widgets.ts";

/** A page with its whole tree parsed, as the reader sees it once the parse is done. */
function open(doc: string): EditorState {
  const state = EditorState.create({ doc, extensions: [markdown, page] });
  ensureSyntaxTree(state, state.doc.length, 5000);
  return state.update({}).state;
}

/** The reader moves the cursor to `pos` with the keys. */
function select(state: EditorState, pos: number): EditorState {
  return state.update({ selection: { anchor: pos }, userEvent: "select" }).state;
}

/** The reader clicks at `pos`. */
function click(state: EditorState, pos: number): EditorState {
  return state.update({ selection: { anchor: pos }, userEvent: "select.pointer" }).state;
}

/** The whole page's decorations, as print draws them: its inline syntax, and its blocks. */
function drawn(state: EditorState): { styles: DecorationSet; shown: DecorationSet } {
  const { styles, shown } = paint(state, { from: 0, to: state.doc.length });
  return { styles, shown: RangeSet.join([shown, state.field(page).shown]) };
}

/** The text on the page: the source, less what is hidden, with each widget named. */
function visible(state: EditorState): string {
  const { styles, shown } = drawn(state);
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
  for (const { from, to, widget } of replaced.sort((a, b) => a.from - b.from || b.to - a.to)) {
    // One inside another, such as a quote's mark in a drawn block, is drawn by the outer one.
    if (from < pos) continue;
    out += state.doc.sliceString(pos, from) + named(widget);
    pos = to;
  }
  return out + state.doc.sliceString(pos);
}

function named(widget: unknown): string {
  if (widget instanceof TextWidget) return widget.text;
  if (widget instanceof AlertWidget) return `[${widget.kind}]`;
  if (widget instanceof NoteReferenceWidget) return `[ref ${widget.number}]`;
  if (widget instanceof NoteMarkWidget) return widget.number ? `[note ${widget.number}]` : "[back]";
  if (widget instanceof ImageWidget) return `[image ${widget.reference} · ${widget.alt}]`;
  if (widget instanceof TableWidget) return `[table ${widget.table.rows.length} rows]`;
  if (widget instanceof HtmlWidget) return `[html ${widget.html}]`;
  if (widget instanceof SummaryWidget)
    return `[summary ${widget.summary}${widget.open ? " open" : ""}]`;
  if (widget instanceof TaskWidget) {
    // In a bullet's place it is as wide as the bullet and its spaces (#212).
    const pad = " ".repeat(Math.max((widget.columns ?? 1) - 1, 0));
    return (widget.checked ? "[ticked]" : "[box]") + pad;
  }
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

const styles = (state: EditorState) => drawn(state).styles;
const shown = (state: EditorState) => drawn(state).shown;

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
    assert.equal(visible(open("*a* **b** ~~c~~ `d` ~e~")), "a b c d e");
  });

  it("strikes text through between single tildes, as GitHub does, one only with one", () => {
    // #223: a file written for GitHub read with stray tildes.
    const doc = "~struck~ and ~~two~~, not ~one~~ or ~/a to ~/b";
    const state = open(doc);
    assert.equal(visible(state), "struck and two, not ~one~~ or ~/a to ~/b");
    const struck: string[] = [];
    styles(state).between(0, doc.length, (from, to, decoration) => {
      if (decoration.spec.class === "pg-strike") struck.push(doc.slice(from, to));
    });
    assert.deepEqual(struck, ["~struck~", "~~two~~"]);
    assert.equal(visible(select(state, 3)), doc.replace("~~two~~", "two"));
  });

  it("hides the space at each end of a code span that CommonMark strips, with its marks", () => {
    // #210: one space comes off each end when both have one and the span is not all spaces.
    const doc = "`` a `tick` inside `` and `` ` `` and ` ` and `  x  ` and ` y`";
    const state = open(doc);
    assert.equal(visible(state), "a `tick` inside and ` and   and  x  and  y");
    assert.equal(visible(select(state, doc.indexOf("tick"))).slice(0, 21), "`` a `tick` inside ``");
  });

  it("shows a link's words, and leaves an unresolved reference as written", () => {
    const state = open('[up](https://x.y "T") [ref][r] [gone][nowhere]\n\n[r]: /ridge');
    assert.equal(visible(state), "up ref [gone][nowhere]\n\n");
    const titles: string[] = [];
    styles(state).between(0, state.doc.length, (_from, _to, decoration) => {
      if (decoration.spec.attributes?.title) titles.push(decoration.spec.attributes.title);
    });
    // A link with a title shows it; one with none shows its address (#229).
    assert.deepEqual(titles, ["T", "/ridge"]);
  });

  it("draws the page around a link with no words, which shows nothing, as GitHub's does", () => {
    // #151: an empty mark threw, and CodeMirror dropped the plugin that draws the page.
    const state = open("# Title\n\n[](https://x.y) after.\n\n> - [ ] [](https://x.y) *quoted*");
    assert.equal(visible(state), "Title\n\n after.\n\n[box]  quoted");
  });

  it("shows a link's or an image's title on hover, its own or its definition's", () => {
    // #229: a link's tooltip was its address, and an image had none.
    const doc =
      "[own](https://x.y \"Own title\") [ref][r] [bare](https://z.w) ![pic](a.png 'Pic title')\n\n" +
      '| [cell](https://c.d "Cell title") |\n|---|\n| x |\n\n[r]: /ridge (Ref \\"title\\")';
    const state = open(doc);
    const titles: string[] = [];
    let image: ImageWidget | undefined;
    let table: TableModel | undefined;
    for (const set of [styles(state), shown(state)]) {
      set.between(0, state.doc.length, (_from, _to, decoration) => {
        if (decoration.spec.attributes?.title) titles.push(decoration.spec.attributes.title);
        if (decoration.spec.widget instanceof ImageWidget) image = decoration.spec.widget;
        if (decoration.spec.widget instanceof TableWidget) table = decoration.spec.widget.table;
      });
    }
    // A link with no title keeps its address as its tooltip.
    assert.deepEqual(titles, ["Own title", 'Ref "title"', "https://z.w"]);
    assert.equal(image?.title, "Pic title");
    assert.deepEqual(table?.head[0], [
      {
        kind: "link",
        href: "https://c.d",
        title: "Cell title",
        children: [{ kind: "text", text: "cell" }],
      },
    ]);
  });

  it("goes to an id or a name in the document's HTML, as to a heading", () => {
    // #228: READMEs mark places with <a id> and <a name>, and link to them.
    const doc =
      '[To it](#custom-anchor)\n\n## Section\n\n<a id="custom-anchor"></a>\nText after.\n\n' +
      '<div name=\'block\'>x</div>\n\n```\n<a id="code"></a>\n```\n\n<a name="section"></a>';
    const state = open(doc);
    assert.equal(headingAt(state, "#custom-anchor"), doc.indexOf('<a id="custom'));
    assert.equal(headingAt(state, "#block"), doc.indexOf("<div"));
    // Code is not HTML, and a heading's anchor comes first.
    assert.equal(headingAt(state, "#code"), undefined);
    assert.equal(headingAt(state, "#section"), doc.indexOf("## Section"));
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

  it("resolves full, collapsed, and shortcut references against definitions anywhere", () => {
    const doc = "[a][Ridge] [Ridge][] [ridge]\n\n[RIDGE]: /ridge\n[ridge]: /ignored";
    const state = open(doc);
    assert.equal(visible(state).split("\n")[0], "a Ridge ridge");
    const hrefs: string[] = [];
    styles(state).between(0, state.doc.length, (_from, _to, decoration) => {
      if (decoration.spec.attributes?.["data-href"])
        hrefs.push(decoration.spec.attributes["data-href"]);
    });
    assert.deepEqual(hrefs, ["/ridge", "/ridge", "/ridge"]);
  });

  it("does not recover emphasis across unresolved brackets", () => {
    assert.equal(visible(open("[foo *bar]* baz")), "[foo *bar]* baz");
  });

  it("breaks the line at two trailing spaces or a backslash", () => {
    assert.equal(visible(open("one  \ntwo\\\nthree")), "one  \ntwo\nthree");
  });

  it("shows an autolink's address without its angle brackets", () => {
    assert.equal(visible(open("Mail <me@x.y> or <https://x.y>.")), "Mail me@x.y or https://x.y.");
  });

  it("cuts an image's long address short when its syntax opens, and when all of it shows", () => {
    // #204: an embedded image's base64 opened as one line held the window for seconds.
    const data = `data:image/png;base64,${"A".repeat(5000)}`;
    const doc = `Before.\n\n![embedded](${data})\n\nAfter.`;
    const state = open(doc);
    assert.equal(visible(state).split("\n")[2], `[image ${data} · embedded]`);
    const opened = visible(select(state, doc.indexOf("embedded"))).split("\n")[2];
    assert.match(opened, /^!\[embedded\]\(data:image\/png;base64,A+…\)$/);
    assert.ok(opened.length < 80, `${opened.length} characters`);
    let sourced = state;
    toggleSource({ state, dispatch: (tr) => (sourced = tr.state) });
    const source = visible(sourced).split("\n")[2];
    assert.ok(source.length < 80, `${source.length} characters`);
    // A short address opens whole.
    const short = "Text.\n\n![s](a.png)";
    assert.equal(visible(select(open(short), short.indexOf("s]"))).split("\n")[2], "![s](a.png)");
  });

  it("draws an image in a table cell as an image, not its words", () => {
    // #155: a README's grid of screenshots or badges showed as a row of alternative text.
    const state = open(
      "| ![m](img/mark.png) | beside |\n|---|---|\n| [![b](b.svg)](https://x.y) | y |",
    );
    let model: TableModel | undefined;
    shown(state).between(0, state.doc.length, (_from, _to, decoration) => {
      if (decoration.spec.widget instanceof TableWidget) model = decoration.spec.widget.table;
    });
    assert.deepEqual(model?.head[0], [{ kind: "image", reference: "img/mark.png", alt: "m" }]);
    assert.deepEqual(model?.rows[0][0], [
      {
        kind: "link",
        href: "https://x.y",
        children: [{ kind: "image", reference: "b.svg", alt: "b" }],
      },
    ]);
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

  it("draws GitHub's five alerts, the marker as its name, and leaves anything else a quote", () => {
    // #219: a warning read as any other quote, its marker as text.
    const doc = [
      "> [!WARNING]",
      "> Critical content.",
      "",
      "> [!tip]  ",
      "> Lower case.",
      "",
      "> [!NOTE] with words",
      "",
      "> [!SOON]",
      "> Not one.",
      "",
      "> > [!NOTE]",
      "> > Nested.",
    ].join("\n");
    const state = open(doc);
    assert.equal(
      visible(state),
      [
        "[warning]",
        "Critical content.",
        "",
        "[tip]  ",
        "Lower case.",
        "",
        "[!NOTE] with words",
        "",
        "[!SOON]",
        "Not one.",
        "",
        "[!NOTE]",
        "Nested.",
      ].join("\n"),
    );
    const classes = lineClasses(state, styles);
    assert.deepEqual(classes.slice(0, 5), [
      "pg-quote pg-alert pg-alert-warning",
      "pg-quote pg-alert pg-alert-warning",
      "",
      "pg-quote pg-alert pg-alert-tip",
      "pg-quote pg-alert pg-alert-tip",
    ]);
    assert.deepEqual(classes.slice(6, 10), ["pg-quote", "", "pg-quote", "pg-quote"]);
    // The keys show the marker as written.
    assert.match(visible(select(state, 4)), /^> \[!WARNING\]\nCritical/);
  });

  it("hides quote marks and keeps list markers as written", () => {
    const state = open("> one\n> two\n\n- a\n1. b");
    assert.equal(visible(state), "one\ntwo\n\n- a\n1. b");
    assert.deepEqual(lineClasses(state, styles).slice(0, 2), ["pg-quote", "pg-quote"]);
  });

  it("draws a rule for each level of a quote in a quote", () => {
    const state = open("> outer\n>\n> > inner\n> > > deepest\n\n> back");
    assert.equal(visible(state), "outer\n\ninner\ndeepest\n\nback");
    assert.deepEqual(lineClasses(state, styles), [
      "pg-quote",
      "pg-quote",
      "pg-quote pg-quote-2",
      "pg-quote pg-quote-2 pg-quote-3",
      "",
      "pg-quote",
    ]);
  });

  it("hides a quote's marks on every line of what it holds, code and raw HTML included", () => {
    assert.equal(visible(open("> ```\n> code\n> ```")), "```\ncode\n```");
    assert.equal(visible(open(">     indented\n>     code")), "indented\ncode");
    const html = "> <p>\n> quoted\n> </p>";
    assert.equal(visible(select(open(html), html.indexOf("quoted"))), "<p>\n> quoted\n</p>");
  });

  it("starts a code block or a quote in a list item where the item's text starts", () => {
    // #213: their background and their rule ran from the page's edge, out past the marker.
    const doc =
      "- item with code:\n\n  ```js\n  const x = 1;\n  ```\n\n" +
      "- item with a quote:\n\n  > quoted in a list\n  > two\n\n1. numbered\n\n   ```\n   z\n   ```";
    const state = open(doc);
    assert.equal(
      visible(state),
      "- item with code:\n\n```js\nconst x = 1;\n```\n\n- item with a quote:\n\nquoted in a list\ntwo\n\n" +
        "1. numbered\n\n```\nz\n```",
    );
    const classes = lineClasses(state, styles);
    assert.deepEqual(
      [2, 3, 4, 8, 9, 13, 14, 15].map((line) =>
        classes[line].split(" ").find((c) => c.startsWith("pg-in-")),
      ),
      ["pg-in-2", "pg-in-2", "pg-in-2", "pg-in-2", "pg-in-2", "pg-in-3", "pg-in-3", "pg-in-3"],
    );
    // The keys show a line's indent, as they show a quote's marks.
    assert.match(visible(select(state, doc.indexOf("const"))), /\n {2}const x = 1;\n```\n/);
  });

  it("draws an image alone in a list item beside its marker, not below it", () => {
    // #214: a lone image is a block, so it dropped under the marker. A footnote's number too.
    const state = open(
      "- [link item](https://x.y)\n- ![image item](logo.png)\n\n![alone](a.png)\n\n" +
        "See[^1].\n\n[^1]: ![note](n.png)",
    );
    const inline: boolean[] = [];
    shown(state).between(0, state.doc.length, (_from, _to, decoration) => {
      if (decoration.spec.widget instanceof ImageWidget) inline.push(decoration.spec.widget.inline);
    });
    styles(state).between(0, state.doc.length, (_from, _to, decoration) => {
      if (decoration.spec.widget instanceof ImageWidget) inline.push(decoration.spec.widget.inline);
    });
    assert.deepEqual(inline.sort(), [false, true, true]);
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

  it("leaves code, inline HTML, and bare addresses as the source", () => {
    const doc = "```js\n**not bold**\n```\n\nA <b>tag</b>, https://x.y, and - [x] no box.";
    const state = open(doc);
    assert.equal(visible(state), doc);
    assert.deepEqual(lineClasses(state, styles).slice(0, 3), [
      "pg-code-block pg-fence",
      "pg-code-block",
      "pg-code-block pg-fence",
    ]);
  });

  it("hides an indented code block's indent, so its text starts where a fenced block's does", () => {
    // #216: the four columns are syntax. Each line's shows while the selection is on it.
    const doc =
      "```\nfenced\n```\n\n    indented\n      deeper\n\n>     quoted\n>     two\n\n\tTabbed";
    const state = open(doc);
    assert.equal(visible(state), "```\nfenced\n```\n\nindented\n  deeper\n\nquoted\ntwo\n\nTabbed");
    assert.equal(
      visible(select(state, doc.indexOf("deeper"))),
      "```\nfenced\n```\n\nindented\n      deeper\n\nquoted\ntwo\n\nTabbed",
    );
    const inQuote = visible(select(state, doc.indexOf("two")));
    assert.match(inQuote, /\nquoted\n>     two\n/);
  });

  it("folds away an HTML comment in a line, with a space beside it, and anchors none", () => {
    // #224: a comment is written not to be seen. A selection in it shows it.
    const doc =
      "Inline <!-- hidden --> here.\n\n# Head <!-- note -->\n\n| a |\n|---|\n| x <!-- y -->z |";
    const state = open(doc);
    assert.equal(visible(state), "Inline here.\n\nHead\n\n[table 1 rows]");
    assert.equal(visible(select(state, doc.indexOf("hidden"))).split("\n")[0], doc.split("\n")[0]);
    assert.deepEqual([...state.field(page).blocks.anchors.keys()], ["head"]);
    let cell: unknown;
    shown(state).between(0, doc.length, (_from, _to, decoration) => {
      if (decoration.spec.widget instanceof TableWidget)
        cell = decoration.spec.widget.table.rows[0];
    });
    assert.deepEqual(cell, [[{ kind: "text", text: "x z" }]]);
  });

  it("draws a raw HTML block in a frame, without a quote's marks, and its source when selected", () => {
    const doc = "<div>raw</div>\n\n> <p>\n> quoted\n> </p>\n\n<!-- note -->\n\nAfter";
    const state = open(doc);
    assert.equal(
      visible(state),
      "[html <div>raw</div>]\n\n[html <p>\nquoted\n</p>]\n\n[html <!-- note -->]\n\nAfter",
    );
    const inQuote = select(state, doc.indexOf("quoted"));
    assert.match(
      visible(inQuote),
      /^\[html <div>raw<\/div>\]\n\n(> )?<p>\n(> )?quoted\n(> )?<\/p>\n\n\[html/,
    );
    assert.deepEqual(lineClasses(inQuote, styles).slice(2, 5), [
      "pg-quote pg-source-block",
      "pg-quote pg-source-block",
      "pg-quote pg-source-block",
    ]);
  });

  it("draws a rule in place of its marks", () => {
    const state = open("a\n\n---\n\nb");
    assert.equal(visible(state), "a\n\n\n\nb");
    assert.equal(lineClasses(state, shown)[2], "pg-rule");
  });

  it("hides syntax that runs onto the next line a line at a time, and folds a line it hides whole", () => {
    const doc =
      '![ridge at\ndusk](r.png)\n\n[up](https://x.y\n"T") after\n\n[on](https://x.y\n  "T")';
    const state = open(doc);
    // CodeMirror throws on a replacement across a line break from a view plugin.
    const { styles: inline, shown: folds } = paint(state, { from: 0, to: doc.length });
    for (const set of [inline, folds]) {
      set.between(0, doc.length, (from, to, decoration) => {
        if (decoration.point) assert.ok(to <= state.doc.lineAt(from).to, `${from}-${to}`);
      });
    }
    assert.equal(visible(state), "[image r.png · ridge at dusk]\n\n\nup\n after\n\non\n");
    assert.equal(lineClasses(state, shown)[1], "pg-collapsed");
    assert.deepEqual(lineClasses(state, styles).slice(3), ["", "", "", "", "pg-collapsed"]);
    const inImage = select(state, 3);
    assert.equal(visible(inImage).split("\n\n")[0], "![ridge at\ndusk](r.png)");
    assert.equal(lineClasses(inImage, shown)[1], "");
  });
});

describe("drawing near the viewport", () => {
  const lines = (count: number, line: (n: number) => string) =>
    Array.from({ length: count }, (_, n) => line(n)).join("\n");
  const doc = [
    lines(40, (n) => `> quoted *${n}*`),
    "- item",
    lines(40, (n) => `  more ${n}`),
    "",
    "```",
    lines(40, (n) => `code ${n}`),
    "```",
  ].join("\n");

  it("draws only the lines asked for, of constructs that run past them", () => {
    const state = open(doc);
    for (const first of [10, 50, 95]) {
      const from = state.doc.line(first + 1).from;
      const to = state.doc.line(first + 5).to;
      const { styles, shown } = paint(state, { from, to });
      const touched = new Set<number>();
      for (const set of [styles, shown]) {
        set.between(0, doc.length, (start) => {
          touched.add(state.doc.lineAt(start).number - 1);
        });
      }
      assert.deepEqual(
        [...touched].sort((a, b) => a - b),
        [first, first + 1, first + 2, first + 3, first + 4],
      );
    }
  });

  it("holds in the state only the blocks, the definitions, and the anchors", () => {
    const state = open(
      "# Title *x*\n\n> - # Deep\n>\n> [r]: /ridge\n\nSome **bold** [ref][r].\n\n| a |\n|---|\n| b |",
    );
    const { blocks, shown } = state.field(page);
    assert.deepEqual(Object.fromEntries(blocks.definitions), {
      R: { href: "/ridge", title: null },
    });
    assert.deepEqual([...blocks.anchors.keys()], ["title-x", "deep"]);
    const kept: string[] = [];
    shown.between(0, state.doc.length, (from, to, decoration) => {
      assert.equal(decoration.spec.block, true);
      kept.push(state.sliceDoc(from, to).split("\n")[0]);
    });
    assert.deepEqual(kept, ["> [r]: /ridge", "| a |"]);
  });

  it("reads the blocks in steps, to the same end as at once", () => {
    const steps = (doc: string) => {
      const state = open(doc);
      const tree = ensureSyntaxTree(state, state.doc.length, 5000)!;
      const scanning = scan(state.doc, tree);
      let pauses = 0;
      for (let step = scanning.next(); ; step = scanning.next(), pauses += 1) {
        if (step.done) return { pauses, blocks: step.value, whole: scanNow(state.doc, tree) };
      }
    };
    // Five thousand paragraphs, and nothing in them to draw or name.
    assert.ok(steps(lines(5000, (n) => `Paragraph ${n}.\n`)).pauses >= 5);
    const { blocks, whole } = steps(lines(3000, (n) => `# Part ${n}\n\n[d${n}]: /${n}`));
    assert.equal(blocks.definitions.size, 3000);
    assert.equal(blocks.anchors.size, 3000);
    assert.deepEqual(blocks.definitions, whole.definitions);
    assert.deepEqual(blocks.anchors, whole.anchors);
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

  it("opens nothing where the reader clicks, so the text holds still, until a key moves the caret", () => {
    const clicked = click(open(doc), doc.indexOf("bold"));
    assert.equal(visible(clicked), "Title\n\nSome bold words.");
    assert.equal(
      visible(select(clicked, doc.indexOf("bold") + 1)),
      "Title\n\nSome **bold** words.",
    );
    const table = "| a |\n|---|\n| b |";
    assert.equal(visible(click(open(table), 2)), "[table 1 rows]");
  });

  it("never unfolds a link: its address shows at the caret instead", () => {
    const linked = "See [the ridge](https://x.y/ridge) today.";
    const inLink = select(open(linked), linked.indexOf("ridge"));
    assert.equal(visible(inLink), "See the ridge today.");
    const tooltips = inLink.facet(showTooltip).filter(Boolean);
    assert.equal(tooltips.length, 1);
    assert.equal(tooltips[0]?.pos, linked.indexOf("the ridge"));
    assert.deepEqual(select(inLink, 1).facet(showTooltip).filter(Boolean), []);
    // A click shows the address too, though it opens nothing.
    assert.equal(
      click(open(linked), linked.indexOf("ridge")).facet(showTooltip).filter(Boolean).length,
      1,
    );
  });

  it("shows the address of a link in an HTML block that a click lands on, until the caret moves", () => {
    const html = '<p><a href="https://x.y/ridge">the ridge</a></p>\n\nAfter';
    const state = EditorState.create({ doc: html, extensions: [markdown, page, modClickOpens] });
    const link = { pos: 0, index: 0, href: "https://x.y/ridge" };
    const clicked = click(state, 0).update({ effects: showFrameLink.of(link) }).state;
    const tooltips = clicked.facet(showTooltip).filter(Boolean);
    assert.equal(tooltips.length, 1);
    assert.equal(tooltips[0]?.pos, 0);
    assert.deepEqual(click(clicked, html.length).facet(showTooltip).filter(Boolean), []);
    assert.deepEqual(select(clicked, 0).facet(showTooltip).filter(Boolean), []);
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

  it("shows no address for a link drawn in a table, or in an image's words", () => {
    const doc = "| [a](https://x.y) |\n|---|\n\n![see [b](https://x.y)](i.png)";
    for (const at of [doc.indexOf("a]"), doc.indexOf("b]"), doc.indexOf("x.y")]) {
      const found = open(doc).update({
        selection: { anchor: at, head: at + 1 },
        userEvent: "select.search",
      }).state;
      assert.deepEqual(found.facet(showTooltip).filter(Boolean), [], String(at));
      assert.deepEqual(select(found, at).facet(showTooltip).filter(Boolean), [], String(at));
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

  it("takes the file's new text with the reader's selection moved along, past its end too", () => {
    // #199: the selection the page opened syntax for was kept as it was, past the new text's end.
    const long = "# Title\n\nSome **bold** words, and a [link](https://x.y) at the end.";
    const inLink = select(open(long), long.indexOf("link"));
    const shorter = inLink.update({ changes: { from: 9, to: long.length, insert: "Short." } });
    assert.equal(visible(shorter.state), "Title\n\nShort.");
    assert.deepEqual(shorter.state.facet(showTooltip).filter(Boolean), []);
    // An edit before the selection moves it, and what it opened stays open.
    const before = select(open(doc), doc.indexOf("bold"));
    const moved = before.update({ changes: { from: 0, insert: "# New\n\n" } }).state;
    assert.equal(visible(moved), "New\n\nTitle\n\nSome **bold** words.");
  });

  it("folds everything again for print, until the reader selects once more", () => {
    const inBold = select(open(doc), doc.indexOf("bold"));
    const folded = inBold.update({ effects: foldAll.of(null) }).state;
    assert.equal(visible(folded), "Title\n\nSome bold words.");
    assert.equal(visible(select(folded, doc.indexOf("bold"))), "Title\n\nSome **bold** words.");
  });
});

describe("following a link", () => {
  const refused = "Only web and mail links open, and links to files in the repository.";

  it("goes to a heading, the browser, or a file in the repository, or says why it goes nowhere", () => {
    const state = open("# Install\n\nText.");
    assert.deepEqual(destinationOf(state, "#install"), { heading: 0 });
    assert.deepEqual(destinationOf(state, "https://x.y/a"), { url: "https://x.y/a" });
    assert.deepEqual(destinationOf(state, "MAILTO:me@x.y"), { url: "MAILTO:me@x.y" });
    // #156: a file is named as the link names it, decoded, less its query and fragment, and
    // #285: the fragment goes with it, for the place in the file it names.
    assert.deepEqual(destinationOf(state, "docs/desktop.md"), { file: "docs/desktop.md" });
    assert.deepEqual(destinationOf(state, "the%20guide.md#install"), {
      file: "the guide.md",
      fragment: "#install",
    });
    assert.deepEqual(destinationOf(state, "/README.md?plain=1"), { file: "/README.md" });
    assert.deepEqual(destinationOf(state, "#no-such-heading"), {
      refused: "Nothing in this file is named #no-such-heading.",
    });
    for (const href of ["ftp://x.y/f", "tel:123", "file:///etc/hostname", "//x.y/a", "?q=1"]) {
      assert.deepEqual(destinationOf(state, href), { refused }, href);
    }
    // Decoded, it has a scheme, so it is no file.
    assert.deepEqual(destinationOf(state, "javascript%3Aalert(1)"), { refused });
    for (const href of ["", "#"]) {
      assert.deepEqual(destinationOf(state, href), { refused: "This link has no address." });
    }
  });

  it("goes back from a link to a heading, and forward again, as a browser does", () => {
    const doc = "# Install\n\nRun it.\n\n[Install](#install) and [Use](#use).\n\n# Use";
    let state = EditorState.create({ doc, extensions: [markdown, page, modClickOpens] });
    ensureSyntaxTree(state, doc.length, 5000);
    state = state.update({}).state;
    const at = (place: { caret: number }) => state.selection.main.head === place.caret;
    const here = { caret: doc.indexOf("and"), top: doc.indexOf("Run") };
    const install = { caret: headingAt(state, "#install")!, top: 0 };
    assert.equal(jumpBack(state, here), null);
    state = state.update(jumpTo(state, here, install.caret)).state;
    assert.ok(at(install));
    assert.equal(jumpForward(state, install), null);
    state = state.update(jumpBack(state, install)!).state;
    assert.ok(at(here));
    assert.equal(jumpBack(state, here), null);
    state = state.update(jumpForward(state, here)!).state;
    assert.ok(at(install));
    // Back again, then a new jump: the way forward is gone, and the way back holds both.
    state = state.update(jumpBack(state, install)!).state;
    const use = headingAt(state, "#use")!;
    state = state.update(jumpTo(state, here, use)).state;
    assert.equal(jumpForward(state, { caret: use, top: use }), null);
    state = state.update(jumpBack(state, { caret: use, top: use })!).state;
    assert.ok(at(here));
  });

  it("prints the address a link leaves for after its words, unless the words are the address", () => {
    assert.equal(printedAddress("https://x.y/a", "the ridge"), "https://x.y/a");
    assert.equal(printedAddress("mailto:me@x.y", "write to me"), "me@x.y");
    assert.equal(printedAddress("https://x.y/a", "https://x.y/a"), null);
    assert.equal(printedAddress("mailto:me@x.y", "me@x.y"), null);
    assert.equal(printedAddress("#install", "Install"), null);
    assert.equal(printedAddress("docs/a.md", "the docs"), null);
    // #237: on the page, a link's words carry what print shows after them, an autolink's none.
    const doc = "[the ridge](https://x.y/r) <https://x.y/a> <me@x.y> [up](#top)";
    const printed: (string | null)[] = [];
    styles(open(doc)).between(0, doc.length, (_from, _to, decoration) => {
      if (decoration.spec.class === "pg-link")
        printed.push(decoration.spec.attributes["data-print"] ?? null);
    });
    assert.deepEqual(printed, ["https://x.y/r", null, null, null]);
  });
});

describe("a task list", () => {
  it("draws each item's box, ticked as written, and leaves a box outside an item as source", () => {
    // #212: a bullet's box is drawn where the bullet was. A number stays.
    const doc = "- [ ] open\n* [x] done\n1. [X] numbered\n- not a [ ] task\n\n> - [ ] quoted";
    assert.equal(
      visible(open(doc)),
      "[box] open\n[ticked] done\n1. [ticked] numbered\n- not a [ ] task\n\n[box] quoted",
    );
  });

  it("ticks or unticks a box on the page only, and the file keeps what it says", () => {
    const doc = "- [ ] open\n- [x] done";
    let state = open(doc);
    state = state.update({ effects: [toggleTask.of(2), toggleTask.of(13)] }).state;
    assert.equal(visible(state), "[ticked] open\n[box] done");
    state = state.update({ effects: toggleTask.of(2) }).state;
    assert.equal(visible(state), "[box] open\n[box] done");
    assert.equal(state.doc.toString(), doc);
  });

  it("shows a box's source while the keys are in it, and hangs its item's lines", () => {
    const doc = "- [ ] a task\n  that wraps\n- plain";
    const state = open(doc);
    // The bullet and the box open together, and the text holds the caret with both folded.
    assert.equal(visible(select(state, 3)), doc);
    assert.equal(visible(select(state, 0)), doc);
    const drawn = "[box] a task\n  that wraps\n- plain";
    assert.equal(visible(select(state, doc.indexOf("a task"))), drawn);
    assert.equal(visible(click(state, 3)), drawn);
    assert.deepEqual(lineClasses(state, styles), ["pg-hang-2", "pg-hang-2", "pg-hang-2"]);
  });

  const enter = (state: EditorState): EditorState | null => {
    let next: EditorState | null = null;
    toggleTaskAtCaret({ state, dispatch: (tr) => (next = tr.state) });
    return next;
  };

  it("ticks or unticks from Enter with the caret in its text, and the file keeps what it says", () => {
    const doc = "- [ ] open\n  wraps\n- [x] done\n  - [ ] inner";
    const ticked = enter(select(open(doc), doc.indexOf("open")))!;
    assert.equal(visible(ticked), "[ticked] open\n  wraps\n[ticked] done\n  [box] inner");
    // Its wrapped lines are its text too, and the box stays drawn, so the change shows.
    assert.equal(visible(enter(select(ticked, doc.indexOf("wraps")))!), visible(open(doc)));
    assert.equal(
      visible(enter(select(open(doc), doc.indexOf("done")))!),
      "[box] open\n  wraps\n[box] done\n  [box] inner",
    );
    assert.equal(
      visible(enter(click(open(doc), doc.indexOf("inner")))!),
      "[box] open\n  wraps\n[ticked] done\n  [ticked] inner",
    );
    assert.equal(ticked.doc.toString(), doc);
  });

  it("leaves Enter to the keymap on the box's source, outside a task, and in frontmatter", () => {
    const doc = "- [ ] open\n- plain";
    assert.equal(enter(select(open(doc), 3)), null);
    assert.equal(enter(select(open(doc), doc.indexOf("plain"))), null);
    assert.equal(enter(select(open("---\n- [ ] yaml\n---\n"), 10)), null);
  });
});

describe("the source", () => {
  const doc = [
    "---\ntitle: x\n---",
    "# Title",
    "Some **bold**, a [link](https://x.y), and ![an image](a.png).",
    "| a |\n|---|\n| b |",
    "<p>Raw</p>",
    "- [ ] task",
    "<details>\n<summary>More</summary>",
    "Body.",
    "</details>",
    "[x]: /y",
    "---",
  ].join("\n\n");
  const run = (command: StateCommand, state: EditorState): EditorState | null => {
    let next: EditorState | null = null;
    command({ state, dispatch: (tr) => (next = tr.state) });
    return next;
  };

  it("shows every construct as written, links and blocks too, until the same key hides it", () => {
    const shown = run(toggleSource, open(doc))!;
    assert.equal(visible(shown), doc);
    assert.equal(sourceShown(shown), true);
    const hidden = run(toggleSource, shown)!;
    assert.equal(visible(hidden), visible(open(doc)));
    assert.equal(sourceShown(hidden), false);
    assert.equal(hidden.doc.toString(), doc);
  });

  it("leaves Enter to the keymap while it shows, since nothing Enter changes would show", () => {
    const shown = run(toggleSource, open(doc))!;
    assert.equal(run(toggleDetailsAtCaret, select(shown, doc.indexOf("<summary>"))), null);
    assert.equal(run(toggleTaskAtCaret, select(shown, doc.indexOf("task"))), null);
  });
});

describe("frontmatter", () => {
  const front = "---\ntitle: Notes\ntags: [a, b]\n[x]: /y\n---";
  const quiet = "pg-code-block pg-frontmatter";

  it("folds away, a quiet block of its source where the keys reach it, and anchors nothing", () => {
    const doc = `${front}\n\n# Heading\n\n[x]`;
    const state = open(doc);
    // The status line's indicator and the panel show it.
    assert.equal(visible(state), "\n\nHeading\n\n[x]");
    assert.equal(visible(select(state, doc.indexOf("tags"))), `${front}\n\nHeading\n\n[x]`);
    assert.equal(visible(click(state, doc.indexOf("tags"))), "\n\nHeading\n\n[x]");
    assert.deepEqual(lineClasses(state, styles).slice(0, 7), [
      quiet,
      quiet,
      quiet,
      quiet,
      quiet,
      "",
      "pg-heading pg-h1",
    ]);
    assert.deepEqual([...state.field(page).blocks.anchors.keys()], ["heading"]);
  });

  it("starts the caret after it, so the first key leaves it folded", () => {
    const doc = `${front}\n\n# Heading`;
    const state = open(doc);
    const start = startOfPage(state);
    assert.equal(start, front.length + 1);
    assert.doesNotMatch(visible(select(state, start)), /title/);
    assert.doesNotMatch(visible(select(state, start + 1)), /title/);
    assert.equal(startOfPage(open("# No frontmatter")), 0);
    // Frontmatter alone: the caret goes to its end.
    assert.equal(startOfPage(open(front)), front.length);
  });

  it("holds a blank line, and closes at ... too", () => {
    const doc = "---\ntitle: x\n\ntags: y\n...\n\nAfter";
    const state = open(doc);
    assert.equal(visible(state), "\n\nAfter");
    assert.equal(visible(select(state, doc.indexOf("tags"))), doc);
    assert.deepEqual(lineClasses(state, styles), [quiet, quiet, quiet, quiet, quiet, "", ""]);
  });

  it("is only a --- on the first line that a later line closes", () => {
    // Not on the first line, it is a rule and a setext heading, as CommonMark reads it.
    assert.equal(visible(open("Text\n\n---\ntitle: x\n---")), "Text\n\n\ntitle: x\n");
    assert.equal(visible(open("---\ntitle: never closed")), "\ntitle: never closed");
    assert.equal(open("---\ntitle: never closed").field(page).blocks.frontmatter, null);
  });

  it("folds TOML between +++ lines away too, as Hugo and Zola write it, a blank line and all", () => {
    // #209: it showed as paragraphs at the top of the page.
    const toml = '+++\ntitle = "Hugo"\n\ndate = 2026-10-14\n+++';
    const doc = `${toml}\n\n# Heading`;
    const state = open(doc);
    assert.deepEqual(state.field(page).blocks.frontmatter, {
      from: 0,
      to: toml.length,
      format: "toml",
    });
    assert.equal(visible(state), "\n\nHeading");
    assert.equal(visible(select(state, doc.indexOf("date"))), `${toml}\n\nHeading`);
    const lines = [quiet, quiet, quiet, quiet, quiet, "", "pg-heading pg-h1"];
    assert.deepEqual(lineClasses(state, styles), lines);
    assert.equal(startOfPage(state), toml.length + 1);
    // Only on the first line, and only closed by another +++.
    assert.equal(open("Text\n\n+++\na = 1\n+++").field(page).blocks.frontmatter, null);
    assert.equal(open("+++\na = 1\n---").field(page).blocks.frontmatter, null);
    assert.equal(open(`${front}\n`).field(page).blocks.frontmatter?.format, "yaml");
  });

  it("is not a --- with a blank line after it, which is a rule, as Pandoc reads it", () => {
    // #196: the page lost everything up to the next rule.
    const doc = "---\n\n# Opens with a rule\n\nNot YAML.\n\n---\n\nAfter";
    const state = open(doc);
    assert.equal(state.field(page).blocks.frontmatter, null);
    assert.equal(visible(state), "\n\nOpens with a rule\n\nNot YAML.\n\n\n\nAfter");
    assert.deepEqual([...state.field(page).blocks.anchors.keys()], ["opens-with-a-rule"]);
    assert.equal(startOfPage(state), 0);
  });
});

describe("a footnote", () => {
  const doc = [
    "A sentence.[^b] And another.[^1] Again.[^b] Nowhere.[^none]",
    "",
    "[^1]: The first footnote, with **bold**.",
    "[^b]: Named.",
    "",
    "[^unused]: No reference uses it.",
  ].join("\n");

  it("raises each reference's number, by first use, and numbers each footnote where it is", () => {
    // #218: footnotes showed as source, with nothing to follow from a reference to its note.
    const state = open(doc);
    assert.equal(
      visible(state),
      [
        "A sentence.[ref 1] And another.[ref 2] Again.[ref 1] Nowhere.[^none]",
        "",
        "[note 2]The first footnote, with bold.[back]",
        "[note 1]Named.[back]",
        "",
        "[^unused]: No reference uses it.",
      ].join("\n"),
    );
    assert.deepEqual(lineClasses(state, styles).slice(2, 6), ["pg-note pg-note-first", "pg-note", "", ""]);
    // The keys show a reference's source, and a footnote's opening.
    assert.match(visible(select(state, doc.indexOf("[^1]") + 1)), /another\.\[\^1\] Again/);
    assert.match(visible(select(state, doc.indexOf("[^1]:") + 1)), /\n\[\^1\]: The first/);
  });

  it("goes from a reference to its footnote and back, as a link to a heading does", () => {
    const state = open(doc);
    assert.equal(headingAt(state, "#fn-1"), doc.indexOf("[^1]:"));
    assert.equal(headingAt(state, "#fnref-b"), doc.indexOf("[^b]"));
    assert.equal(headingAt(state, "#fn-unused"), undefined);
    // `[^1]: word` is a footnote too, not a link definition that turns `[^1]` into a link.
    const one = open("See[^1].\n\n[^1]: word");
    assert.equal(visible(one), "See[ref 1].\n\n[note 1]word[back]");
  });

  it("counts no reference in code, which shows as code", () => {
    // #282: `[^b]` in a code span or a fenced block took number 1, ahead of the first cited.
    const doc = [
      "Write `[^b]` for a note.",
      "",
      "```",
      "[^b]",
      "```",
      "",
      "First.[^a] Then.[^b]",
      "",
      "[^a]: A.",
      "[^b]: B.",
    ].join("\n");
    const { footnotes } = open(doc).field(page).blocks;
    assert.deepEqual(
      [...footnotes].map(([label, { number }]) => [label, number]),
      [
        ["a", 1],
        ["b", 2],
      ],
    );
    assert.match(visible(open(doc)), /First\.\[ref 1\] Then\.\[ref 2\]/);
  });

  it("raises a reference in a table cell to its number", () => {
    // #283: `x[^1]` in a cell showed as written, a link with no definition.
    const doc = "| A |\n|---|\n| x[^1] |\n\n[^1]: The **note**.";
    const cell = open(doc).field(page).blocks.folds.iter().value?.spec.widget.table.rows[0][0];
    assert.deepEqual(cell, [
      { kind: "text", text: "x" },
      { kind: "note", label: "1", number: 1, words: "The note." },
    ]);
  });

  it("runs on to the indented paragraphs under it, as one note", () => {
    // #284: a footnote's second paragraph showed as a code block, after its `↩`.
    const doc = [
      "Ref.[^1]",
      "",
      "[^1]: First paragraph.",
      "",
      "    Second **paragraph**.",
      "",
      "After.",
    ].join("\n");
    const state = open(doc);
    assert.equal(
      visible(state),
      "Ref.[ref 1]\n\n[note 1]First paragraph.\n\nSecond paragraph.[back]\n\nAfter.",
    );
    const note = "pg-note pg-note-first";
    assert.deepEqual(lineClasses(state, styles).slice(2), [note, note, note, "", ""]);
    // The keys show the indent of the line they are on.
    assert.match(visible(select(state, doc.indexOf("Second"))), /\n {4}Second paragraph\./);
    assert.match(state.field(page).blocks.footnotes.get("1")!.text, /^First paragraph\. Second/);
  });
});

describe("an emoji shortcode", () => {
  it("shows the emoji GitHub draws for it, and as written when it is not one", async () => {
    // #222: `:tada:` read as text, where GitHub shows its emoji.
    await loadEmoji();
    const doc = "Done :tada: :+1: and :not_a_real_one: at 10:30:45, `:tada:` in code.";
    const state = open(doc);
    assert.equal(visible(state), "Done 🎉 👍 and :not_a_real_one: at 10:30:45, :tada: in code.");
    // The keys show it as written, and a table cell draws it too.
    assert.match(visible(select(state, doc.indexOf("tada") + 1)), /^Done :tada: 👍/);
    assert.equal(emojiOf("warning"), "⚠️");
    const cells = open("| A |\n|---|\n| :rocket: |").field(page).blocks.folds.iter().value?.spec;
    assert.deepEqual(cells?.widget.table.rows[0][0], [{ kind: "text", text: "🚀" }]);
  });
});

describe("a <div align> around markdown", () => {
  it("aligns what it holds, and folds its tags away until the keys reach one", () => {
    // #225: the tags were two empty frames, and the markdown between stayed at the left.
    const doc = '<div align="center">\n\n# Project\n\n**A pitch**\n\n</div>\n\nAfter';
    const state = open(doc);
    assert.equal(visible(state), "\n\nProject\n\nA pitch\n\n\n\nAfter");
    assert.deepEqual(lineClasses(state, shown).slice(0, 7), [
      "",
      "pg-align-center",
      "pg-align-center",
      "pg-align-center",
      "pg-align-center",
      "pg-align-center",
      "",
    ]);
    assert.match(visible(select(state, 3)), /^<div align="center">\n/);
    assert.match(visible(select(state, doc.indexOf("</div>") + 2)), /\n<\/div>\n/);
  });

  it("takes a <p>, an align after other attributes, and leaves one with no align as frames", () => {
    const right = open('<p class="x" align="right">\n\nRight\n\n</p>');
    assert.deepEqual(lineClasses(right, shown), ["", "pg-align-right", "pg-align-right", "pg-align-right", ""]);
    const plain = '<div>\n\nText\n\n</div>';
    assert.equal(visible(open(plain)), "[html <div>]\n\nText\n\n[html </div>]");
    // A closing tag in another container, or of another kind, pairs with nothing.
    const crossed = open('<div align="center">\n\n> </div>\n\nText');
    assert.equal(crossed.field(page).blocks.aligned.length, 0);
    assert.equal(open('<div align="center">\n\nText\n\n</p>').field(page).blocks.aligned.length, 0);
  });
});

describe("a <details> around markdown", () => {
  const doc =
    "<details>\n<summary>More <b>notes</b></summary>\n\nA **folded** body.\n\n</details>\n\nAfter";
  const at = doc.indexOf("<details>");
  const toggle = (state: EditorState) => state.update({ effects: toggleDetails.of(at) }).state;

  it("draws its summary, and folds its body and closing tag until a click opens it", () => {
    const state = open(doc);
    assert.equal(visible(state), "[summary More <b>notes</b>]\n\n\n\nAfter");
    const opened = toggle(state);
    assert.equal(
      visible(opened),
      "[summary More <b>notes</b> open]\n\nA folded body.\n\n\n\nAfter",
    );
    assert.equal(visible(toggle(opened)), visible(state));
  });

  it("starts open when written open, and the same click closes it", () => {
    const written = open(doc.replace("<details>", '<details open class="x">'));
    assert.match(visible(written), /^\[summary More <b>notes<\/b> open\]\n\nA folded body\./);
    assert.doesNotMatch(visible(toggle(written)), /folded/);
  });

  it("opens while a find match is in its body, and closes again when the selection leaves", () => {
    const word = doc.indexOf("folded");
    const found = open(doc).update({
      selection: { anchor: word, head: word + 6 },
      userEvent: "select.search",
    }).state;
    assert.match(visible(found), /^\[summary More <b>notes<\/b> open\]\n\nA \*\*folded\*\* body\./);
    assert.doesNotMatch(visible(select(found, doc.length)), /folded/);
    // A click in the body opens nothing, as a click anywhere.
    assert.doesNotMatch(visible(click(open(doc), word)), /folded/);
  });

  it("shows a tag's source when the keys enter it", () => {
    const inSummary = select(open(doc), doc.indexOf("More"));
    assert.match(
      visible(inSummary),
      /^<details>\n<summary>More <b>notes<\/b><\/summary>\n\n\n\nAfter$/,
    );
    assert.match(visible(select(open(doc), doc.indexOf("</details>") + 2)), /<\/details>/);
  });

  it("opens and closes from Enter on its tags, whether its summary shows or its source", () => {
    const enter = (state: EditorState): EditorState | null => {
      let next: EditorState | null = null;
      toggleDetailsAtCaret({ state, dispatch: (tr) => (next = tr.state) });
      return next;
    };
    // A click opens no syntax, so the summary shows over the caret.
    const clicked = enter(click(open(doc), doc.indexOf("More")))!;
    assert.match(visible(clicked), /^\[summary More <b>notes<\/b> open\]\n\nA folded body\./);
    assert.doesNotMatch(visible(enter(clicked)!), /folded/);
    // The keys open its source, and Enter still opens it.
    const keyed = enter(select(open(doc), doc.indexOf("<summary>")))!;
    assert.match(
      visible(keyed),
      /^<details>\n<summary>More <b>notes<\/b><\/summary>\n\nA folded body\./,
    );
    // Anywhere else, Enter is left to the keymap.
    assert.equal(enter(select(open(doc), doc.indexOf("After"))), null);
  });

  it("opens every one for print, and puts them back after", () => {
    const printed = open(doc).update({ effects: [foldAll.of(null), printing.of(true)] }).state;
    assert.match(visible(printed), /A folded body\./);
    assert.doesNotMatch(visible(printed.update({ effects: printing.of(false) }).state), /folded/);
  });

  it("pairs the tags as they nest, in the same container, and leaves a lone one a frame", () => {
    const nested =
      "<details>\n<summary>Outer</summary>\n\n<details>\n<summary>Inner</summary>\n\nDeep.\n\n</details>\n\nShallow.\n\n</details>";
    const state = open(nested);
    assert.equal(visible(state).replace(/\n+/g, " ").trim(), "[summary Outer]");
    const outer = state.update({ effects: toggleDetails.of(0) }).state;
    assert.equal(
      visible(outer).replace(/\n+/g, " ").trim(),
      "[summary Outer open] [summary Inner] Shallow.",
    );
    // An opening tag with no closing one, and one closed only inside a quote, stay frames.
    for (const lone of [
      "<details>\n<summary>Lone</summary>\n\nBody.",
      "<details>\n\n> </details>",
    ]) {
      assert.match(visible(open(lone)), /^\[html <details>/, lone);
    }
  });
});

describe("line endings", () => {
  it("paints a CRLF or CR file as it paints an LF one", () => {
    const lf = "# Title\n\n| a |\n|---|\n| b |\n\n*x*";
    assert.equal(visible(open(lf.replace(/\n/g, "\r\n"))), visible(open(lf)));
    assert.equal(visible(open(lf.replace(/\n/g, "\r"))), visible(open(lf)));
  });
});

describe("an image's file", () => {
  it("is one URL for a markdown image, an <img>, and a picture's source", () => {
    // #256: the three each decoded, checked, and asked the channel on their own.
    const state = EditorState.create({ extensions: assetUrl.of((file) => `asset:${file}`) });
    assert.equal(imageUrl(state, "a%20b.png?v=2#top"), "asset:a b.png");
    assert.equal(imageUrl(state, "/images/logo.png"), "asset:/images/logo.png");
    for (const remote of [
      "https://x.y/a.png",
      "//x.y/a.png",
      "\\\\server\\a.png",
      "data:image/png,x",
      "",
    ]) {
      assert.equal(imageUrl(state, remote), null, remote);
    }
  });

  it("says why it does not show: nothing to load, or what the shell says the channel refused", async () => {
    // #231: every chip read "Image not shown" or "Image not loaded", whatever the reason.
    assert.equal(unloaded("https://x.y/a.png"), "Remote images do not load");
    assert.equal(unloaded(" //x.y/a.png"), "Remote images do not load");
    assert.equal(unloaded("data:image/png;base64,AAAA"), "Embedded images do not load");
    assert.equal(unloaded("doc-asset://localhost/x.png"), "Image not loaded");
    assert.equal(unloaded(""), "Image not loaded");
    const asked: string[] = [];
    const shell = imageRefusal.of(async (file) => {
      asked.push(file);
      return file === "gone.png" ? "Not found" : null;
    });
    const state = EditorState.create({ extensions: shell });
    assert.equal(await refusalOf(state, "gone.png"), "Not found");
    // It asks for the file the channel was asked for, and says nothing more when the shell cannot.
    assert.equal(await refusalOf(state, "screen%20shot.png?v=1"), "Image not shown");
    assert.deepEqual(asked, ["gone.png", "screen shot.png"]);
    assert.equal(await refusalOf(EditorState.create({}), "gone.png"), "Image not shown");
    const failing = imageRefusal.of(() => Promise.reject(new Error("closed")));
    assert.equal(
      await refusalOf(EditorState.create({ extensions: failing }), "gone.png"),
      "Image not shown",
    );
  });

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

  it("is checked once decoded, so an escaped slash or colon cannot name a host or a scheme", () => {
    assert.equal(filePath("..%2F..%2Fsecret.png"), "../../secret.png");
    assert.equal(isLocal(filePath("%2F%2Fhost%2Fa.png")), false);
    assert.equal(isLocal(filePath("file%3Asecret.png")), false);
  });

  it("is the repository's root after one leading slash, and a host after two", () => {
    assert.equal(isLocal("near.png"), true);
    assert.equal(isLocal("../images/far.png"), true);
    assert.equal(isLocal("/images/far.png"), true);
    assert.equal(isLocal("//host/far.png"), false);
    assert.equal(isLocal("\\host\\far.png"), false);
    assert.equal(isLocal("https://x.y/far.png"), false);
    assert.equal(isLocal(""), false);
  });
});
