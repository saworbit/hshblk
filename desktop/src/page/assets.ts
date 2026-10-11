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
 * Only a file in the document's repository may load: a reference relative to the document, or,
 * with one leading slash, to the repository's root, as GitHub reads it. No scheme, no `//`, which
 * names a host, and no backslash. Whether it is inside the repository is the shell's to decide.
 */
export function isLocal(reference: string): boolean {
  return reference !== "" && !/^([a-z][a-z0-9+.-]*:|\/\/|\\)/i.test(reference);
}
