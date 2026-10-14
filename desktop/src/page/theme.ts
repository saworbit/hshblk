import { EditorView } from "@codemirror/view";
import { HANG_LIMIT, QUOTE_LIMIT } from "./page.ts";

/**
 * A list item's lines hang under its text. The page names a width in columns, so a class a
 * width: the CSP takes no inline style.
 */
const hangs = Object.fromEntries(
  Array.from({ length: HANG_LIMIT }, (_, i) => i + 1).flatMap((n) => [
    [`.pg-hang-${n}`, { paddingLeft: `${n}ch`, textIndent: `-${n}ch` }],
    [`.pg-pad-${n}`, { paddingLeft: `${n}ch` }],
    [`.pg-box-${n}`, { display: "inline-block", width: `${n}ch`, textIndent: "0" }],
  ]),
);

/**
 * A quote inside a quote draws a rule for each level past the first, whose rule is its border.
 * The step is the page's text size, not the line's, so the rules stay put beside a heading or code.
 */
const step = "1.125rem";
const quotes = Object.fromEntries(
  Array.from({ length: QUOTE_LIMIT - 1 }, (_, i) => i + 2).map((depth) => {
    const rules = Array.from({ length: depth - 1 }, (_, i) => i + 1);
    return [
      `.pg-quote-${depth}`,
      {
        paddingLeft: `calc(${depth} * ${step} + ${(depth - 1) * 2}px)`,
        backgroundImage: rules.map(() => "linear-gradient(var(--rule), var(--rule))").join(", "),
        backgroundSize: rules.map(() => "2px 100%").join(", "),
        backgroundPosition: rules.map((n) => `calc(${n} * ${step} + ${(n - 1) * 2}px) 0`).join(", "),
        backgroundRepeat: "no-repeat",
      },
    ];
  }),
);

/**
 * The page's faces, over CodeMirror's base theme. The colours are the variables in
 * styles.css, so Paper and Ink both come through.
 */
