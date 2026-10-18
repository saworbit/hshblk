/**
 * Clears the way for a tag's draft release, so the release job makes it again with only its own
 * zips and notes (#367). If the tag's release is published, a prerelease included, it says so and
 * exits non-zero, having changed nothing: what readers download changes by hand, if at all.
 * Otherwise it deletes each draft of the tag. Deleting a release leaves its tag alone.
 *
 *   node scripts/release-drafts.mjs v0.2.0
 *
 * gh finds the repository from GH_REPO, as on CI, or from the checkout's remote. GitHub's lookup
 * by tag skips drafts, and drafts can share a tag, so this reads every release.
 */
import { execFileSync } from "node:child_process";

const LIST = [
  "api",
  "--paginate",
  "repos/{owner}/{repo}/releases?per_page=100",
  "--jq",
  ".[] | {id, tag_name, draft, html_url, assets: [.assets[].name]}",
];

/** The tag's published release, which stops the run, or else its drafts, to delete. */
export function plan(releases, tag) {
  const tagged = releases.filter((release) => release.tag_name === tag);
  const published = tagged.find((release) => !release.draft);
  return { published, drafts: published ? [] : tagged.filter((release) => release.draft) };
}

/** Runs gh with these arguments, and returns what it printed. Its errors show as it prints them. */
function run(args) {
  return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

/**
 * Deletes the tag's drafts, and returns them. Throws, having deleted nothing, when the tag's
 * release is published or the listing cannot be read.
 */
export function clear(tag, gh = run, say = console.log) {
  const releases = gh(LIST)
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        throw new Error(`gh listed a line this could not read as a release: ${line}`);
      }
    });
  const { published, drafts } = plan(releases, tag);
  if (published) {
    throw new Error(
      `${tag} is published, at ${published.html_url}. This run changes nothing: ` +
        "a published release's zips change by hand, if at all.",
    );
  }
  for (const draft of drafts) {
    gh(["api", "--method", "DELETE", `repos/{owner}/{repo}/releases/${draft.id}`]);
    const held = draft.assets.length > 0 ? draft.assets.join(", ") : "no files";
    say(`Deleted a draft of ${tag}, which held ${held}.`);
  }
  if (drafts.length === 0) say(`${tag} has no draft to delete.`);
  return drafts;
}

if (import.meta.main) {
  const tag = process.argv[2];
  if (!tag) {
    console.error(
      "Give the release's tag, such as v0.2.0.\n\n  node scripts/release-drafts.mjs v0.2.0",
    );
    process.exit(1);
  }
  try {
    clear(tag);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
