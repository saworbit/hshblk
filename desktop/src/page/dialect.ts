import { defineLanguageFacet, Language } from "@codemirror/language";
import { parser, Strikethrough, Table } from "@lezer/markdown";

/** docs/hld.md §7: CommonMark, GFM tables, and `~~` strikethrough. Anything else is source. */
export const dialect = parser.configure([Table, Strikethrough]);

export const markdown = new Language(defineLanguageFacet(), dialect, [], "markdown");
