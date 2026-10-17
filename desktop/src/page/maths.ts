import type Katex from "katex";

/**
 * #220: maths, drawn by KaTeX, a chunk of its own with its stylesheet and fonts, which the shell
 * loads before the page draws only when its text holds something shaped like maths. Until then a
 * formula shows its TeX. KaTeX builds its nodes and sets their styles one by one, which the page's
 * policy allows, where markup with style attributes would be refused. It is given no trust, so
 * `\href`, `\url`, `\includegraphics`, and the HTML commands draw nothing that leaves the formula.
 */
let katex: typeof Katex | null = null;
let loading: Promise<void> | null = null;

/** Something shaped like maths, as the dialect reads it: a `$`, or a fenced block of `math`. */
export const MATHS = /\$|^ {0,3}(`{3,}|~{3,})\s*math\b/im;

/** Loads KaTeX and its stylesheet, once. */
export function loadMaths(): Promise<void> {
  loading ??= Promise.all([import("katex"), import("katex/dist/katex.min.css")]).then(
    ([module]) => {
      katex = module.default;
    },
  );
  return loading;
}

/** Draws a formula into `into`, and says whether it could: not before KaTeX has loaded. */
export function drawMaths(tex: string, display: boolean, into: HTMLElement): boolean {
  if (!katex) return false;
  katex.render(tex, into, {
    displayMode: display,
    throwOnError: false,
    trust: false,
    strict: "ignore",
    output: "htmlAndMathml",
  });
  return true;
}
