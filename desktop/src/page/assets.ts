import { Facet } from "@codemirror/state";

/** Turns an image's file, relative to the document, into a URL the page may load, or null. */
export type AssetUrl = (file: string) => string | null;

export const assetUrl = Facet.define<AssetUrl, AssetUrl>({
  combine: (values) => values[0] ?? (() => null),
});

/**
 * The file an image's destination names. A destination is a URL, so `screen%20shot.png` names
 * `screen shot.png`. Its query and fragment are no part of the file.
 */
export function filePath(destination: string): string {
  const path = destination.split(/[?#]/)[0];
  try {
    return decodeURIComponent(path);
  } catch {
    // A `%` that escapes nothing is part of the name.
    return path;
  }
}

/**
 * Only a sibling of the document may load: a relative reference, with no scheme and no
 * leading slash. Whether it is inside the document's repository is the shell's to decide.
 */
export function isSibling(reference: string): boolean {
  return reference !== "" && !/^([a-z][a-z0-9+.-]*:|\/|\\)/i.test(reference);
}
