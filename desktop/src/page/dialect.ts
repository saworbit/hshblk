import { defineLanguageFacet, Language } from "@codemirror/language";
import {
  Autolink,
  type MarkdownConfig,
  parser,
  Strikethrough,
  Table,
  TaskList,
} from "@lezer/markdown";

/** Punctuation, as Lezer's own delimiters read it. */
const PUNCTUATION = /[\p{P}\p{S}]/u;

/**
 * Its own delimiter, so a single `~` closes only a single `~`, and `~~` only `~~`, as GFM pairs
 * them. Both make the node Lezer's `~~` makes, so the page draws them alike.
 */
const SINGLE_TILDE = { resolve: "Strikethrough", mark: "StrikethroughMark" };

/**
 * GitHub strikes text through between single tildes as well as double ones (#223). Lezer takes
 * only `~~`. A tilde beside another is part of a run, which is not this one's.
 */
const SingleTilde: MarkdownConfig = {
  parseInline: [
    {
      name: "SingleTilde",
      parse(cx, next, pos) {
        if (next !== 126 || cx.char(pos + 1) === 126 || cx.char(pos - 1) === 126) return -1;
        const before = cx.slice(pos - 1, pos);
        const after = cx.slice(pos + 1, pos + 2);
        const spaceBefore = /\s|^$/.test(before);
        const spaceAfter = /\s|^$/.test(after);
        const markBefore = PUNCTUATION.test(before);
        const markAfter = PUNCTUATION.test(after);
        const opens = !spaceAfter && (!markAfter || spaceBefore || markBefore);
        const closes = !spaceBefore && (!markBefore || spaceAfter || markAfter);
        return cx.addDelimiter(SINGLE_TILDE, pos, pos + 1, opens, closes);
      },
      after: "Strikethrough",
    },
  ],
};

/**
 * A shortcode, `:tada:`, as a node of its own: a colon, letters, digits, `_`, `+`, or `-`, and a
 * colon (#222). Which names are emoji is the page's to know, so an unknown one shows as written.
 */
const Shortcode: MarkdownConfig = {
  defineNodes: [{ name: "Emoji" }],
  parseInline: [
    {
      name: "Emoji",
      parse(cx, next, pos) {
        if (next !== 58) return -1;
        const code = /^:[a-z0-9_+-]+:/.exec(cx.slice(pos, Math.min(cx.end, pos + 64)));
        return code ? cx.addElement(cx.elt("Emoji", pos, pos + code[0].length)) : -1;
      },
    },
  ],
};

/**
 * #220: maths, as GitHub and Pandoc read it. `$...$` in a line, whose opening `$` has no space
 * after it, and whose closing one has none before it and no digit after, so `$5 and $10` stay
 * prices. `$$...$$` may run over the lines of its paragraph. A backslash escapes the character
 * after it, so `\$` is a dollar sign in the formula, and markdown inside it is TeX, not syntax.
 */
const Maths: MarkdownConfig = {
  defineNodes: [{ name: "InlineMath" }, { name: "DisplayMath" }, { name: "MathMark" }],
  parseInline: [
    {
      name: "Maths",
      parse(cx, next, pos) {
        if (next !== 36) return -1;
        const display = cx.char(pos + 1) === 36;
        const start = pos + (display ? 2 : 1);
        if (!display && (start >= cx.end || /\s/.test(cx.slice(start, start + 1)))) return -1;
        for (let at = start; at < cx.end; at++) {
          const char = cx.char(at);
          if (char === 92) {
            at++;
          } else if (char === 10 && !display) {
            return -1;
          } else if (char === 36 && display && cx.char(at + 1) === 36) {
            if (at === start) return -1;
            const marks = [cx.elt("MathMark", pos, start), cx.elt("MathMark", at, at + 2)];
            return cx.addElement(cx.elt("DisplayMath", pos, at + 2, marks));
          } else if (char === 36 && !display) {
            // The first `$` after the opening one closes it, or there is no formula.
            if (/\s/.test(cx.slice(at - 1, at)) || /\d/.test(cx.slice(at + 1, at + 2))) return -1;
            const marks = [cx.elt("MathMark", pos, start), cx.elt("MathMark", at, at + 1)];
            return cx.addElement(cx.elt("InlineMath", pos, at + 1, marks));
          }
        }
        return -1;
      },
      before: "Escape",
    },
  ],
};

/** A footnote's opening, `[^label]:`, the spaces after it, and its label. */
export const FOOTNOTE = /^\[\^([^\]\s]+)\]:[ \t]*/;

/**
 * A footnote, `[^label]: Its words.`, as a block that holds blocks, as a list item does (#218).
 * GitHub runs it on to each block indented four columns under it, so a second paragraph is more
 * of the note, not a code block (#284). One opening ends the paragraph before it, as GitHub
 * reads it, so the next line's `[^2]:` starts another.
 */
const Footnotes: MarkdownConfig = {
  defineNodes: [
    {
      name: "Footnote",
      block: true,
      composite(_cx, line, value) {
        if (line.indent < line.baseIndent + value && line.next > -1) return false;
        line.moveBaseColumn(line.baseIndent + value);
        return true;
      },
    },
    { name: "FootnoteMark" },
  ],
  parseBlock: [
    {
      name: "Footnote",
      parse(cx, line) {
        if (line.next !== 91 || line.indent >= line.baseIndent + 4) return false;
        const opening = FOOTNOTE.exec(line.text.slice(line.pos));
        if (!opening) return false;
        const from = cx.lineStart + line.pos;
        cx.startComposite("Footnote", line.basePos, 4);
        cx.addElement(cx.elt("FootnoteMark", from, from + opening[0].length));
        line.moveBase(line.pos + opening[0].length);
        return null;
      },
      endLeaf: (_cx, line) => line.next === 91 && FOOTNOTE.test(line.text.slice(line.pos)),
      before: "LinkReference",
    },
  ],
};

/**
 * docs/hld.md §7: CommonMark, GFM tables, strikethrough by `~` or `~~`, task lists, bare web and
 * mail addresses (#201), maths (#220), GitHub's footnotes, and its emoji shortcodes. Anything
 * else is source.
 */
export const dialect = parser.configure([
  Table,
  Strikethrough,
  SingleTilde,
  TaskList,
  Autolink,
  Maths,
  Footnotes,
  Shortcode,
]);

export const markdown = new Language(defineLanguageFacet(), dialect, [], "markdown");
