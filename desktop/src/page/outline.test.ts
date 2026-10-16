import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState, type StateCommand } from "@codemirror/state";
import { markdown } from "./dialect.ts";
import { closeOutline, headingOver, outlineOf, outlineOpen, toggleOutline } from "./outline.ts";
import { page, paint } from "./page.ts";

function open(doc: string): EditorState {
  const state = EditorState.create({ doc, extensions: [markdown, page, outlineOpen] });
  ensureSyntaxTree(state, state.doc.length, 5000);
  return state.update({}).state;
}

function run(command: StateCommand, state: EditorState): EditorState | null {
  let next: EditorState | null = null;
  command({ state, dispatch: (tr) => (next = tr.state) });
  return next;
}

const doc = [
  "---",
  "title: Not a heading",
  "---",
  "",
  "# Readme",
  "",
  "Intro, with a [link](https://x.y).",
  "",
  "## Install **it**",
  "",
  "Setext",
  "------",
  "",
  "#### Deep",
].join("\n");

describe("the outline", () => {
  it("lists every heading, in order, by level and words, and none in frontmatter", () => {
    // #236: there was no outline of the headings.
    const state = open(doc);
    assert.deepEqual(
      outlineOf(state).map(({ from, level, words }) => [doc.slice(from, from + 2), level, words]),
      [
        ["# ", 1, "Readme"],
        ["##", 2, "Install it"],
        ["Se", 2, "Setext"],
        ["##", 4, "Deep"],
      ],
    );
  });

  it("finds the heading a place is under", () => {
    const outline = outlineOf(open(doc));
    assert.equal(headingOver(outline, 0), -1);
    assert.equal(headingOver(outline, outline[0].from), 0);
    assert.equal(headingOver(outline, doc.indexOf("Intro")), 0);
    assert.equal(headingOver(outline, doc.indexOf("Setext") + 1), 2);
    assert.equal(headingOver(outline, doc.length), 3);
  });

  it("opens and closes from its key, and not for a file with no heading", () => {
    assert.equal(run(toggleOutline, open("No headings here.")), null);
    const opened = run(toggleOutline, open(doc))!;
    assert.equal(opened.field(outlineOpen), true);
    assert.equal(run(closeOutline, opened)!.field(outlineOpen), false);
    assert.equal(run(closeOutline, open(doc)), null);
  });

  it("names each heading and link to a screen reader, as a heading of its level and a link", () => {
    // #157: a screen reader was handed one text box, with no headings or links.
    const state = open(doc);
    const roles: string[] = [];
    paint(state, { from: 0, to: doc.length }).styles.between(0, doc.length, (_f, _t, d) => {
      const attributes = d.spec.attributes;
      if (!attributes?.role) return;
      roles.push(`${attributes.role} ${attributes["aria-level"] ?? ""}`.trim());
    });
    assert.deepEqual(roles, ["heading 1", "link", "heading 2", "heading 2", "heading 4"]);
  });
});
