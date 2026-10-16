import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EditorState, type StateCommand } from "@codemirror/state";
import { closeKeys, keyRows, keysPanel, toggleKeys } from "./keys.ts";

const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8");

describe("the keys", () => {
  it("are the README's key table, in the forms each system takes", () => {
    // #239: on Linux and Windows the keys could be learnt only from the README.
    const linux = keyRows(readme, false);
    const mac = keyRows(readme, true);
    assert.ok(linux.length >= 10, `the README's table gave ${linux.length} rows`);
    assert.equal(mac.length, linux.length);
    const open = linux.findIndex((row) => row.keys === "Ctrl+O");
    assert.ok(open >= 0, "Ctrl+O is listed");
    assert.equal(mac[open].keys, "⌘O");
    assert.match(linux[open].does, /^Open a file/);
    // The panel's own keys are in the table too, and no cell keeps its code marks.
    assert.ok(linux.some((row) => row.keys.startsWith("F1")));
    assert.ok(linux.every((row) => !row.keys.includes("`") && !row.does.includes("`")));
  });

  it("reads a row with no ⌘ form as written, and a link as its words", () => {
    const table = [
      "| Key | Does |",
      "|---|---|",
      "| `Ctrl+=`, `Ctrl+-` (`⌘=`, `⌘-`) | Bigger or smaller |",
      "| `PageDown`, `Space` | Down a [page](docs/x.md) |",
      "",
      "| Not | Keys |",
    ].join("\n");
    assert.deepEqual(keyRows(table, false), [
      { keys: "Ctrl+=, Ctrl+-", does: "Bigger or smaller" },
      { keys: "PageDown, Space", does: "Down a page" },
    ]);
    assert.deepEqual(keyRows(table, true)[0], { keys: "⌘=, ⌘-", does: "Bigger or smaller" });
    assert.deepEqual(keyRows("No table here.", false), []);
  });

  it("show and hide from their key, and hide from Escape", () => {
    const run = (command: StateCommand, state: EditorState) => {
      let next: EditorState | null = null;
      command({ state, dispatch: (tr) => (next = tr.state) });
      return next as EditorState | null;
    };
    const state = EditorState.create({ extensions: keysPanel([]) });
    assert.equal(run(closeKeys, state), null);
    const shown = run(toggleKeys, state)!;
    assert.notEqual(run(closeKeys, shown), null);
    assert.equal(run(closeKeys, run(closeKeys, shown)!), null);
  });
});