export const pageTheme = EditorView.theme({
  "&": { flex: "1", minHeight: "0", backgroundColor: "var(--paper)", color: "var(--ink)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--serif)", fontSize: "1.125rem", lineHeight: "1.7" },
  ".cm-content": {
    boxSizing: "border-box",
    width: "100%",
    maxWidth: "44rem",
    margin: "0 auto",
    padding: "3rem 1.5rem 6rem",
    caretColor: "var(--accent)",
  },
  ".cm-line": { padding: "0" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--accent)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "color-mix(in oklab, var(--accent) 22%, transparent)",
  },

  // docs/hld.md §7, one rule a construct.
  ".pg-heading": { fontWeight: "560", lineHeight: "1.3" },
  ".pg-h1": { fontSize: "2.1em", letterSpacing: "-0.01em", paddingBottom: "0.2em" },
  ".pg-h2": { fontSize: "1.5em", paddingTop: "0.6em" },
  ".pg-h3": { fontSize: "1.25em", paddingTop: "0.4em" },
  ".pg-h4, .pg-h5, .pg-h6": { fontSize: "1.05em" },
  ".pg-em": { fontStyle: "italic" },
  ".pg-strong": { fontWeight: "650" },
  ".pg-strike": { color: "var(--muted)", textDecoration: "line-through" },
  // Hidden syntax draws as an empty span between two images, which CodeMirror adds for a caret
  // beside a widget. A line may break at an image, so a full stop could wrap onto a line alone.
  ".cm-widgetBuffer:has(+ [contenteditable=false]:empty)": { display: "none" },
  "[contenteditable=false]:empty + .cm-widgetBuffer": { display: "none" },
  ".pg-code": {
    fontFamily: "var(--mono)",
    fontSize: "0.86em",
    backgroundColor: "var(--code)",
    borderRadius: "4px",
    padding: "0.1em 0.3em",
  },
  ".pg-link": {
    color: "var(--accent)",
    textDecoration: "underline",
    textDecorationColor: "var(--rule)",
    textUnderlineOffset: "0.25em",
  },
  ".pg-list-mark": { color: "var(--muted)" },
  ...hangs,
  ".pg-quote": { color: "var(--muted)", borderLeft: "2px solid var(--rule)", paddingLeft: "1em" },
  ".pg-code-block, .pg-source-block": {
    fontFamily: "var(--mono)",
    fontSize: "0.85em",
    lineHeight: "1.6",
    backgroundColor: "var(--code)",
    padding: "0 1em",
  },
  // After the code block's padding, so code in a nested quote clears its rules.
  ...quotes,
  ".pg-fence": { color: "var(--muted)" },
  // YAML frontmatter is data about the file, so it shows as written, and stays quiet.
  ".pg-frontmatter": { color: "var(--muted)" },
  ".pg-source-block": { boxShadow: "inset 2px 0 0 var(--rule)" },
  ".pg-rule": {
    background: "linear-gradient(var(--rule), var(--rule)) center / 100% 1px no-repeat",
  },
  // A setext underline, hidden with its line until the selection opens it.
  ".pg-collapsed": { fontSize: "0", lineHeight: "0" },
  ".pg-figure": { display: "block" },
  ".pg-image": { display: "block", maxWidth: "100%", margin: "0.6em 0" },
  ".pg-image-missing": {
    display: "block",
    margin: "0.6em 0",
    padding: "0.4em 0.8em",
    border: "1px solid var(--rule)",
    backgroundColor: "var(--code)",
    color: "var(--muted)",
    fontSize: "0.85em",
  },
  // An image in a line of text stays in the line, and its placeholder is a chip of its words.
  ".pg-figure-inline .pg-image": { display: "inline-block", margin: "0", verticalAlign: "middle" },
  ".pg-image-chip": {
    display: "inline-block",
    margin: "0",
    padding: "0 0.4em",
    borderRadius: "4px",
    lineHeight: "1.5",
  },
  // Padding, not margin: CodeMirror measures a block widget without its margins, and a click
  // below one would land on the line above.
  // The page takes the pointer over a frame. WebKit runs no listener in a frame without
  // allow-scripts, the page's own included, so a click there would reach nothing that can act.
  ".pg-html": {
    display: "block",
    width: "100%",
    height: "0",
    border: "0",
    pointerEvents: "none",
  },
  // A task box, drawn in place of its `[ ]`. Ticked, it takes the accent and a check.
  ".pg-task": {
    display: "inline-block",
    position: "relative",
    boxSizing: "border-box",
    width: "0.9em",
    height: "0.9em",
    border: "1.5px solid var(--muted)",
    borderRadius: "3px",
    verticalAlign: "-0.1em",
    cursor: "pointer",
  },
  ".pg-task-ticked": { borderColor: "var(--accent)", backgroundColor: "var(--accent)" },
  ".pg-task-ticked::after": {
    content: '"✓"',
    position: "absolute",
    inset: "0",
    color: "var(--paper)",
    fontSize: "0.75em",
    lineHeight: "1",
    textAlign: "center",
  },
  ".pg-summary": { cursor: "pointer", padding: "0.3em 0" },
  ".pg-summary::before": { content: '"▸"', display: "inline-block", width: "1.2em" },
  ".pg-summary-open::before": { content: '"▾"' },
  ".pg-table": { overflowX: "auto", padding: "0.6em 0" },
  ".pg-table table": { borderCollapse: "collapse", width: "100%", fontSize: "0.95em" },
  ".pg-table th, .pg-table td": {
    textAlign: "left",
    verticalAlign: "top",
    padding: "0.4em 1em 0.4em 0",
    borderBottom: "1px solid var(--rule)",
    // Not CodeMirror's `anywhere`, which sizes a column by one letter. A word too long for its
    // column still breaks, and the table scrolls when its words cannot fit.
    overflowWrap: "break-word",
    wordBreak: "normal",
  },
  ".pg-table th": { fontWeight: "560" },

  // A link's address, at the caret. docs/hld.md §7.
  ".cm-tooltip.cm-tooltip": {
    border: "1px solid var(--rule)",
    borderRadius: "6px",
    backgroundColor: "var(--paper)",
    boxShadow: "0 4px 16px color-mix(in oklab, var(--ink) 12%, transparent)",
  },
  ".cm-tooltip-below": { marginTop: "4px" },
  ".pg-address": {
    display: "flex",
    alignItems: "center",
    gap: "0.75em",
    maxWidth: "36rem",
    padding: "0.35em 0.6em",
    fontFamily: "var(--mono)",
    fontSize: "0.75rem",
    color: "var(--muted)",
  },
  ".pg-address-lines": { display: "flex", flexDirection: "column", minWidth: "0" },
  ".pg-address-url": { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  ".pg-address-url mark": {
    color: "inherit",
    backgroundColor: "color-mix(in oklab, var(--accent) 30%, transparent)",
  },
  ".pg-address button": {
    font: "inherit",
    color: "var(--paper)",
    backgroundColor: "var(--ink)",
    border: "0",
    borderRadius: "999px",
    padding: "0.2em 0.8em",
    cursor: "pointer",
  },

  // Find: CodeMirror's panel, in the page's faces.
  ".cm-panels": {
    backgroundColor: "var(--paper)",
    color: "var(--ink)",
    borderColor: "var(--rule)",
    fontFamily: "var(--mono)",
    fontSize: "0.8rem",
  },
  ".cm-panels input, .cm-panels button": { font: "inherit" },
  // CodeMirror's field and buttons are light, and took the page's ink by night (#179).
  ".cm-panels .cm-textfield, .cm-panels .cm-button": {
    color: "var(--ink)",
    backgroundColor: "var(--paper)",
    backgroundImage: "none",
    border: "1px solid var(--rule)",
    borderRadius: "4px",
  },
  ".cm-panels .cm-button": { backgroundColor: "var(--code)", cursor: "pointer" },
  ".cm-panels .cm-button:active": { backgroundImage: "none", borderColor: "var(--muted)" },

  // The frontmatter panel: the fields as a list, or the YAML as written.
  ".pg-front-panel": { padding: "0.5rem 1rem", maxHeight: "40vh", overflowY: "auto" },
  ".pg-front-head": { display: "flex", alignItems: "center", gap: "1em" },
  ".pg-front-title": { color: "var(--muted)", marginRight: "auto" },
  ".pg-front-head button": {
    color: "var(--ink)",
    background: "none",
    border: "1px solid var(--rule)",
    borderRadius: "4px",
    padding: "0.1em 0.6em",
    cursor: "pointer",
  },
  ".pg-front-fields": {
    display: "grid",
    gridTemplateColumns: "max-content 1fr",
    gap: "0.25em 1.5em",
    margin: "0.5rem 0 0",
  },
  ".pg-front-fields dt": { color: "var(--muted)" },
  ".pg-front-fields dd": { margin: "0", overflowWrap: "anywhere" },
  ".pg-front-block": { whiteSpace: "pre-wrap" },
  ".pg-front-yaml": { margin: "0.5rem 0 0", whiteSpace: "pre-wrap", overflowWrap: "anywhere" },
  ".cm-searchMatch": { backgroundColor: "color-mix(in oklab, var(--accent) 18%, transparent)" },

  // Print is the whole page, not a window's worth of it: no scroller, and no height to fill.
  // The find box and the frontmatter panel are for the screen, as the status line is.
  "@media print": {
    "&": { display: "block" },
    ".cm-scroller": { overflow: "visible" },
    ".cm-panels": { display: "none" },
  },
});
