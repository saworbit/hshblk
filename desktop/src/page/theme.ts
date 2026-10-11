import { EditorView } from "@codemirror/view";
import { HANG_LIMIT } from "./page.ts";

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
  ".pg-fence": { color: "var(--muted)" },
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
  ".pg-table": { overflowX: "auto", margin: "0.6em 0" },
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
  ".cm-searchMatch": { backgroundColor: "color-mix(in oklab, var(--accent) 18%, transparent)" },

  // Print is the whole page, not a window's worth of it: no scroller, and no height to fill.
  "@media print": {
    "&": { display: "block" },
    ".cm-scroller": { overflow: "visible" },
  },
});
