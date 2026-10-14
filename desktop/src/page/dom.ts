/**
 * An element of `owner`, the page's document unless a frame's is named, with a class, and its
 * text or the nodes it holds. One way to build one, for the shell, the panel, and the widgets.
 */
export function element(
  tag: string,
  className = "",
  content: string | Node[] = "",
  owner: Document = document,
): HTMLElement {
  const el = owner.createElement(tag);
  if (className) el.className = className;
  if (typeof content === "string") {
    if (content) el.textContent = content;
  } else {
    el.append(...content);
  }
  return el;
}
