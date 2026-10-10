# Click-target gate

docs/hld.md §9. Product UI waits on this result.

Run: 2026-10-10. Ubuntu 24.04 LTS, WebKitGTK 2.52.6, under Xvfb. Pointer input through tauri-driver and WebKitWebDriver, which WebKit delivers as the user's own, not dispatched from script. The fixture and the cases are in [`desktop/test/gate/click-target.mjs`](../../desktop/test/gate/click-target.mjs).

```bash
cd desktop
npx tauri build --debug --no-bundle
node test/gate/click-target.mjs src-tauri/target/debug/hshblk
```

## Result: pass, 14 of 14

| Row | Case | Result | Measured |
|---|---|---|---|
| 1 | left half of the first character of `**bold**` | pass | caret after `Some **`, before `bold** words` |
| 1 | right half of the last character | pass | caret after `Some **bold`, before `** words` |
| 2 | past the end of a line ending in `**bold**` | pass | caret after `Ends in **bold**` |
| 3 | ten links in a wrapped paragraph | pass, 10 of 10 | the clicked character keeps its line, and the address shows at the caret |
| 4 | drag from plain text across `**bold**` | pass | the selection ends where the pointer was released |

## The first run: 12 of 14

- **Row 2 failed on a bug.** A click past the end of a line landed where the visible text stopped, which is inside the hidden closing marks. The page now puts it at the end of the line ([`desktop/src/page/pointer.ts`](../../desktop/src/page/pointer.ts)).
- **Row 3 failed on the design, 1 link in 10.** Unfolding a link put its `[` before the clicked word, and the word wrapped onto the next line. This is the jump the gate exists to find. The decision, in §7: a link's syntax never unfolds inline. Its address shows in a popover at the caret, where the editor will edit it.

## Re-runs

Later the same day, row 3 failed in some runs with "no caret" on its second link. The page was right and the measuring was wrong, twice over. A caret before a link's first word can sit at the end of the text node before it, which is the same place, and the gate measured the empty range there. And the click returns before CodeMirror has drawn what it did, so for a moment the DOM selection sits between lines. The gate now measures the next character in the line, and reads the caret once it is in one. Six runs since: 14 of 14 each.

## Not covered

- IME composition inside emphasis. WebDriver cannot commit a composition. It is the manual part of the host spot-check.
- macOS and Windows. tauri-driver does not run on macOS, and this run was on Linux only.
- A real session. Xvfb has no compositor or input method. The spot-check in §9 is on a real Ubuntu session.
- Bold, italic, and code still unfold inline. Their marks are one or two characters, so a jump is rare, but the gate does not measure it.
