import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readMarkdown, type Block, type Inline } from "./markdown.ts";

const text = (value: string): Inline => ({ kind: "text", text: value });

function blocks(doc: string): Block[] {
  return readMarkdown(doc).blocks;
}

/** The inlines of a document that is one paragraph. */
function line(doc: string): Inline[] {
  const [only, ...rest] = blocks(doc);
  assert.equal(only?.kind, "paragraph");
  assert.equal(rest.length, 0);
  return only.kind === "paragraph" ? only.children : [];
}

describe("the dialect", () => {
  it("keeps a bare URL as the characters written", () => {
    assert.deepEqual(line("See https://example.com/docs for details."), [
      text("See https://example.com/docs for details."),
    ]);
  });

  it("keeps task-list brackets as written", () => {
    const [list] = blocks("- [x] done\n- [ ] open");
    assert.equal(list.kind, "list");
    if (list.kind !== "list") return;
    assert.deepEqual(
      list.items.map((item) => item.children),
      [
        [{ kind: "paragraph", children: [text("[x] done")] }],
        [{ kind: "paragraph", children: [text("[ ] open")] }],
      ],
    );
  });

  it("strikes through with two tildes, not one", () => {
    assert.deepEqual(line("~a~ and ~~b~~"), [
      text("~a~ and "),
      { kind: "strikethrough", children: [text("b")] },
    ]);
  });

  it("shows raw HTML as source, as a block and inline", () => {
    assert.deepEqual(blocks("<script>alert(1)</script>\n\nA <b>word</b>."), [
      { kind: "source", text: "<script>alert(1)</script>" },
      { kind: "paragraph", children: [text("A <b>word</b>.")] },
    ]);
  });

  // Accepted deviation, docs/hld.md §7: Lezer parses these brackets as a link before any
  // definition is known, so the emphasis CommonMark finds across the bracket is never built.
  it("does not recover emphasis across unresolved brackets", () => {
    assert.deepEqual(line("[foo *bar]* baz"), [text("[foo *bar]* baz")]);
  });
});

describe("links", () => {
  it("paints the words of an inline link and keeps the address", () => {
    assert.deepEqual(line('Go [up the ridge](https://example.com/ridge "The ridge").'), [
      text("Go "),
      { kind: "link", href: "https://example.com/ridge", children: [text("up the ridge")] },
      text("."),
    ]);
  });

  it("resolves full, collapsed, and shortcut references against definitions anywhere", () => {
    const doc = "[a][Ridge] [Ridge][] [ridge]\n\n[RIDGE]: /ridge\n[ridge]: /ignored";
    const link = (words: string) => ({ kind: "link", href: "/ridge", children: [text(words)] });
    assert.deepEqual(blocks(doc), [
      {
        kind: "paragraph",
        children: [link("a"), text(" "), link("Ridge"), text(" "), link("ridge")],
      },
    ]);
  });

  it("leaves a reference with no definition as written", () => {
    assert.deepEqual(line("[the *ridge*][path] and [alone]"), [
      text("[the "),
      { kind: "emphasis", children: [text("ridge")] },
      text("][path] and [alone]"),
    ]);
  });

  it("reads escapes and entities in a destination, and keeps percent escapes", () => {
    const href = "https://example.com/a_b?q=1&r=2";
    assert.deepEqual(
      line("[esc](https://example.com/a\\_b?q=1&amp;r=2) [ref][r]\n\n[r]: <c%20d &amp; e>"),
      [
        { kind: "link", href, children: [text("esc")] },
        text(" "),
        { kind: "link", href: "c%20d & e", children: [text("ref")] },
      ],
    );
  });

  it("makes an autolink a link whose words are its address", () => {
    assert.deepEqual(line("<https://example.com> or <me@example.com>"), [
      { kind: "link", href: "https://example.com", children: [text("https://example.com")] },
      text(" or "),
      { kind: "link", href: "mailto:me@example.com", children: [text("me@example.com")] },
    ]);
  });

  it("gives an image its alternative text", () => {
    assert.deepEqual(line("![ridge at *dusk*](ridge.jpg) ![gone][nowhere]"), [
      { kind: "image", src: "ridge.jpg", alt: "ridge at dusk" },
      text(" ![gone][nowhere]"),
    ]);
  });
});

describe("inline text", () => {
  it("paints escaped characters without the backslash", () => {
    assert.deepEqual(line("Not \\*emphasis\\*, a \\| pipe."), [text("Not *emphasis*, a | pipe.")]);
  });

  it("decodes entities", () => {
    assert.deepEqual(line("Fish &amp; chips &copy; &#35;1 &bogus;"), [
      text("Fish & chips © #1 &bogus;"),
    ]);
  });

  it("breaks the line at two trailing spaces or a backslash", () => {
    assert.deepEqual(line("one  \ntwo\\\nthree"), [
      text("one"),
      { kind: "break" },
      text("two"),
      { kind: "break" },
      text("three"),
    ]);
  });

  it("trims one space of padding from a code span", () => {
    assert.deepEqual(line("`` `tick` `` and ` ` "), [
      { kind: "code", text: "`tick`" },
      text(" and "),
      { kind: "code", text: " " },
    ]);
  });
});

