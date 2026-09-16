import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(frontendRoot, "test-manifest", "legacy-failures.json");
const reportPath = path.join(os.tmpdir(), `suite-legacy-vitest-${process.pid}.json`);
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

const result = spawnSync(
  "yarn",
  [
    "vitest",
    "run",
    "--project",
    "legacy",
    "--reporter=json",
    `--outputFile=${reportPath}`,
  ],
  { cwd: frontendRoot, encoding: "utf8" },
);

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (!fs.existsSync(reportPath)) {
  console.error("Legacy Vitest did not produce its JSON report.");
  process.exit(result.status || 1);
}

const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
fs.rmSync(reportPath, { force: true });

function relativeFile(filename) {
  return path.relative(frontendRoot, filename).split(path.sep).join("/");
}

const actual = [];
for (const testFile of report.testResults) {
  const file = relativeFile(testFile.name);
  const failedAssertions = testFile.assertionResults.filter(
    (assertion) => assertion.status === "failed",
  );
  for (const assertion of failedAssertions) {
    actual.push({ type: "assertion", file, name: assertion.fullName });
  }
  if (testFile.status === "failed" && failedAssertions.length === 0) {
    actual.push({ type: "collection", file, message: testFile.message });
  }
}

if (!report.success && actual.length === 0) {
  console.error("Legacy Vitest failed without a file or assertion result.");
  process.exit(1);
}

function key(failure) {
  return failure.type === "assertion"
    ? `${failure.type}|${failure.file}|${failure.name}`
    : `${failure.type}|${failure.file}|${failure.messageIncludes}`;
}

const expectedByKey = new Map(manifest.failures.map((failure) => [key(failure), failure]));
if (expectedByKey.size !== manifest.failures.length) {
  console.error("The legacy failure manifest contains duplicate entries.");
  process.exit(1);
}
const matched = new Set();
const unexpected = [];
for (const failure of actual) {
  if (failure.type === "assertion") {
    const failureKey = key(failure);
    if (expectedByKey.has(failureKey)) matched.add(failureKey);
    else unexpected.push(failure);
    continue;
  }
  const expected = manifest.failures.find(
    (entry) => entry.type === "collection"
      && entry.file === failure.file
      && failure.message.includes(entry.messageIncludes),
  );
  if (expected) matched.add(key(expected));
  else unexpected.push(failure);
}

const recovered = [...expectedByKey.keys()].filter((failureKey) => !matched.has(failureKey));
if (unexpected.length || recovered.length) {
  if (unexpected.length) {
    console.error("New legacy Vitest failures:");
    for (const failure of unexpected) {
      const detail = failure.type === "assertion" ? failure.name : failure.message.split("\n")[0];
      console.error(`  ${failure.file}: ${detail}`);
    }
  }
  if (recovered.length) {
    console.error("Recovered legacy failures still present in the manifest:");
    for (const failureKey of recovered) console.error(`  ${failureKey}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `Legacy Vitest matched the exact failure manifest (${actual.length} expected failures).`,
  );
}
