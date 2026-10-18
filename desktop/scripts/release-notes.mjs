/**
 * Prints the notes a draft release starts with: which zip is for which system, each linked where
 * the release keeps it. GitHub's list of merged pull requests goes under them. Prints nothing and
 * exits non-zero on a zip that names no system, or another version, and on a system with no zip
 * or two, so a change to the zips stops the release job before a draft says the wrong thing (#372).
 *
 *   GH_REPO=saworbit/hshblk node scripts/release-notes.mjs v0.2.0 packages/*.zip
 */
import { basename } from "node:path";

/** Each system a release has a zip for, as the zip's name ends, in the order the table lists. */
const SYSTEMS = [
  ["linux-x64", "Linux, x64"],
  ["macos-arm64", "macOS 11 or later, Apple silicon"],
  ["windows-x64", "Windows 10 or 11, x64"],
];

/** The notes for the tag's release in the repository, given its zips' paths. Throws on a wrong set. */
export function notes(tag, repo, zips) {
  const version = tag.replace(/^v/, "");
  const zipFor = (system) => `hash-block-${version}-${system}.zip`;
  const names = zips.map((zip) => basename(zip));
  if (names.length === 0) throw new Error("No zips were built.");

  const wrong = [];
  for (const [index, name] of names.entries()) {
    if (names.indexOf(name) !== index) {
      wrong.push(`${name} is given twice.`);
    } else if (!SYSTEMS.some(([system]) => name === zipFor(system))) {
      const versioned = SYSTEMS.some(
        ([system]) => name.startsWith("hash-block-") && name.endsWith(`-${system}.zip`),
      );
      wrong.push(
        versioned
          ? `${name} is not version ${version}, which the tag names.`
          : `${name} names no system the release has: ${SYSTEMS.map(([system]) => system).join(", ")}.`,
      );
    }
  }
  for (const [system, label] of SYSTEMS) {
    if (!names.includes(zipFor(system))) wrong.push(`No zip for ${label}: ${zipFor(system)}.`);
  }
  if (wrong.length > 0) throw new Error(wrong.join("\n"));

  const url = `https://github.com/${repo}/releases/download/${tag}`;
  return [
    "Download the zip for your system. Each has the app and a README that says how to install it.",
    "",
    "| System | Download |",
    "|---|---|",
    ...SYSTEMS.map(
      ([system, label]) => `| ${label} | [${zipFor(system)}](${url}/${zipFor(system)}) |`,
    ),
    "",
    "The two **Source code** files GitHub adds at the end are a copy of the repository. The app is not in them.",
  ].join("\n");
}

if (import.meta.main) {
  const [tag, ...zips] = process.argv.slice(2);
  const repo = process.env.GH_REPO;
  if (!tag || !repo) {
    console.error(
      "Give the tag, then the zips, with the repository in GH_REPO.\n\n" +
        "  GH_REPO=saworbit/hshblk node scripts/release-notes.mjs v0.2.0 packages/*.zip",
    );
    process.exit(1);
  }
  try {
    console.log(notes(tag, repo, zips));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
