import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cursorLineDown, cursorLineUp, standardKeymap } from "@codemirror/commands";
import type { Command, KeyBinding } from "@codemirror/view";
import { goBack, goForward } from "./page/links.ts";
import { toggleDetailsAtCaret, toggleTaskAtCaret } from "./page/page.ts";
import { pageKeys } from "./surface.ts";

const PLATFORMS = ["mac", "win", "linux"] as const;

/** The key a binding takes on a platform, as CodeMirror picks it. */
function keyOn(binding: KeyBinding, platform: (typeof PLATFORMS)[number]): string | undefined {
  return binding[platform] ?? binding.key;
}

/** The command the page tries first for a key, which runs before any after it. */
function first(platform: (typeof PLATFORMS)[number], key: string): Command | undefined {
  return pageKeys.find((binding) => keyOn(binding, platform) === key)?.run;
}

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
