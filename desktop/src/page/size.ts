import type { EditorView } from "@codemirror/view";
import { matchFrames } from "./widgets.ts";

/** The text sizes Ctrl+= and Ctrl+− step through, as a share of the page's own (#164). */
export const SIZES = [0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

/** The size a step up or down from `size`, as far as the list goes, or the page's own for 0. */
export function stepSize(size: number, step: -1 | 0 | 1): number {
  if (step === 0) return 1;
  const at = SIZES.indexOf(size);
  const next = (at < 0 ? SIZES.indexOf(1) : at) + step;
  return SIZES[Math.min(Math.max(next, 0), SIZES.length - 1)];
}

/** The page's text size, as setTextSize left it. */
export function textSize(view: EditorView): number {
  return Number(view.dom.style.getPropertyValue("--pg-size")) || 1;
}

/**
 * Sizes the page's text, and the column and indents that go with it. Print keeps the page's own.
 * An HTML block's frame copies the page's size when it loads, so each drawn one is told again.
 */
export function setTextSize(view: EditorView, size: number): void {
  view.dom.style.setProperty("--pg-size", String(size));
  matchFrames(view);
  view.requestMeasure();
}
