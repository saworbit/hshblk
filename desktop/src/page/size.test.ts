import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SIZES, stepSize } from "./size.ts";

describe("the text size", () => {
  it("steps up and down through the sizes, stops at each end, and goes back to the page's own", () => {
    // #164: there was no way to change it.
    assert.equal(stepSize(1, 1), 1.1);
    assert.equal(stepSize(1, -1), 0.9);
    assert.equal(stepSize(1.1, 1), 1.25);
    assert.equal(stepSize(SIZES.at(-1)!, 1), SIZES.at(-1));
    assert.equal(stepSize(SIZES[0], -1), SIZES[0]);
    assert.equal(stepSize(1.75, 0), 1);
    // A size not in the list steps from the page's own.
    assert.equal(stepSize(1.3, 1), 1.1);
  });
});
