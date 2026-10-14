import { type Extension, RangeSetBuilder, type Text } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";

/** A letter of a script written right to left: Hebrew, Arabic, Syriac, Thaana, N'Ko, and others. */
const RIGHT_TO_LEFT = /[֐-ࣿיִ-﷿ﹰ-﻿\u{10800}-\u{10FFF}\u{1E800}-\u{1EFFF}]/u;

/** A line that takes its direction from its first strong letter, as a browser's `dir="auto"`. */
const auto = Decoration.line({ attributes: { dir: "auto" } });

/**
 * The lines from `from` to `to` that hold right-to-left letters, each marked to take its direction
 * from its text. A line of left-to-right text with a word of Arabic in it stays left to right.
 */
export function directions(doc: Text, from: number, to: number): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (let pos = from; pos <= to; ) {
    const line = doc.lineAt(pos);
    if (RIGHT_TO_LEFT.test(line.text)) builder.add(line.from, line.from, auto);
    pos = line.to + 1;
  }
  return builder.finish();
}

/**
 * #198: an Arabic or a Hebrew block reads right to left, aligned right, with its punctuation in
 * place, as GitHub draws it. The page is one view, which laid every line out left to right.
 * CodeMirror reads each line's direction from its style, for the caret and the keys.
 */
export const textDirection: Extension = [
  EditorView.perLineTextDirection.of(true),
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = directions(view.state.doc, view.viewport.from, view.viewport.to);
      }

      update(update: ViewUpdate) {
        if (!update.docChanged && !update.viewportChanged) return;
        const { from, to } = update.view.viewport;
        this.decorations = directions(update.state.doc, from, to);
      }
    },
    { decorations: (plugin) => plugin.decorations },
  ),
];
