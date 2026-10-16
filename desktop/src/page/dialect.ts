import { defineLanguageFacet, Language } from "@codemirror/language";
import { type MarkdownConfig, parser, Strikethrough, Table, TaskList } from "@lezer/markdown";

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
 * docs/hld.md §7: CommonMark, GFM tables, strikethrough by `~` or `~~`, task lists, and GitHub's
 * emoji shortcodes. Anything else is source.
 */
export const dialect = parser.configure([Table, Strikethrough, SingleTilde, TaskList, Shortcode]);

export const markdown = new Language(defineLanguageFacet(), dialect, [], "markdown");
