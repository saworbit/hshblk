import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { notes } from "./release-notes.mjs";

const repo = "saworbit/hshblk";
const zips = (version) =>
  ["linux-x64", "macos-arm64", "windows-x64"].map(
    (system) => `hash-block-${version}-${system}.zip`,
  );

describe("a release's notes", () => {
  it("are 0.1.0's, for 0.1.0's zips", () => {
    // What the release job's bash wrote at the top of 0.1.0's notes, which #372 moved here.
    const url = "https://github.com/saworbit/hshblk/releases/download/v0.1.0";
    assert.equal(
      notes("v0.1.0", repo, zips("0.1.0")),
      [
        "Download the zip for your system. Each has the app and a README that says how to install it.",
        "",
        "| System | Download |",
        "|---|---|",
        `| Linux, x64 | [hash-block-0.1.0-linux-x64.zip](${url}/hash-block-0.1.0-linux-x64.zip) |`,
        `| macOS 11 or later, Apple silicon | [hash-block-0.1.0-macos-arm64.zip](${url}/hash-block-0.1.0-macos-arm64.zip) |`,
        `| Windows 10 or 11, x64 | [hash-block-0.1.0-windows-x64.zip](${url}/hash-block-0.1.0-windows-x64.zip) |`,
        "",
        "The two **Source code** files GitHub adds at the end are a copy of the repository. The app is not in them.",
      ].join("\n"),
    );
  });

  it("list the systems in one order, whatever order the zips come in", () => {
    const paths = zips("0.2.0")
      .reverse()
      .map((zip) => `packages/${zip}`);
    assert.equal(notes("v0.2.0", repo, paths), notes("v0.2.0", repo, zips("0.2.0")));
  });

  it("stop on a zip that names no system", () => {
    const arm = "hash-block-0.2.0-linux-arm64.zip";
    assert.throws(
      () => notes("v0.2.0", repo, [...zips("0.2.0"), arm]),
      (error) => error.message.includes(arm) && /names no system/.test(error.message),
    );
  });

  it("stop on a zip of another version", () => {
    const old = "hash-block-0.1.0-linux-x64.zip";
    assert.throws(
      () => notes("v0.2.0", repo, [old, ...zips("0.2.0").slice(1)]),
      (error) => error.message.includes(old) && /No zip for Linux, x64/.test(error.message),
    );
  });

  it("stop on a system with no zip, or with two", () => {
    const [linux, mac] = zips("0.2.0");
    assert.throws(
      () => notes("v0.2.0", repo, [linux, mac]),
      /No zip for Windows 10 or 11, x64: hash-block-0\.2\.0-windows-x64\.zip/,
    );
    assert.throws(
      () => notes("v0.2.0", repo, [...zips("0.2.0"), `elsewhere/${linux}`]),
      /hash-block-0\.2\.0-linux-x64\.zip is given twice/,
    );
  });

  it("stop when no zip was built", () => {
    assert.throws(() => notes("v0.2.0", repo, []), /No zips were built/);
  });
});

describe("the notes' command", () => {
  const script = fileURLToPath(new URL("./release-notes.mjs", import.meta.url));
  const run = (args, env = {}) =>
    spawnSync(process.execPath, [script, ...args], { encoding: "utf8", env: { PATH: "", ...env } });

  it("prints the notes", () => {
    const done = run(["v0.2.0", ...zips("0.2.0")], { GH_REPO: repo });
    assert.equal(done.status, 0, done.stderr);
    assert.equal(done.stdout, `${notes("v0.2.0", repo, zips("0.2.0"))}\n`);
  });

  it("names what it needs, without a tag or a repository", () => {
    for (const done of [run([], { GH_REPO: repo }), run(["v0.2.0", ...zips("0.2.0")])]) {
      assert.equal(done.status, 1);
      assert.match(done.stderr, /^Give the tag, then the zips/);
    }
  });

  it("prints nothing, and fails, on a zip that names no system", () => {
    const done = run(["v0.2.0", ...zips("0.2.0"), "notes.txt"], { GH_REPO: repo });
    assert.equal(done.status, 1);
    assert.equal(done.stdout, "");
    assert.match(done.stderr, /notes\.txt names no system/);
  });
});
