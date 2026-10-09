import { parser as baseParser, GFM, Strikethrough, TaskList } from "@lezer/markdown";
import type { SyntaxNode } from "@lezer/common";
import type { ReactNode } from "react";

const parser = baseParser.configure([GFM, Strikethrough, TaskList]);

export type Heading = { id: string; level: number; text: string };

const HIDDEN = new Set([
  "HeaderMark",
  "EmphasisMark",
  "CodeMark",
  "LinkMark",
  "QuoteMark",
  "StrikethroughMark",
  "TableDelimiter",
]);

export function headingsOf(doc: string): Heading[] {
  const tree = parser.parse(doc);
  const found: Heading[] = [];
  tree.iterate({
    enter(node) {
      const match = /^ATXHeading([1-6])$/.exec(node.name);
      if (!match) return;
      found.push({
        id: `h-${node.from}`,
        level: Number(match[1]),
        text: visibleText(doc, node.node),
      });
    },
  });
  return found;
}

export function renderMarkdown(doc: string): ReactNode {
  const tree = parser.parse(doc);
  return pieces(doc, tree.topNode);
}

function pieces(doc: string, node: SyntaxNode, tight = false): ReactNode[] {
  const out: ReactNode[] = [];
  let pos = node.from;
  let child: SyntaxNode | null = node.firstChild;
  while (child) {
    const current: SyntaxNode = child;
    if (current.from > pos) out.push(doc.slice(pos, current.from));
    const rendered = renderNode(doc, current, `${current.name}-${current.from}`, tight);
    if (rendered !== null && rendered !== undefined) out.push(rendered);
    pos = current.to;
    child = current.nextSibling;
  }
  if (pos < node.to) out.push(doc.slice(pos, node.to));
  return out;
}

function childNamed(node: SyntaxNode, name: string): SyntaxNode | null {
  let child: SyntaxNode | null = node.firstChild;
  while (child) {
    const current: SyntaxNode = child;
    if (current.name === name) return current;
    child = current.nextSibling;
  }
  return null;
}

function visibleText(doc: string, node: SyntaxNode): string {
  if (HIDDEN.has(node.name) || node.name === "URL") return "";
  if (!node.firstChild) return doc.slice(node.from, node.to);
  let text = "";
  let pos = node.from;
  let child: SyntaxNode | null = node.firstChild;
  while (child) {
    const current: SyntaxNode = child;
    if (current.from > pos) text += doc.slice(pos, current.from);
    text += visibleText(doc, current);
    pos = current.to;
    child = current.nextSibling;
  }
  if (pos < node.to) text += doc.slice(pos, node.to);
  return text.replace(/\s+/g, " ").trim();
}

