import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { MarkdownView } from "@/components/markdown-view";
import { readMarkdown } from "@/lib/markdown";
import { SAMPLE, SAMPLE_NAME } from "@/lib/sample";
import { applyTheme, currentTheme, nextTheme, SYSTEM, THEMES } from "@/lib/themes";

export const Route = createFileRoute("/")({ component: Home });

const STORE_DOC = "hshblk-doc";
const STORE_NAME = "hshblk-name";

const EXTENSIONS = [".md", ".markdown", ".mdown", ".mkd", ".txt"];
const ACCEPT = [...EXTENSIONS, "text/markdown", "text/plain"].join(",");

const MODES = { light: "Light", dark: "Dark" };

function Home() {
  const [doc, setDoc] = useState(SAMPLE);
  const [name, setName] = useState(SAMPLE_NAME);
  const [source, setSource] = useState(false);
  const [over, setOver] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [theme, setTheme] = useState(SYSTEM);
  // The server renders the sample. Until the saved file is read, it would only flash past.
  const [ready, setReady] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Drag events fire for every child the pointer crosses, so count them.
  const dragDepth = useRef(0);
  const page = useMemo(() => readMarkdown(doc), [doc]);

  useEffect(() => {
    const saved = recall();
    if (saved) {
      setDoc(saved.doc);
      setName(saved.name);
    }
    setTheme(currentTheme());
    setReady(true);
  }, []);

  const chooseTheme = useCallback((id: string) => {
    applyTheme(id);
    setTheme(id);
  }, []);

  // One key each, as long as nothing that takes typing has focus.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || typing(event.target)) return;
      if (event.key === "o") inputRef.current?.click();
      else if (event.key === "s") setSource((value) => !value);
      else if (event.key === "t") chooseTheme(nextTheme(theme));
      else return;
      event.preventDefault();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [theme, chooseTheme]);

  function show(text: string, fileName: string) {
    setDoc(text);
    setName(fileName);
    setSource(false);
    setNotice(null);
  }

  async function take(file: File) {
    if (!acceptable(file)) {
      setNotice(`${file.name} is not a markdown or text file. Nothing changed.`);
      return;
    }
    const text = await file.text();
    show(text, file.name);
    remember(text, file.name);
  }

  function restoreSample() {
    show(SAMPLE, SAMPLE_NAME);
    forget();
  }

  const contents = page.headings.length > 0 && !source;

  return (
    <div
      className={`min-h-screen ${ready ? "" : "invisible"}`}
      onDragEnter={(event) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        dragDepth.current += 1;
        setOver(true);
      }}
      onDragOver={(event) => {
        if (carriesFiles(event)) event.preventDefault();
      }}
      onDragLeave={(event) => {
        if (!carriesFiles(event)) return;
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setOver(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        dragDepth.current = 0;
        setOver(false);
        const file = event.dataTransfer.files[0];
        if (file) void take(file);
      }}
    >
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-rule bg-paper px-4 py-3 font-mono text-sm sm:px-6">
        <span className="text-accent">#</span>
        <span className="tracking-wide">hshblk</span>
        <span className="min-w-0 truncate text-muted">{name}</span>
        <span className="hidden shrink-0 text-muted sm:inline">
          {page.words === 1 ? "1 word" : `${page.words} words`}
        </span>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            aria-keyshortcuts="s"
            className="h-11 rounded-pill border border-rule px-4 transition-colors hover:border-accent hover:text-accent"
            onClick={() => setSource((value) => !value)}
          >
            {source ? "Page" : "Source"}
          </button>
          <button
            type="button"
            aria-keyshortcuts="o"
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
        accept={ACCEPT}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void take(file);
          event.target.value = "";
        }}
      />

      {contents ? (
        <nav className="flex gap-5 overflow-x-auto border-b border-rule px-4 py-2 font-mono text-sm md:hidden">
          {page.headings.map((heading) => (
            <a key={heading.id} href={`#${heading.id}`} className="shrink-0 py-2 text-muted">
              {heading.text}
            </a>
          ))}
        </nav>
      ) : null}

      <div className="mx-auto grid max-w-5xl md:grid-cols-[14rem_1fr]">
        <aside className="hidden px-6 pt-10 md:block">
          {contents ? (
            <>
              <p className="font-mono text-sm text-muted">On this page</p>
              <nav className="mt-3 flex flex-col gap-2">
                {page.headings.map((heading) => (
                  <a
                    key={heading.id}
                    href={`#${heading.id}`}
                    className={`text-sm leading-snug text-ink ${heading.level > 2 ? "pl-6" : heading.level > 1 ? "pl-3" : ""}`}
                  >
                    {heading.text}
                  </a>
                ))}
              </nav>
            </>
          ) : null}
        </aside>

        <main className="min-w-0 px-5 pt-8 pb-24 sm:px-8">
          {notice ? (
            <p role="status" className="mb-6 font-mono text-sm text-accent">
              {notice}
            </p>
          ) : null}
          {source ? (
            <pre className="overflow-x-auto font-mono text-sm leading-relaxed whitespace-pre-wrap">
              {doc}
            </pre>
          ) : (
            <MarkdownView blocks={page.blocks} />
          )}
          <footer className="mt-12 flex flex-wrap items-center gap-x-6 gap-y-3 font-mono text-sm text-muted">
            <p>Read only. This page does not change the file.</p>
            <label className="flex items-center gap-2">
              Theme
              <select
                value={theme}
                aria-keyshortcuts="t"
                className="h-11 rounded-pill border border-rule bg-paper px-3 text-ink"
                onChange={(event) => chooseTheme(event.target.value)}
              >
                <option value={SYSTEM}>System</option>
                {Object.entries(MODES).map(([mode, label]) => (
                  <optgroup key={mode} label={label}>
                    {THEMES.filter((choice) => choice.mode === mode).map((choice) => (
                      <option key={choice.id} value={choice.id}>
                        {choice.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            {doc === SAMPLE ? null : (
              <button
                type="button"
                className="py-2 underline decoration-rule underline-offset-4"
                onClick={restoreSample}
              >
                Restore sample
              </button>
            )}
            <p className="hidden md:block">
              <Key>o</Key> open · <Key>s</Key> source · <Key>t</Key> theme
            </p>
          </footer>
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

function Key({ children }: { children: string }) {
  return <kbd className="rounded border border-rule px-1.5 text-ink">{children}</kbd>;
}

/** Keys belong to whatever takes typing, when it has focus. */
function typing(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName))
  );
}

function acceptable(file: File): boolean {
  const name = file.name.toLowerCase();
  return file.type.startsWith("text/") || EXTENSIONS.some((extension) => name.endsWith(extension));
}

function carriesFiles(event: DragEvent): boolean {
  return event.dataTransfer.types.includes("Files");
}

function recall(): { doc: string; name: string } | null {
  try {
    const doc = localStorage.getItem(STORE_DOC);
    if (doc === null) return null;
    return { doc, name: localStorage.getItem(STORE_NAME) || "untitled.md" };
  } catch {
    return null; // storage is unavailable, as in some private windows
  }
}

function remember(doc: string, name: string) {
  try {
    localStorage.setItem(STORE_DOC, doc);
    localStorage.setItem(STORE_NAME, name);
  } catch {
    // Too large to keep. Forget the older file as well, or a reload would bring it back.
    forget();
  }
}

function forget() {
  try {
    localStorage.removeItem(STORE_DOC);
    localStorage.removeItem(STORE_NAME);
  } catch {
    /* storage is unavailable */
  }
}
