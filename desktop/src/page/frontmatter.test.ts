import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState, type StateCommand } from "@codemirror/state";
import * as yaml from "yaml";
import { markdown } from "./dialect.ts";
import {
  closeFrontmatter,
  fields,
  frontmatter,
  frontmatterPanel,
  frontmatterText,
  toggleFrontmatter,
  toggleRaw,
} from "./frontmatter.ts";
import { page } from "./page.ts";

function open(doc: string): EditorState {
  const state = EditorState.create({ doc, extensions: [markdown, page, frontmatter] });
  ensureSyntaxTree(state, state.doc.length, 5000);
  return state.update({}).state;
}

/** What a command does to the state, or null when it leaves the key to the next binding. */
function run(command: StateCommand, state: EditorState): EditorState | null {
  let next: EditorState | null = null;
  command({ state, dispatch: (tr) => (next = tr.state) });
  return next;
}

describe("the frontmatter panel", () => {
  const doc = "---\ntitle: Notes\ntags: [a, b]\n---\n\nText";

  it("reads the YAML between the fences, or nothing when the file has none", () => {
    assert.equal(frontmatterText(open(doc)), "title: Notes\ntags: [a, b]");
    assert.equal(frontmatterText(open("---\n---\nText")), "");
    assert.equal(frontmatterText(open("Text\n\n---\nx: 1\n---")), null);
  });

  it("opens and closes from its key, starts on the fields, and switches to the raw YAML", () => {
    const opened = run(toggleFrontmatter, open(doc))!;
    assert.deepEqual(opened.field(frontmatterPanel), { open: true, raw: false });
    const raw = run(toggleRaw, opened)!;
    assert.deepEqual(raw.field(frontmatterPanel), { open: true, raw: true });
    assert.deepEqual(run(toggleFrontmatter, raw)!.field(frontmatterPanel).open, false);
    // Escape closes it, and is left to the next binding when it is closed.
    assert.equal(run(closeFrontmatter, opened)!.field(frontmatterPanel).open, false);
    assert.equal(run(closeFrontmatter, open(doc)), null);
    assert.equal(opened.doc.toString(), doc);
  });

  it("does not open for a file with no frontmatter", () => {
    assert.equal(run(toggleFrontmatter, open("# No frontmatter")), null);
  });

  it("lists each field, a list of words as one line and anything deeper as YAML", () => {
    const text = [
      "title: Notes",
      "date: 2024-01-02",
      "tags: [a, b]",
      "draft: false",
      "empty:",
      "author:\n  name: Ann",
    ].join("\n");
    assert.deepEqual(fields(yaml, text), [
      { key: "title", value: "Notes", block: false },
      { key: "date", value: "2024-01-02", block: false },
      { key: "tags", value: "a, b", block: false },
      { key: "draft", value: "false", block: false },
      { key: "empty", value: "", block: false },
      { key: "author", value: "name: Ann", block: true },
    ]);
  });

  it("lists nothing for YAML with errors or that is no mapping, so the panel shows it raw", () => {
    assert.equal(fields(yaml, "title: [unclosed"), null);
    assert.equal(fields(yaml, "- a\n- b"), null);
    assert.equal(fields(yaml, "just words"), null);
    assert.deepEqual(fields(yaml, ""), []);
    // A YAML bomb stops at the package's alias limit, and the panel shows it raw.
    const names = "abcdefghijklmnop";
    const bomb = ["a: &a [x, x]"];
    for (let n = 1; n < names.length; n += 1) {
      const [name, last] = [names[n], names[n - 1]];
      bomb.push(`${name}: &${name} [*${last}, *${last}, *${last}]`);
    }
    assert.equal(fields(yaml, bomb.join("\n")), null);
  });
});
