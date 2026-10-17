import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { loadParser, parserFor } from "./code.ts";
import { markdown } from "./dialect.ts";
import { page, paint } from "./page.ts";

function open(doc: string): EditorState {
  const state = EditorState.create({ doc, extensions: [markdown, page] });
  ensureSyntaxTree(state, state.doc.length, 5000);
  return state.update({}).state;
}

/** Each coloured stretch of the page, as its text and its class. */
function tokens(state: EditorState): string[] {
  const out: string[] = [];
  const { styles } = paint(state, { from: 0, to: state.doc.length });
  styles.between(0, state.doc.length, (from, to, decoration) => {
    const name = decoration.spec.class;
    if (typeof name === "string" && name.startsWith("pg-tok-")) {
      out.push(`${state.doc.sliceString(from, to)} ${name}`);
    }
  });
  return out;
}

describe("a code block that names its language", () => {
  it("asks for its language, and once it loads, colours its tokens", async () => {
    // #217: code blocks were one colour, whatever they held.
    const doc = '```js\nconst answer = 42; // why\nlet name = "x";\n```';
    const state = open(doc);
    assert.equal(parserFor("js"), "loading");
    assert.deepEqual([...paint(state, { from: 0, to: doc.length }).wanted], ["js"]);
    assert.deepEqual(tokens(state), []);
    await loadParser("js");
    assert.deepEqual(tokens(open(doc)), [
      "const pg-tok-keyword",
      "42 pg-tok-literal",
      "// why pg-tok-comment",
      "let pg-tok-keyword",
      '"x" pg-tok-string',
    ]);
  });

  it("tells a diff's lines apart, and leaves a name it does not know, or none, one colour", async () => {
    await loadParser("diff");
    const diff = "```diff\n@@ -1 +1 @@\n-old\n+new\n```";
    assert.deepEqual(tokens(open(diff)), [
      "@@ -1 +1 @@ pg-tok-meta",
      "-old pg-tok-deleted",
      "+new pg-tok-inserted",
    ]);
    for (const doc of ["```cobol\nMOVE A TO B.\n```", "```\nconst x = 1;\n```"]) {
      assert.deepEqual(tokens(open(doc)), [], doc);
      assert.deepEqual([...paint(open(doc), { from: 0, to: doc.length }).wanted], [], doc);
    }
    // In a quote, its lines carry the quote's marks, so it stays one colour.
    await loadParser("python");
    assert.deepEqual(tokens(open("> ```python\n> def f(): pass\n> ```")), []);
    assert.ok(
      tokens(open("```Python {.numbered}\ndef f(): pass\n```")).includes("def pg-tok-keyword"),
    );
  });
});
