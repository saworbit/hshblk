import { defineLanguageFacet, Language } from "@codemirror/language";
import { parser, Strikethrough, Table, TaskList } from "@lezer/markdown";

/**
 * docs/hld.md §7: CommonMark, GFM tables, `~~` strikethrough, and task lists. Anything else is
 * source.
 */
export const dialect = parser.configure([Table, Strikethrough, TaskList]);

export const markdown = new Language(defineLanguageFacet(), dialect, [], "markdown");
