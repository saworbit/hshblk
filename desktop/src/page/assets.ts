import { type EditorState, Facet } from "@codemirror/state";

/** Turns an image's file, relative to the document, into a URL the page may load, or null. */
export type AssetUrl = (file: string) => string | null;

export const assetUrl = Facet.define<AssetUrl, AssetUrl>({
  combine: (values) => values[0] ?? (() => null),
});

/** Asks the shell why the resource channel refused a file, in a chip's words, or null. */
export type ImageRefusal = (file: string) => Promise<string | null>;

export const imageRefusal = Facet.define<ImageRefusal, ImageRefusal | null>({
  combine: (values) => values[0] ?? null,
});

/**
 * Why an image the channel would not serve does not show, as its chip says it (#231). A load
 * that fails tells the page nothing, so the shell asks Rust, which checks it again. "Image not
 * shown" when it cannot say, as when the bytes passed the channel but would not decode.
 */
export async function refusalOf(state: EditorState, reference: string): Promise<string> {
  // An embedded image passed the page's own check, so its bytes would not decode.
  if (embedded(reference)) return "Image not shown";
  const ask = state.facet(imageRefusal);
  const why = ask ? await ask(filePath(reference)).catch(() => null) : null;
  return why ?? "Image not shown";
}

/**
 * What the chip says of an image with nothing to load: a remote one, an embedded one, or one the
 * page did not ask for, such as a srcset alone or an address of the channel's own.
 */
export function unloaded(reference: string): string {
  if (/^(https?:)?\/\//i.test(reference.trim())) return "Remote images do not load";
  if (embedded(reference)) return embeddedRefusal(reference) ?? "Image not loaded";
  return "Image not loaded";
}

/** Whether a reference is an image embedded in the document, as a `data:` address. */
function embedded(reference: string): boolean {
  return /^data:/i.test(reference.trim());
}

/** The types an embedded image may be: those the resource channel serves, by their names. */
const EMBEDDED =
  /^data:image\/(?:png|jpeg|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon|svg\+xml)(?:;[^,]*)?,/i;

/** As much as the resource channel serves of one image. */
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/**
 * #205: why an embedded image, `data:image/png;base64,...`, cannot show, or null when it can. Its
 * bytes are in the document, so it fetches nothing, and to the decoder it is an image beside the
 * document. So it is held to what the channel serves: its types, and 20 MB.
 */
export function embeddedRefusal(reference: string): string | null {
  const address = reference.trim();
  const head = EMBEDDED.exec(address);
  if (!head) return "Not an image this app shows";
  const written = address.length - head[0].length;
  const bytes = /;base64,$/i.test(head[0]) ? Math.floor((written * 3) / 4) : written;
  return bytes > MAX_IMAGE_BYTES ? "Larger than 20 MB" : null;
}

/**
 * The URL an image's reference loads from, through the resource channel, or null when it names no
 * file in the repository. One rule for a markdown image, an `<img>`, and a picture's source (#256).
 * An image embedded in the document is its own address, when the page shows it (#205).
 */
export function imageUrl(state: EditorState, reference: string): string | null {
  if (embedded(reference)) return embeddedRefusal(reference) ? null : reference.trim();
  const file = filePath(reference);
  return isLocal(file) ? state.facet(assetUrl)(file) : null;
}

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
