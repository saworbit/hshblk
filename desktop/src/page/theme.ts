import { EditorView } from "@codemirror/view";
import { HANG_LIMIT, QUOTE_LIMIT } from "./page.ts";
import { ALERTS } from "./widgets.ts";

/**
 * A list item's lines hang under its text. The page names a width in columns, so a class a
 * width: the CSP takes no inline style. The hang is on the line's start side, which is the right
 * in Arabic or Hebrew (#198).
 */
const hangs = Object.fromEntries(
  Array.from({ length: HANG_LIMIT }, (_, i) => i + 1).flatMap((n) => [
    [`.pg-hang-${n}`, { paddingInlineStart: `${n}ch`, textIndent: `-${n}ch` }],
    [`.pg-pad-${n}`, { paddingInlineStart: `${n}ch` }],
    [`.pg-box-${n}`, { display: "inline-block", width: `${n}ch`, textIndent: "0" }],
    // A code block's or a quote's line in an item, by the page's columns, not its own face's.
    [`.pg-in-${n}`, { marginInlineStart: `calc(${n} * var(--pg-ch))` }],
  ]),
);

/** Each alert's colour, a variable styles.css sets by day and by night (#219). */
const alerts = Object.fromEntries(
  ALERTS.map((kind) => [`.pg-alert-${kind}`, { "--alert": `var(--${kind})` }]),
);

/** The reader's text size, a share of the page's own, which setTextSize sets (#164). */
const SIZE = "var(--pg-size, 1)";

/**
 * A quote inside a quote draws a rule for each level past the first, whose rule is its border.
 * The step is the page's text size, not the line's, so the rules stay put beside a heading or code.
 * A right-to-left quote has them on the right.
 */