function renderNode(doc: string, node: SyntaxNode, key: string, tight = false): ReactNode {
  if (HIDDEN.has(node.name)) return null;

  switch (node.name) {
    case "ATXHeading1":
    case "ATXHeading2":
    case "ATXHeading3":
    case "ATXHeading4":
    case "ATXHeading5":
    case "ATXHeading6": {
      const level = Number(node.name.slice(-1));
      const Tag = `h${level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
      return (
        <Tag key={key} id={`h-${node.from}`} className={headingClass(level)}>
          {pieces(doc, node)}
        </Tag>
      );
    }
    case "Paragraph":
      if (tight) {
        return <span key={key}>{pieces(doc, node)}</span>;
      }
      return (
        <p key={key} className="my-4 text-lg leading-relaxed">
          {pieces(doc, node)}
        </p>
      );
    case "Emphasis":
      return <em key={key}>{pieces(doc, node)}</em>;
    case "StrongEmphasis":
      return (
        <strong key={key} className="font-semibold">
          {pieces(doc, node)}
        </strong>
      );
    case "Strikethrough":
      return (
        <s key={key} className="text-muted">
          {pieces(doc, node)}
        </s>
      );
    case "InlineCode":
      return (
        <code key={key} className="rounded bg-code px-1.5 py-0.5 font-mono text-base">
          {pieces(doc, node)}
        </code>
      );
    case "FencedCode": {
      const info = childNamed(node, "CodeInfo");
      const text = childNamed(node, "CodeText");
      return (
        <pre key={key} className="my-5 overflow-x-auto rounded-lg bg-code p-4 font-mono text-sm leading-relaxed">
          {info ? <div className="mb-2 text-muted">{doc.slice(info.from, info.to)}</div> : null}
          <code>{text ? doc.slice(text.from, text.to).replace(/\n$/, "") : ""}</code>
        </pre>
      );
    }
    case "Blockquote":
      return (
        <blockquote key={key} className="my-5 border-l-2 border-rule pl-4 text-muted">
          {pieces(doc, node)}
        </blockquote>
      );
    case "BulletList":
    case "OrderedList":
      return (
        <ul key={key} className="my-4 space-y-1 pl-1 text-lg leading-relaxed">
          {pieces(doc, node)}
        </ul>
      );
    case "ListItem":
      return (
        <li key={key} className="my-1">
          {pieces(doc, node, true)}
        </li>
      );
    case "Task":
      return (
        <span key={key} className="inline">
          {pieces(doc, node)}
        </span>
      );
    case "TaskMarker": {
      const done = doc.slice(node.from, node.to).includes("x") || doc.slice(node.from, node.to).includes("X");
      return (
        <span key={key} className="mr-2 inline-block font-mono text-sm text-oxide">
          {done ? "[x]" : "[ ]"}
        </span>
      );
    }
    case "Link":
      return (
        <span key={key} className="text-oxide underline decoration-rule underline-offset-4">
          {pieces(doc, node)}
        </span>
      );
    case "URL":
      return null;
    case "Image":
      return (
        <span key={key} className="my-3 block border border-rule bg-code px-3 py-2 text-sm text-muted">
          Image not loaded · {visibleText(doc, node) || "untitled"}
        </span>
      );
    case "HTMLBlock":
      return (
        <pre key={key} className="my-5 overflow-x-auto rounded-lg border border-rule bg-code p-4 font-mono text-sm leading-relaxed">
          {doc.slice(node.from, node.to)}
        </pre>
      );
    case "HorizontalRule":
      return <hr key={key} className="my-8 border-rule" />;
    case "Table": {
      const rows = tableParts(doc, node);
      return (
        <div key={key} className="my-5 overflow-x-auto">
          <table className="w-full border-collapse text-left text-base">
            {rows.head ? <thead>{rows.head}</thead> : null}
            <tbody>{rows.body}</tbody>
          </table>
        </div>
      );
    }
    case "CodeText":
    case "CodeInfo":
    case "TableHeader":
    case "TableRow":
    case "TableCell":
      return null;
    default:
      return <span key={key}>{pieces(doc, node)}</span>;
  }
}

function tableParts(doc: string, table: SyntaxNode): { head: ReactNode | null; body: ReactNode[] } {
  let head: ReactNode | null = null;
  const body: ReactNode[] = [];
  let child = table.firstChild;
  let i = 0;
  while (child) {
    if (child.name === "TableHeader" || child.name === "TableRow") {
      const cells: ReactNode[] = [];
      let cell = child.firstChild;
      let c = 0;
      while (cell) {
        if (cell.name === "TableCell") {
          const Tag = child.name === "TableHeader" ? "th" : "td";
          cells.push(
            <Tag key={c} className="border-b border-rule py-2 pr-4 align-top font-normal">
              {doc.slice(cell.from, cell.to)}
            </Tag>,
          );
        }
        cell = cell.nextSibling;
        c += 1;
      }
      const row = <tr key={i}>{cells}</tr>;
      if (child.name === "TableHeader") head = row;
      else body.push(row);
    }
    child = child.nextSibling;
    i += 1;
  }
  return { head, body };
}

function headingClass(level: number): string {
  if (level === 1) return "mt-2 mb-4 text-4xl leading-tight font-medium tracking-tight";
  if (level === 2) return "mt-10 mb-3 text-2xl leading-snug font-medium";
  return "mt-8 mb-2 text-xl leading-snug font-medium";
}
