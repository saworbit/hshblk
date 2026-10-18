import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { clear, plan } from "./release-drafts.mjs";

/** A release as `gh api` lists it, with only the fields the script reads. */
function release(id, tag, { draft = true, prerelease = false, assets = [] } = {}) {
  const page = draft ? `untagged-${id}` : `tag/${tag}`;
  const html_url = `https://github.com/saworbit/hshblk/releases/${page}`;
  return { id, tag_name: tag, draft, prerelease, html_url, assets };
}

/** A gh that lists these releases, one JSON object a line as `--jq` prints them, and records each call. */
function fakeGh(releases) {
  const calls = [];
  const gh = (args) => {
    calls.push(args);
    if (args.includes("--paginate")) return releases.map((r) => `${JSON.stringify(r)}\n`).join("");
    return "";
  };
  const deletes = () => calls.filter((args) => args.includes("DELETE")).map((args) => args.at(-1));
  return { gh, calls, deletes };
}

const quiet = () => {};

describe("clearing a tag's drafts", () => {
  it("deletes every draft of the tag, and nothing else", () => {
    // #367: a draft of the five installers #360 replaced would have kept them beside the zips.
    const installers = ["hash-block_0.2.0_amd64.deb", "Hash Block_0.2.0_x64-setup.exe"];
    const { gh, deletes } = fakeGh([
      release(1, "v0.2.0", { assets: installers }),
      // GitHub lets drafts share a tag, and finds only one of them by it.
      release(2, "v0.2.0"),
      release(3, "v0.2.0-rc.1"),
      release(4, "v0.3.0"),
      release(5, "v0.1.0", { draft: false }),
    ]);
    const deleted = clear("v0.2.0", gh, quiet);
    assert.deepEqual(
      deleted.map((draft) => draft.id),
      [1, 2],
    );
    assert.deepEqual(deletes(), [
      "repos/{owner}/{repo}/releases/1",
      "repos/{owner}/{repo}/releases/2",
    ]);
  });

  it("changes nothing when the tag's release is published, and says why", () => {
    const { gh, calls, deletes } = fakeGh([
      release(4, "v0.1.0", { draft: false }),
      release(6, "v0.1.0"),
    ]);
    assert.throws(
      () => clear("v0.1.0", gh, quiet),
      /v0\.1\.0 is published, at https:\/\/github\.com\/saworbit\/hshblk\/releases\/tag\/v0\.1\.0/,
    );
    assert.deepEqual(deletes(), []);
    assert.equal(calls.length, 1, "only the listing ran");
  });

  it("takes a prerelease as published", () => {
    const { gh, deletes } = fakeGh([release(7, "v0.2.0-rc.1", { draft: false, prerelease: true })]);
    assert.throws(() => clear("v0.2.0-rc.1", gh, quiet), /is published/);
    assert.deepEqual(deletes(), []);
  });

  it("deletes nothing when the tag has no release yet", () => {
    const { gh, deletes } = fakeGh([release(5, "v0.1.0", { draft: false })]);
    assert.deepEqual(clear("v0.2.0", gh, quiet), []);
    assert.deepEqual(deletes(), []);
  });

  it("stops before deleting anything when the listing cannot be read", () => {
    const calls = [];
    const gh = (args) => {
      calls.push(args);
      return `${JSON.stringify(release(1, "v0.2.0"))}\n<html>rate limited</html>\n`;
    };
    assert.throws(() => clear("v0.2.0", gh, quiet), /could not read/);
    assert.equal(calls.length, 1, "nothing was deleted");
  });

  it("says what it deleted", () => {
    const { gh } = fakeGh([release(1, "v0.2.0", { assets: ["a.zip", "b.zip"] })]);
    const said = [];
    clear("v0.2.0", gh, (line) => said.push(line));
    assert.deepEqual(said, ["Deleted a draft of v0.2.0, which held a.zip, b.zip."]);
  });
});

describe("the plan", () => {
  it("matches the tag exactly", () => {
    const { published, drafts } = plan([release(1, "v0.2"), release(2, "v0.2.0")], "v0.2");
    assert.equal(published, undefined);
    assert.deepEqual(
      drafts.map((draft) => draft.id),
      [1],
    );
  });
});

describe("the command", () => {
  it("names what it needs, and calls gh for nothing, without a tag", () => {
    const script = fileURLToPath(new URL("./release-drafts.mjs", import.meta.url));
    // An empty PATH, so a gh it ran by mistake could not be found and answer.
    const run = spawnSync(process.execPath, [script], {
      encoding: "utf8",
      env: { PATH: "" },
    });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /^Give the release's tag, such as v0\.2\.0\./);
  });
});
