import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.resolve(frontendRoot, "../suite/public/frontend");
const manifestName = ".vite/bundle-budget-manifest.json";
const manifestPath = path.join(outputRoot, manifestName);
const limit = 200 * 1024;

const build = spawnSync(
  "yarn",
  ["vite", "build", "--manifest", manifestName],
  { cwd: frontendRoot, stdio: "inherit" },
);
if (build.status !== 0) process.exit(build.status || 1);
if (!fs.existsSync(manifestPath)) {
  console.error(`Vite did not emit ${manifestPath}.`);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const entryKey = manifest["index.html"]?.isEntry
  ? "index.html"
  : Object.keys(manifest).find(
      (key) => manifest[key].isEntry && manifest[key].src === "index.html",
    );
if (!entryKey) {
  console.error("The Vite manifest has no index.html entry.");
  process.exit(1);
}

const reachable = new Set();
const visit = (key) => {
  if (reachable.has(key)) return;
  const chunk = manifest[key];
  if (!chunk) throw new Error(`Vite manifest import ${key} is missing.`);
  reachable.add(key);
  for (const imported of chunk.imports || []) visit(imported);
};
visit(entryKey);

let gzipBytes = 0;
for (const key of reachable) {
  const file = manifest[key].file;
  if (!file.endsWith(".js")) continue;
  gzipBytes += gzipSync(fs.readFileSync(path.join(outputRoot, file))).byteLength;
}
fs.rmSync(manifestPath, { force: true });

const kibibytes = gzipBytes / 1024;
console.log(
  `Initial static JavaScript graph: ${kibibytes.toFixed(2)} KiB gzip across ${reachable.size} chunks (budget: 200.00 KiB).`,
);
if (gzipBytes > limit) {
  console.error(`Bundle budget exceeded by ${((gzipBytes - limit) / 1024).toFixed(2)} KiB.`);
  process.exitCode = 1;
}