const step = `calc(1.125rem * ${SIZE})`;
const quotes = Object.fromEntries(
  Array.from({ length: QUOTE_LIMIT - 1 }, (_, i) => i + 2).flatMap((depth) => {
    const rules = Array.from({ length: depth - 1 }, (_, i) => i + 1);
    const at = (n: number) => `calc(${n} * ${step} + ${(n - 1) * 2}px)`;
    return [
      [
        `.pg-quote-${depth}`,
        {
          paddingInlineStart: `calc(${depth} * ${step} + ${(depth - 1) * 2}px)`,
          backgroundImage: rules.map(() => "linear-gradient(var(--rule), var(--rule))").join(", "),
          backgroundSize: rules.map(() => "2px 100%").join(", "),
          backgroundPosition: rules.map((n) => `${at(n)} 0`).join(", "),
          backgroundRepeat: "no-repeat",
        },
      ],
      [
        `.pg-quote-${depth}:dir(rtl)`,
        { backgroundPosition: rules.map((n) => `right ${at(n)} top 0`).join(", ") },
      ],
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
  ".cm-scroller": {
    fontFamily: "var(--serif)",
    fontSize: `calc(1.125rem * ${SIZE})`,
    lineHeight: "1.7",
  },
  ".cm-content": {
    boxSizing: "border-box",
    width: "100%",
    maxWidth: `calc(44rem * ${SIZE})`,
    margin: "0 auto",
    padding: "3rem 1.5rem 6rem",
    caretColor: "var(--accent)",
    // The page's column, as a length a line in another face can step in by (styles.css).
    "--pg-ch": "1ch",
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
  // Four to six step down, as GitHub's do, and six is muted, so a deep outline reads (#211).
  ".pg-h4": { fontSize: "1.1em" },
  ".pg-h5": { fontSize: "1em" },
  ".pg-h6": { fontSize: "0.92em", color: "var(--muted)" },
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
  // #200: inline HTML's keys, sub, sup, and mark, as GitHub draws them. Sub and sup take no line
  // height, so a line with one keeps its spacing.
  ".pg-kbd": {
    fontFamily: "var(--mono)",
    fontSize: "0.8em",
    backgroundColor: "var(--code)",
    border: "1px solid var(--rule)",
    borderBottomWidth: "2px",
    borderRadius: "4px",
    padding: "0.05em 0.4em",
  },
  ".pg-sub": { fontSize: "0.75em", verticalAlign: "sub", lineHeight: "0" },
  ".pg-sup": { fontSize: "0.75em", verticalAlign: "super", lineHeight: "0" },
  ".pg-mark": {
    color: "inherit",
    backgroundColor: "color-mix(in oklab, var(--warning) 30%, transparent)",
  },
  // `<br>` in a line: a block of no height ends the line where it stands.
  ".pg-break": { display: "block" },
  ".pg-link": {
    color: "var(--accent)",
    textDecoration: "underline",
    textDecorationColor: "var(--rule)",
    textUnderlineOffset: "0.25em",
  },
  ".pg-list-mark": { color: "var(--muted)" },
  ...hangs,
  ".pg-quote": {
    color: "var(--muted)",
    borderInlineStart: "2px solid var(--rule)",
    paddingInlineStart: "1em",
  },
  // #219: GitHub's alerts. The quote's rule and its label take the alert's colour, on a tint.
  ...alerts,
  ".pg-alert": {
    color: "var(--ink)",
    borderInlineStartColor: "var(--alert)",
    backgroundColor: "color-mix(in oklab, var(--alert) 7%, transparent)",
  },
  ".pg-alert-label": {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.4em",
    color: "var(--alert)",
    fontWeight: "600",
  },
  ".pg-alert-label svg": {
    width: "1em",
    height: "1em",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.5",
    strokeLinecap: "round",
    strokeLinejoin: "round",
  },
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
  // #215: with its fences folded, a block's first and last lines take the room they gave, and
  // its language is a quiet label at its top right, which the first line's words wrap around.
  ".pg-code-first": { paddingTop: "0.5em" },
  ".pg-code-last": { paddingBottom: "0.5em" },
  ".pg-code-first[data-language]::before": {
    content: "attr(data-language)",
    float: "inline-end",
    marginInlineStart: "1em",
    fontSize: "0.8em",
    color: "var(--muted)",
    userSelect: "none",
  },
  // #217: a code block that names its language, its tokens in the page's own colours.
  ".pg-tok-keyword": { color: "var(--important)" },
  ".pg-tok-string": { color: "var(--tip)" },
  ".pg-tok-comment": { color: "var(--muted)", fontStyle: "italic" },
  ".pg-tok-literal": { color: "var(--warning)" },
  ".pg-tok-function": { color: "var(--note)" },
  ".pg-tok-type": { color: "var(--caution)" },
  ".pg-tok-meta": { color: "var(--note)" },
  ".pg-tok-inserted": {
    color: "var(--tip)",
    backgroundColor: "color-mix(in oklab, var(--tip) 12%, transparent)",
  },
  ".pg-tok-deleted": {
    color: "var(--caution)",
    backgroundColor: "color-mix(in oklab, var(--caution) 12%, transparent)",
  },
  // Frontmatter, YAML or TOML, is data about the file, so it shows as written, and stays quiet.
  ".pg-frontmatter": { color: "var(--muted)" },
  ".pg-source-block": { boxShadow: "inset 2px 0 0 var(--rule)" },
  ".pg-rule": {
    // The line holds only its hidden marks, which leave it no height to draw in (#187).
    minHeight: "1.7em",
    background: "linear-gradient(var(--rule), var(--rule)) center / 100% 1px no-repeat",
  },
  // A setext underline, hidden with its line until the selection opens it.
  ".pg-collapsed": { fontSize: "0", lineHeight: "0" },
  ".pg-figure": { display: "block" },
  // #218: a reference to a footnote is its number, raised. A footnote is small and quiet, and
  // the first is set apart by a rule. Padding, not margin, which CodeMirror's heights miss.
  ".pg-note-reference": {
    fontSize: "0.75em",
    lineHeight: "0",
    padding: "0 0.1em",
    color: "var(--accent)",
    cursor: "pointer",
  },
  ".pg-note": { fontSize: "0.9em", color: "var(--muted)" },
  ".pg-note-first": { borderTop: "1px solid var(--rule)", paddingTop: "0.75em" },
  ".pg-note-number": { color: "var(--ink)", marginInlineEnd: "0.4em" },
  ".pg-note-back": { color: "var(--accent)", marginInlineStart: "0.3em", cursor: "pointer" },
  // #225: markdown in a `<div align>` takes its alignment, a block image too.
  ".pg-align-center": { textAlign: "center" },
  ".pg-align-right": { textAlign: "right" },
  ".pg-align-left": { textAlign: "left" },
  ".pg-align-center .pg-image": { marginInline: "auto" },
  ".pg-align-right .pg-image": { marginLeft: "auto", marginRight: "0" },
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
  // A task box, drawn in place of its `[ ]`. Ticked, it takes the accent and a check. A list
  // line hangs by a negative indent, which the check would take, and draw left of the box (#158).
  ".pg-task": {
    display: "inline-block",
    position: "relative",
    textIndent: "0",
    boxSizing: "border-box",
    width: "0.9em",
    height: "0.9em",
    border: "1.5px solid var(--muted)",
    borderRadius: "3px",
    verticalAlign: "-0.1em",
    cursor: "pointer",
  },
  ".pg-task-ticked": { borderColor: "var(--accent)", backgroundColor: "var(--accent)" },
  // In a bullet's place, it hangs a little into the margin, as GitHub's does, to leave a gap
  // before the text, which starts where a plain item's does (#212).
  ".pg-task-place .pg-task": { marginInlineStart: "-0.2em" },
  ".pg-task-ticked::after": {
    content: '"✓"',
    position: "absolute",
    inset: "0",
    color: "var(--paper)",
    fontSize: "0.75em",
    lineHeight: "1",
    textAlign: "center",
  },
  ".pg-summary": { cursor: "pointer", padding: "0.3em 0", whiteSpace: "normal" },
  ".pg-summary::before": { content: '"▸"', display: "inline-block", width: "1.2em" },
  ".pg-summary-open::before": { content: '"▾"' },
  ".pg-table": { overflowX: "auto", padding: "0.6em 0" },
  ".pg-table table": { borderCollapse: "collapse", width: "100%", fontSize: "0.95em" },
  // #173: a long table's later rows, a chunk at a time, skipped while off the screen.
  ".pg-table-chunk": { contentVisibility: "auto" },
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
  // Why a link does not open, where its button would be (#156).
  ".pg-address-why": { fontFamily: "var(--serif)", fontStyle: "italic" },
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

  // The outline: each heading a button, stepped in by its level, the one in view marked (#236).
  ".pg-outline": { padding: "0.5rem 1rem", maxHeight: "40vh", overflowY: "auto" },
  ".pg-outline-head": { display: "flex", alignItems: "center", gap: "1em" },
  ".pg-outline-title": { color: "var(--muted)", marginRight: "auto" },
  ".pg-outline-close": {
    color: "var(--ink)",
    background: "none",
    border: "1px solid var(--rule)",
    borderRadius: "4px",
    padding: "0.1em 0.6em",
    cursor: "pointer",
  },
  ".pg-outline-list": { listStyle: "none", margin: "0.5rem 0 0", padding: "0" },
  ".pg-outline-list button": {
    font: "inherit",
    maxWidth: "100%",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: "var(--ink)",
    background: "none",
    border: "0",
    borderRadius: "4px",
    padding: "0.1em 0.4em",
    textAlign: "start",
    cursor: "pointer",
  },
  ".pg-outline-list button:hover": { textDecoration: "underline" },
  ".pg-outline-list button[aria-current]": { color: "var(--accent)" },
  ...Object.fromEntries(
    [2, 3, 4, 5, 6].map((n) => [`.pg-outline-${n}`, { paddingInlineStart: `${n - 1}em` }]),
  ),
  ".cm-searchMatch": { backgroundColor: "color-mix(in oklab, var(--accent) 18%, transparent)" },
  // The match the selection is on stands out from the rest (#159).
  ".cm-searchMatch.cm-searchMatch-selected": {
    backgroundColor: "color-mix(in oklab, var(--accent) 45%, transparent)",
    outline: "1px solid var(--accent)",
  },
  // It selected one match, not all: the page keeps one selection (#202).
  ".cm-search button[name=select]": { display: "none" },
  ".pg-find-count": { color: "var(--muted)", fontSize: "0.9em", margin: "0 0.5em" },

  // #233: under a contrast theme, a break's and a quote's rules keep their drawing, in the
  // theme's colours (styles.css), and a code or HTML block is marked by a rule at its side.
  "@media (forced-colors: active)": {
    [[".pg-rule", ...Object.keys(quotes)].join(", ")]: { forcedColorAdjust: "none" },
    ".pg-code-block": { borderInlineStart: "3px solid CanvasText" },
    ".pg-source-block": { boxShadow: "none", borderInlineStart: "2px solid CanvasText" },
    ".pg-mark": { backgroundColor: "Mark", color: "MarkText", forcedColorAdjust: "none" },
  },

  // Print is the whole page, not a window's worth of it: no scroller, and no height to fill.
  // The find box and the frontmatter panel are for the screen, as the status line is.
  // Print is at the page's own size, whatever the reader set for the screen.
  // A link to the web or mail prints its address after its words, as paper has no popover (#237).
  // An inline block takes no underline from the link.
  "@media print": {
    "&": { display: "block", "--pg-size": "1 !important" },
    ".cm-scroller": { overflow: "visible" },
    ".cm-panels": { display: "none" },
    ".pg-table-chunk": { contentVisibility: "visible" },
    ".pg-link[data-print]::after": {
      content: '" (" attr(data-print) ")"',
      display: "inline-block",
      fontFamily: "var(--mono)",
      fontSize: "0.75em",
      color: "var(--muted)",
      overflowWrap: "anywhere",
    },
  },
});
