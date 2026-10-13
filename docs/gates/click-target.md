# Click-target gate

docs/hld.md §9. Product UI waits on this result.

Run: 2026-10-10. Ubuntu 24.04 LTS, WebKitGTK 2.52.6, under Xvfb. Pointer input through tauri-driver and WebKitWebDriver, which WebKit delivers as the user's own, not dispatched from script. The fixture and the cases are in [`desktop/test/gate/click-target.mjs`](../../desktop/test/gate/click-target.mjs).

```bash
cd desktop
npx tauri build --debug --no-bundle
node test/gate/click-target.mjs src-tauri/target/debug/hshblk
```

## Result: pass, 26 of 26

Rows 1 to 4 are from 2026-10-10. Row 5 came on 2026-10-11, below.

| Row | Case | Result | Measured |
|---|---|---|---|
| 1 | left half of the first character of `**bold**` | pass | caret after `Some **`, before `bold** words` |
| 1 | right half of the last character | pass | caret after `Some **bold`, before `** words` |
| 2 | past the end of a line ending in `**bold**` | pass | caret after `Ends in **bold**` |
| 3 | ten links in a wrapped paragraph | pass, 10 of 10 | the clicked character keeps its line, and the address shows at the caret |
| 4 | drag from plain text across `**bold**` | pass | the selection ends where the pointer was released |
| 5 | twelve bold, italic, and code words in a wrapped paragraph | pass, 12 of 12 | the clicked character keeps its line |

## The first run: 12 of 14

- **Row 2 failed on a bug.** A click past the end of a line landed where the visible text stopped, which is inside the hidden closing marks. The page now puts it at the end of the line ([`desktop/src/page/pointer.ts`](../../desktop/src/page/pointer.ts)).
- **Row 3 failed on the design, 1 link in 10.** Unfolding a link put its `[` before the clicked word, and the word wrapped onto the next line. This is the jump the gate exists to find. The decision, in §7: a link's syntax never unfolds inline. Its address shows in a popover at the caret, where the editor will edit it.

## Re-runs

Later the same day, row 3 failed in some runs with "no caret" on its second link. The page was right and the measuring was wrong, twice over. A caret before a link's first word can sit at the end of the text node before it, which is the same place, and the gate measured the empty range there. And the click returns before CodeMirror has drawn what it did, so for a moment the DOM selection sits between lines. The gate now measures the next character in the line, and reads the caret once it is in one. Six runs since: 14 of 14 each.

## The host spot-check, in a VM

Run: 2026-10-13, for #22, in a VM, not on bare metal: Ubuntu 24.04.5 LTS desktop in VirtualBox 7.2.14, a GNOME Wayland session, IBus 1.5.29, WebKitGTK 2.52.6. The GPU is VirtualBox's VMSVGA with 3D off, and EGL has no DRI screen. Debug build of 7bb1290, whose page code main still has then.

- **The window painted once, then stopped.** Under WebKitGTK's default DMA-BUF renderer the page got no animation frames: `requestAnimationFrame` ran 0 times a second. CodeMirror measures and draws on them, so the page kept its first paint. The gate failed on its first case, since the plain line, below a long wrapped paragraph, was never drawn. With `WEBKIT_DISABLE_DMABUF_RENDERER=1` it ran 60 times a second. What the app does about it is #143.
- **The gate: 26 of 26,** with that variable set, through the same pointer input as under Xvfb.
- **IME, by hand.** Keystrokes went into the VM from the host, through IBus as a reader's do. With the caret inside `**bold words**`, its marks opened by the keys, IBus composed é from Ctrl+Shift+U, `e9`, and Space. The caret and the opened marks held through the composition, and the read-only page kept nothing. IBus showed its preedit in a popup, not inline, about 90 px below and 40 px right of the caret. So the caret's place reached the input method off by that much.
- **Not settled here:** a real GPU. #22 stays open for that.

## Not covered

- IME composition inside emphasis, in this gate. WebDriver cannot commit a composition. The host spot-check above did it by hand.
- macOS and Windows. tauri-driver does not run on macOS, and this run was on Linux only.
- Arrow movement through a block widget, which §9 also asks of the prototype. This gate drives the pointer. Up and Down went past a table, an HTML block, and a summary until #90. The acceptance suite now walks all three: `desktop/test/acceptance.mjs`, under `a <details> around markdown`.
- A real GPU. Xvfb has no compositor or input method, and the VM above has both but no GPU. The spot-check on bare metal is still to run.
## Row 5: bold, italic, and code

Twelve words in a wrapped paragraph, marked bold, italic, and code in turn. Each is clicked on the left of its first character.

First run, 2026-10-10, three runs: 10 of 12. The click opened the word's marks inline, and two words that ended their line no longer fit in it and wrapped:

| Case | Result | Measured |
|---|---|---|
| `` `exercitation` `` | **fail** | the clicked character moves from top 427 to 457, one line down |
| `*consequat*` | **fail** | from top 514 to 544, one line down |
| the other ten | pass | the clicked character keeps its line |

This is the jump row 3 found for links. On 2026-10-11, on `main`, it was 11 of 12, `` `exercitation` `` still one line down.

The decision, in §7: a click or a drag opens no syntax. The keyboard and find still do. Since then, 12 of 12 in each of three runs, and rows 1 to 4 still pass.

With the marks folded after a click, the DOM holds no text for them, so rows 1, 2, and 4 now read the caret from the source, through CodeMirror's state. Row 4 still takes its point from the browser's own hit test. Run against a build where a click opens marks, the gate fails row 5 as before, and reads rows 1 and 2 as before.
