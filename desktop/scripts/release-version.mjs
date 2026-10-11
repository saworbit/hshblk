/**
 * Checks that a release tag names the version the packages carry: v0.2.0 for 0.2.0, in
 * tauri.conf.json, Cargo.toml, and package.json. Says which differ, and exits non-zero, if any do.
 *
 *   node scripts/release-version.mjs v0.2.0
 */
import { readFileSync } from "node:fs";

const tag = process.argv[2] ?? "";
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

const versions = {
  "src-tauri/tauri.conf.json": JSON.parse(read("src-tauri/tauri.conf.json")).version,
  // The first version in the file is the package's own.
  "src-tauri/Cargo.toml": /^version\s*=\s*"([^"]*)"/m.exec(read("src-tauri/Cargo.toml"))?.[1],
  "package.json": JSON.parse(read("package.json")).version,
};

const wrong = Object.entries(versions).filter(([, version]) => `v${version}` !== tag);
for (const [file, version] of wrong)
  console.error(`${file} says ${version}, and the tag is ${tag}.`);
if (wrong.length === 0) console.log(`${tag} is the version in all three.`);
process.exitCode = wrong.length === 0 ? 0 : 1;
