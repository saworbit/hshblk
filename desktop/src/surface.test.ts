import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cursorLineDown, cursorLineUp, standardKeymap } from "@codemirror/commands";
import { ChangeSet, Text } from "@codemirror/state";
import type { Command, KeyBinding } from "@codemirror/view";
import { goBack, goForward } from "./page/links.ts";
import { toggleDetailsAtCaret, toggleTaskAtCaret } from "./page/page.ts";
import { pageKeys, textChanges } from "./surface.ts";

const PLATFORMS = ["mac", "win", "linux"] as const;

/** The key a binding takes on a platform, as CodeMirror picks it. */
function keyOn(binding: KeyBinding, platform: (typeof PLATFORMS)[number]): string | undefined {
  return binding[platform] ?? binding.key;
}

/** The command the page tries first for a key, which runs before any after it. */
function first(platform: (typeof PLATFORMS)[number], key: string): Command | undefined {
  return pageKeys.find((binding) => keyOn(binding, platform) === key)?.run;
}

describe("the file's new text", () => {
  /** The new text, from the old and its changes, and where a place in the old goes. */
  function apply(old: string, next: string) {
    const changes = ChangeSet.of(textChanges(old, next), old.length);
    return { text: changes.apply(Text.of(old.split("\n"))).toString(), changes };
  }

  it("is the lines that differ, so every line both keep holds its place", () => {
    // #199: the page takes only what differs, so the caret and the scroll stay put.
    assert.deepEqual(textChanges("same\n", "same\n"), []);
    const lines = Array.from({ length: 50 }, (_, i) => `Line ${i}.\n`);
    const old = `# Old\n${lines.join("")}End.\n`;
    // An edit at the top and another at the foot: the lines between them stay where they were.
    const next = `# New, longer\n${lines.join("")}End, and more.\n`;
    const { text, changes } = apply(old, next);
    assert.equal(text, next);
    const middle = old.indexOf("Line 25.");
    assert.equal(changes.mapPos(middle), next.indexOf("Line 25."));
    assert.equal(textChanges(old, next).length, 2);
    // Lines added and taken away between others.
    for (const [from, to] of [
      ["a\nb\nc\nd\n", "a\nc\nd\ne\n"],
      ["a\nb\n", "x\na\ny\nb\nz"],
      ["", "new\n"],
      ["gone\n", ""],
      ["no break at the end", "no break at the end, still"],
      ["a\nb\nc", "c\nb\na"],
    ]) {
      assert.equal(apply(from, to).text, to, JSON.stringify([from, to]));
    }
  });

  it("is one stretch when more lines differ than it will count", () => {
    const old = Array.from({ length: 1200 }, (_, i) => `${i}\n`).join("");
    const next = Array.from({ length: 1200 }, (_, i) => `${i % 2 ? i : -i}\n`).join("");
    assert.equal(textChanges(old, next).length, 1);
    assert.equal(apply(old, next).text, next);
  });
});

describe("the page's keys", () => {
  it("stop on a drawn block from every key CodeMirror moves a line with, as Up and Down do", () => {
    for (const platform of PLATFORMS) {
      const down = first(platform, "ArrowDown");
      const up = first(platform, "ArrowUp");
      assert.notEqual(down, cursorLineDown);
      assert.notEqual(up, cursorLineUp);
      // macOS adds Ctrl+N and Ctrl+P, from CodeMirror's Emacs keys.
      for (const binding of standardKeymap) {
        const key = keyOn(binding, platform);
        if (!key) continue;
        if (binding.run === cursorLineDown) assert.equal(first(platform, key), down, key);
        if (binding.run === cursorLineUp) assert.equal(first(platform, key), up, key);
      }
    }
  });

  it("go back and forward with Alt and an arrow, or ⌘[ and ⌘] on macOS, where Alt moves by words", () => {
    for (const platform of ["win", "linux"] as const) {
      assert.equal(first(platform, "Alt-ArrowLeft"), goBack, platform);
      assert.equal(first(platform, "Alt-ArrowRight"), goForward, platform);
    }
    assert.equal(first("mac", "Mod-["), goBack);
    assert.equal(first("mac", "Mod-]"), goForward);
    assert.notEqual(first("mac", "Alt-ArrowLeft"), goBack);
  });

  it("try a details' tags, then a task's text, on Enter, before CodeMirror's own Enter", () => {
    for (const platform of PLATFORMS) {
      const enter = pageKeys.filter((binding) => keyOn(binding, platform) === "Enter");
      assert.deepEqual(
        enter.slice(0, 2).map((binding) => binding.run),
        [toggleDetailsAtCaret, toggleTaskAtCaret],
        platform,
      );
    }
  });
});
