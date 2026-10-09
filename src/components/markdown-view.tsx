import type { ReactNode } from "react";
import type { Align, Block, Inline } from "@/lib/markdown";

const HEADING_TAGS = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;

const HEADING_CLASSES = [
  "mt-2 mb-4 text-4xl leading-tight font-medium tracking-tight",
  "mt-10 mb-3 text-2xl leading-snug font-medium",
  "mt-8 mb-2 text-xl leading-snug font-medium",
];

const ALIGN_CLASSES: Record<NonNullable<Align>, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

export function MarkdownView({ blocks }: { blocks: Block[] }) {
  return (
    <article>
      <Blocks blocks={blocks} />
    </article>
  );
}

/** A tight list paints its paragraphs as bare lines, as CommonMark does. */
function Blocks({ blocks, tight = false }: { blocks: Block[]; tight?: boolean }) {
  return blocks.map((block, i) => <BlockView key={i} block={block} tight={tight} />);
}

function BlockView({ block, tight }: { block: Block; tight: boolean }): ReactNode {
  switch (block.kind) {
    case "heading": {
      const Tag = HEADING_TAGS[block.level - 1];
      const className = HEADING_CLASSES[Math.min(block.level, HEADING_CLASSES.length) - 1];
      return (
        <Tag id={block.id} className={`scroll-mt-20 ${className}`}>
          <Inlines inlines={block.children} />
        </Tag>
      );
    }
    case "paragraph":
      return tight ? (
        <Inlines inlines={block.children} />
      ) : (
        <p className="my-4 text-lg leading-relaxed">
          <Inlines inlines={block.children} />
        </p>
      );
    case "code":
      return (
        <figure className="my-5 rounded-lg bg-code p-4 font-mono text-sm leading-relaxed">
          {block.info ? <figcaption className="mb-2 text-muted">{block.info}</figcaption> : null}
          <pre className="overflow-x-auto">
            <code>{block.text}</code>
          </pre>
        </figure>
      );
    case "source":
      return (
        <pre className="my-5 overflow-x-auto rounded-lg border border-rule bg-code p-4 font-mono text-sm leading-relaxed">
          {block.text}
        </pre>
      );
    case "quote":
      return (
        <blockquote className="my-5 border-l-2 border-rule pl-4 text-muted">
          <Blocks blocks={block.children} />
        </blockquote>
      );
    case "list": {
      const List = block.ordered ? "ol" : "ul";
      return (
        <List className="my-4 space-y-1 text-lg leading-relaxed">
          {block.items.map((item, i) => (
            <li key={i} className="flex gap-3">
              <span aria-hidden className="shrink-0 text-muted tabular-nums">
                {item.marker}
              </span>
              <div className="min-w-0 flex-1 [&>:first-child]:mt-0 [&>:last-child]:mb-0">
                <Blocks blocks={item.children} tight={block.tight} />
              </div>
            </li>
          ))}
        </List>
      );
    }
    case "table":
      return (
        <div className="my-5 overflow-x-auto">
          <table className="w-full border-collapse text-left text-base">
            {block.head.length > 0 ? (
              <thead>
                <Row cells={block.head} align={block.align} Cell="th" />
              </thead>
            ) : null}
            <tbody>
              {block.rows.map((cells, i) => (
                <Row key={i} cells={cells} align={block.align} Cell="td" />
              ))}
            </tbody>
          </table>
        </div>
      );
    case "rule":
      return <hr className="my-8 border-rule" />;
  }
}

function Row({ cells, align, Cell }: { cells: Inline[][]; align: Align[]; Cell: "th" | "td" }) {
  return (
    <tr>
      {cells.map((cell, i) => {
        const side = align[i];
        return (
          <Cell
            key={i}
            className={`border-b border-rule py-2 pr-4 align-top font-normal ${side ? ALIGN_CLASSES[side] : ""}`}
          >
            <Inlines inlines={cell} />
          </Cell>
        );
      })}
    </tr>
  );
}

function Inlines({ inlines }: { inlines: Inline[] }) {
  return inlines.map((inline, i) => <InlineView key={i} inline={inline} />);
}

function InlineView({ inline }: { inline: Inline }): ReactNode {
  switch (inline.kind) {
    case "text":
      return inline.text;
    case "emphasis":
      return (
        <em>
          <Inlines inlines={inline.children} />
        </em>
      );
    case "strong":
      return (
        <strong className="font-semibold">
          <Inlines inlines={inline.children} />
        </strong>
      );
    case "strikethrough":
      return (
        <s className="text-muted">
          <Inlines inlines={inline.children} />
        </s>
      );
    case "code":
      return (
        <code className="rounded bg-code px-1.5 py-0.5 font-mono text-base">{inline.text}</code>
      );
    case "link":
      // The words, not the address. The address is there on hover.
      return (
        <span
          title={inline.href}
          className="text-oxide underline decoration-rule underline-offset-4"
        >
          <Inlines inlines={inline.children} />
        </span>
      );
    case "image":
      return (
        <span
          title={inline.src}
          className="my-3 block border border-rule bg-code px-3 py-2 text-sm text-muted"
        >
          Image not loaded · {inline.alt || "untitled"}
        </span>
      );
    case "break":
      return <br />;
  }
}