describe("headings", () => {
  it("reads ATX and setext headings, and lists both", () => {
    const page = readMarkdown(
      "# Hash *Block*\n\nTitle\nsecond line\n===\n\nSub\n---\n\n## Hash Block ##",
    );
    assert.deepEqual(page.headings, [
      { id: "hash-block", level: 1, text: "Hash Block" },
      { id: "title-second-line", level: 1, text: "Title second line" },
      { id: "sub", level: 2, text: "Sub" },
      { id: "hash-block-1", level: 2, text: "Hash Block" },
    ]);
    assert.deepEqual(page.blocks[0], {
      kind: "heading",
      level: 1,
      id: "hash-block",
      children: [text("Hash "), { kind: "emphasis", children: [text("Block")] }],
    });
  });
});

describe("code", () => {
  it("keeps an indented block, less its indentation", () => {
    assert.deepEqual(blocks("Before\n\n    one\n      two\n\n    three\n\nAfter")[1], {
      kind: "code",
      info: "",
      text: "one\n  two\n\nthree",
    });
  });

  it("drops the quote marks and list indentation around a fence", () => {
    const [quote] = blocks("> ```js\n> a\n>   b\n> ```");
    assert.deepEqual(quote, {
      kind: "quote",
      children: [{ kind: "code", info: "js", text: "a\n  b" }],
    });
    const [list] = blocks("- item\n\n  ```\n  code\n    more\n  ```");
    assert.equal(list.kind, "list");
    if (list.kind !== "list") return;
    assert.deepEqual(list.items[0].children[1], { kind: "code", info: "", text: "code\n  more" });
  });
});

describe("lists", () => {
  it("is tight with no blank lines, and keeps the markers as written", () => {
    assert.deepEqual(blocks("1) one\n2) two"), [
      {
        kind: "list",
        ordered: true,
        tight: true,
        items: [
          { marker: "1)", children: [{ kind: "paragraph", children: [text("one")] }] },
          { marker: "2)", children: [{ kind: "paragraph", children: [text("two")] }] },
        ],
      },
    ]);
  });

  it("is loose with a blank line between items, or between blocks in one item", () => {
    const tight = (doc: string) => blocks(doc).map((block) => block.kind === "list" && block.tight);
    assert.deepEqual(tight("- a\n\n- b"), [false]);
    assert.deepEqual(tight("- a\n\n  more\n- b"), [false]);
    assert.deepEqual(tight("- a\n  - nested\n- b"), [true]);
  });
});

describe("tables", () => {
  it("parses cells as inline text, aligned, padded to the delimiter row", () => {
    assert.deepEqual(
      blocks("| a | *b* | c |\n|:--|--:|:-:|\n| `x` |  | y \\| z | extra |\n| q |"),
      [
        {
          kind: "table",
          align: ["left", "right", "center"],
          head: [[text("a")], [{ kind: "emphasis", children: [text("b")] }], [text("c")]],
          rows: [
            [[{ kind: "code", text: "x" }], [], [text("y | z")]],
            [[text("q")], [], []],
          ],
        },
      ],
    );
  });
});

describe("a table cell's code", () => {
  it("takes the backslash off an escaped pipe, in a table and nowhere else", () => {
    const [table, paragraph] = blocks("| a |\n|---|\n| `c \\| d` |\n\n`a \\| b`");
    assert.deepEqual(table.kind === "table" && table.rows, [[[{ kind: "code", text: "c | d" }]]]);
    assert.deepEqual(paragraph, {
      kind: "paragraph",
      children: [{ kind: "code", text: "a \\| b" }],
    });
  });
});

describe("the page", () => {
  it("reads a file with CRLF or CR line endings as it reads LF", () => {
    const lf = "# Title\n\n| a | b |\n| - | - |\n| c | d |\n\n```\nx\n```\n";
    assert.deepEqual(blocks(lf.replace(/\n/g, "\r\n")), blocks(lf));
    assert.deepEqual(blocks(lf.replace(/\n/g, "\r")), blocks(lf));
  });

  it("leaves an empty heading out of the contents", () => {
    assert.deepEqual(readMarkdown("#\n\n# Named").headings, [
      { id: "named", level: 1, text: "Named" },
    ]);
  });

  it("does not paint link definitions", () => {
    assert.deepEqual(blocks("[ridge]: https://example.com\n\nText."), [
      { kind: "paragraph", children: [text("Text.")] },
    ]);
  });

  it("counts the words that paint, not the markup", () => {
    assert.equal(readMarkdown("# One\n\n- **two** three\n\n| four |\n| --- |\n\n---").words, 4);
  });
});
