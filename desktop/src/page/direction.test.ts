import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Text } from "@codemirror/state";
import { directions } from "./direction.ts";

describe("text direction", () => {
  it("marks each line of Arabic or Hebrew to take its direction from its text", () => {
    // #198: every line was laid out left to right.
    const lines = [
      "## العربية",
      "",
      "هذه فقرة باللغة العربية مع **نص عريض**.",
      "",
      "- عنصر أول",
      "",
      "English, with one word of עברית in it.",
      "",
      "זוהי פסקה בעברית עם *הדגשה*.",
    ];
    const doc = Text.of(lines);
    const marked: number[] = [];
    directions(doc, 0, doc.length).between(0, doc.length, (from, _to, decoration) => {
      assert.equal(decoration.spec.attributes?.dir, "auto");
      marked.push(doc.lineAt(from).number);
    });
    // The English line with a Hebrew word is marked too. Its first letter makes it left to right.
    assert.deepEqual(marked, [1, 3, 5, 7, 9]);
  });
});
