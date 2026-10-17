import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { parseAst } from "vite";
import { rewrite, SET } from "./override-mistake.ts";

/**
 * Runs code in a realm of its own whose `Object.prototype` is frozen, as Tauri freezes it, and
 * gives back its value as this realm's.
 */
function frozen(code: string): unknown {
  return structuredClone(runInNewContext(`"use strict"; Object.freeze(Object.prototype); ${code}`));
}

const rewritten = (code: string) => rewrite(code, parseAst(code)) ?? code;

describe("the override mistake", () => {
  it("lets code assign what a frozen prototype holds, as dayjs and d3 do", () => {
    // #221: dayjs sets `valueOf` and `toString` on its prototype, and d3 sets `constructor` and
    // names computed as it runs. Frozen, each threw before mermaid drew anything.
    const code = [
      "function D() {}",
      "D.prototype.valueOf = function () { return 42; };",
      "var colour = {}; colour.constructor = D;",
      "var key = 'toString'; var named = {}; named[key] = function () { return 'named'; };",
      "[new D() + 0, colour.constructor === D, String(named)]",
    ].join("\n");
    assert.throws(() => frozen(code), /read only property/);
    assert.deepEqual(frozen(rewritten(code)), [42, true, "named"]);
  });

  it("evaluates as an assignment does, nested and as a value", () => {
    const code = [
      "var order = []; var a = {}; var b = {};",
      "function take(name, value) { order.push(name); return value; }",
      "take('a', a).toString = take('b', b).valueOf = take('value', 7);",
      "var given = (a.hasOwnProperty = 3);",
      "[order.join(' '), a.toString, b.valueOf, given, Object.keys(a).join(' ')]",
    ].join("\n");
    assert.deepEqual(frozen(rewritten(code)), ["a b value", 7, 7, 3, "toString hasOwnProperty"]);
  });

  it("leaves every other assignment as written", () => {
    const code =
      "var o = {}; o.name = 1; o.count += 2; x = 3; this.y = 4; class C { #z; m() { this.#z = 5; } }";
    // No plain name, compound assignment, bare variable, or private field changes.
    assert.equal(rewrite(code, parseAst(code)), null);
    const computed = "var o = {}; o[k] = 1;";
    assert.equal(rewrite(computed, parseAst(computed)), `${SET}var o = {}; __hbSet(o, k, 1);`);
  });
});
