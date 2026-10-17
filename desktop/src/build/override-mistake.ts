import type { Plugin } from "vite";

/**
 * #221: Tauri freezes `Object.prototype` in the page, and on Windows WebView2 runs Tauri's script in
 * every frame, so the frame mermaid draws in has it frozen too. dayjs and d3, which mermaid takes,
 * assign `valueOf`, `toString`, and `constructor` as plain properties, which strict code may not do
 * once the prototype's are read only: the "override mistake". So in the frame's bundle alone, an
 * assignment of such a name, or of a name computed as it runs, goes through `__hbSet`, which
 * defines the property where an assignment would be refused, and assigns it everywhere else.
 */

/** The names a frozen `Object.prototype` holds as read only, but for `__proto__`. */
const PROTOTYPE_NAMES = new Set(
  Object.getOwnPropertyNames(Object.prototype).filter((name) => name !== "__proto__"),
);

/**
 * Sets a property as an assignment does, but defines it when it would shadow one a frozen
 * `Object.prototype` holds. Its arguments evaluate in an assignment's order, and it gives back the
 * value, as an assignment does.
 */
export const SET = `function __hbSet(o, k, v) {
  if ((typeof o === "object" && o !== null) || typeof o === "function") {
    var n = typeof k === "symbol" ? k : String(k);
    if (n !== "__proto__" && n in Object.prototype && !Object.prototype.hasOwnProperty.call(o, n)) {
      Object.defineProperty(o, n, { value: v, writable: true, enumerable: true, configurable: true });
      return v;
    }
  }
  o[k] = v;
  return v;
}
`;

/** An ESTree node, as Vite's parser gives one. */
type Node = { type: string; start: number; end: number; [key: string]: unknown };

/** An assignment to rewrite: its span, and its object, key, and value. */
type Edit = { start: number; end: number; object: Node; key: Node | string; value: Node };

/** Each node of an ESTree, depth first. */
function walk(node: unknown, visit: (node: Node) => void): void {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
  } else if (node && typeof node === "object" && typeof (node as Node).type === "string") {
    visit(node as Node);
    for (const value of Object.values(node))
      if (value && typeof value === "object") walk(value, visit);
  }
}

/**
 * The code with each assignment the frozen prototype could refuse going through `__hbSet`, or null
 * when it has none. `ast` is the code's ESTree.
 */
export function rewrite(code: string, ast: unknown): string | null {
  const edits: Edit[] = [];
  walk(ast, (node) => {
    if (node.type !== "AssignmentExpression" || node.operator !== "=") return;
    const left = node.left as Node;
    if (left.type !== "MemberExpression") return;
    const object = left.object as Node;
    const property = left.property as Node & { name?: string };
    if (object.type === "Super" || property.type === "PrivateIdentifier") return;
    if (!left.computed && !PROTOTYPE_NAMES.has(property.name ?? "")) return;
    const key = left.computed ? property : JSON.stringify(property.name);
    edits.push({ start: node.start, end: node.end, object, key, value: node.right as Node });
  });
  if (edits.length === 0) return null;
  edits.sort((a, b) => a.start - b.start || b.end - a.end);
  // An assignment inside another's object, key, or value is rewritten inside its rewrite.
  const render = (from: number, to: number): string => {
    let out = "";
    let at = from;
    for (const edit of edits) {
      if (edit.start < at || edit.end > to) continue;
      const part = (node: Node | string) =>
        typeof node === "string" ? node : render(node.start, node.end);
      out += code.slice(at, edit.start);
      out += `__hbSet(${part(edit.object)}, ${part(edit.key)}, ${part(edit.value)})`;
      at = edit.end;
    }
    return out + code.slice(at, to);
  };
  return SET + render(0, code.length);
}

/** The rewrite, for the dependencies in the frame's bundle. */
export function overrideMistake(): Plugin {
  return {
    name: "hshblk-override-mistake",
    transform(code, id) {
      if (!id.includes("node_modules") || !code.includes("=")) return null;
      const rewritten = rewrite(code, this.parse(code));
      return rewritten === null ? null : { code: rewritten, map: null };
    },
  };
}
