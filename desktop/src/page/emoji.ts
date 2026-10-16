/**
 * #222: GitHub's emoji shortcodes, `:tada:`, by name. The names come from the gemoji package, a
 * chunk of their own, which the shell loads before the page draws only when its text holds
 * something shaped like one. Until then every shortcode shows as written.
 */
let names: ReadonlyMap<string, string> | null = null;
let loading: Promise<void> | null = null;

/** Something shaped like a shortcode, as the dialect reads one. */
export const SHORTCODE = /:[a-z0-9_+-]+:/;

/** Loads the names, once. */
export function loadEmoji(): Promise<void> {
  loading ??= import("gemoji").then(({ gemoji }) => {
    names = new Map(gemoji.flatMap(({ emoji, names }) => names.map((name) => [name, emoji])));
  });
  return loading;
}

/** The emoji a shortcode's name stands for, or undefined for a name GitHub does not know. */
export function emojiOf(name: string): string | undefined {
  return names?.get(name);
}
