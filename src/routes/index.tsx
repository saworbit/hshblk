import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { headingsOf, renderMarkdown } from "@/lib/markdown";
import { SAMPLE, SAMPLE_NAME } from "@/lib/sample";

export const Route = createFileRoute("/")({ component: Home });

const STORE_DOC = "hshblk-doc";
const STORE_NAME = "hshblk-name";

function Home() {
  const [doc, setDoc] = useState(SAMPLE);
  const [name, setName] = useState(SAMPLE_NAME);
  const [source, setSource] = useState(false);
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const headings = useMemo(() => headingsOf(doc), [doc]);
  const words = useMemo(() => doc.trim().split(/\s+/).filter(Boolean).length, [doc]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORE_DOC);
      const savedName = localStorage.getItem(STORE_NAME);
      if (saved) {
        setDoc(saved);
        setName(savedName || "untitled.md");
      }
    } catch {
      /* private mode */
    }
  }, []);

  function adopt(text: string, fileName: string) {
    setDoc(text);
    setName(fileName);
    setSource(false);
    try {
      localStorage.setItem(STORE_DOC, text);
      localStorage.setItem(STORE_NAME, fileName);
    } catch {
      /* ignore */
    }
  }

  async function take(file: File) {
    adopt(await file.text(), file.name);
  }

  return (
    <div
      className="min-h-screen"
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        const file = event.dataTransfer.files?.[0];
        if (file) void take(file);
      }}
    >
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-rule bg-paper px-4 py-3 font-mono text-sm sm:px-6">
        <span className="text-oxide">#</span>
        <span className="tracking-wide">hshblk</span>
        <span className="min-w-0 truncate text-muted">{name}</span>
        <span className="hidden text-muted sm:inline">{words} words</span>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            className="h-11 rounded-pill border border-rule px-4 transition-colors hover:border-oxide hover:text-oxide"
            onClick={() => setSource((value) => !value)}
          >
            {source ? "Page" : "Source"}
          </button>
          <button
            type="button"
            className="h-11 rounded-pill border border-ink bg-ink px-4 text-paper transition-opacity hover:opacity-90"
            onClick={() => inputRef.current?.click()}
          >
            Open
          </button>
        </div>
      </header>

      <input
        ref={inputRef}
        type="file"
        accept=".md,.markdown,.txt,text/markdown,text/plain"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void take(file);
          event.target.value = "";
        }}
      />

      {headings.length > 0 && !source ? (
        <nav className="flex gap-2 overflow-x-auto border-b border-rule px-4 py-2 font-mono text-sm md:hidden">
          {headings.map((heading) => (
            <a key={heading.id} href={`#${heading.id}`} className="shrink-0 py-2 text-muted">
              {heading.text}
            </a>
          ))}
        </nav>
      ) : null}

      <div className="mx-auto grid max-w-5xl md:grid-cols-[14rem_1fr]">
        <aside className="hidden px-6 pt-10 md:block">
          <p className="font-mono text-sm text-muted">On this page</p>
          <nav className="mt-3 flex flex-col gap-2">
            {headings.map((heading) => (
              <a
                key={heading.id}
                href={`#${heading.id}`}
                className={`text-sm leading-snug text-ink ${heading.level > 2 ? "pl-6" : heading.level > 1 ? "pl-3" : ""}`}
              >
                {heading.text}
              </a>
            ))}
          </nav>
          <button
            type="button"
            className="mt-8 font-mono text-sm text-muted underline decoration-rule underline-offset-4"
            onClick={() => adopt(SAMPLE, SAMPLE_NAME)}
          >
            Restore sample
          </button>
        </aside>

        <main className="px-5 pt-8 pb-24 sm:px-8">
          {source ? (
            <pre className="overflow-x-auto font-mono text-sm leading-relaxed whitespace-pre-wrap">{doc}</pre>
          ) : (
            <article>{renderMarkdown(doc)}</article>
          )}
          <p className="mt-12 font-mono text-sm text-muted">Read only. This page does not change the file.</p>
        </main>
      </div>

      {over ? (
        <div className="pointer-events-none fixed inset-0 grid place-items-center bg-paper/90 font-mono text-lg">
          Drop a markdown file
        </div>
      ) : null}
    </div>
  );
}
