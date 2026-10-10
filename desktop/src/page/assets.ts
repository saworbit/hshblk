import { Facet } from "@codemirror/state";

/** Turns an image reference into a URL the page may load, or null when it may not. */
export type AssetUrl = (reference: string) => string | null;

export const assetUrl = Facet.define<AssetUrl, AssetUrl>({
  combine: (values) => values[0] ?? (() => null),
});

/**
 * Only a sibling of the document may load: a relative reference, with no scheme and no
 * leading slash. Whether it is inside the document's repository is the shell's to decide.
 */
export function isSibling(reference: string): boolean {
  return reference !== "" && !/^([a-z][a-z0-9+.-]*:|\/|\\)/i.test(reference);
}
