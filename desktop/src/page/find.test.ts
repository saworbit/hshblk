import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { search, SearchQuery, setSearchQuery } from "@codemirror/search";
import { EditorSelection, EditorState } from "@codemirror/state";
import { countText, findExtras, matchCount } from "./find.ts";

const doc = "one two one three one";

/** The page with `words` in the find box, and the selection where the reader left it. */
function searched(words: string, anchor = 0, head = anchor): EditorState {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.single(anchor, head),
    extensions: [search(), findExtras],
  });
  return state.update({ effects: setSearchQuery.of(new SearchQuery({ search: words })) }).state;
}

describe("find", () => {
  it("counts the matches, and says which one the selection is on", () => {
    // #203: the find box said nothing of either, nor that there were none.
    const second = doc.indexOf("one", 1);
    assert.deepEqual(matchCount(searched("one", second, second + 3)), {
      current: 2,
      total: 3,
      more: false,
    });
    assert.equal(countText(matchCount(searched("one", second, second + 3))), "2 of 3");
    assert.equal(countText(matchCount(searched("one"))), "3 matches");
    assert.equal(countText(matchCount(searched("three"))), "1 match");
    assert.equal(countText(matchCount(searched("zz"))), "No matches");
    assert.equal(countText(matchCount(searched(""))), "");
    // Past the limit it says only that there are more.
    assert.equal(countText(matchCount(searched("one"), 2)), "2+ matches");
  });

  it("leaves no old match selected when the words change to ones not in the file", () => {
    assert.deepEqual(searched("zz", 0, 3).selection.main, EditorSelection.cursor(3));
    // Words that are in the file leave the selection to find, as before.
    const kept = searched("two", 0, 3).selection.main;
    assert.deepEqual([kept.from, kept.to], [0, 3]);
  });
});
