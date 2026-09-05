import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const frontendRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const appsRoot = path.join(frontendRoot, "src", "apps");
const sourceExtensions = new Set([
  ".cjs",
  ".js",
  ".jsx",
  ".mjs",
  ".ts",
  ".tsx",
  ".vue",
]);
const products = new Set(
  fs
    .readdirSync(appsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name),
);

const debtGroups = [
  {
    owner: "Mail and Calendar owners",
    removal:
      "Publish Calendar UI contracts before changing the existing Mail integration.",
    entries: [
      "mail/components/CalendarInviteBanner.vue|@/apps/calendar/components/DateChip.vue",
      "mail/components/CalendarInviteBanner.vue|@/apps/calendar/utils/dayjs",
      "mail/components/CalendarInviteBanner.vue|@/apps/calendar/utils/eventTime",
      "mail/components/DefaultLayout.vue|@/apps/calendar/utils/dayjs",
      "mail/components/DefaultLayout.vue|@/apps/calendar/components/EventDetailSidebar.vue",
      "mail/components/UpcomingEvents.vue|@/apps/calendar/utils/dayjs",
      "mail/components/UpcomingEvents.vue|@/apps/calendar/components/UpcomingEvents.vue",
      "mail/composables/useUpcomingEvents.ts|@/apps/calendar/utils/dayjs",
      "mail/composables/useUpcomingEvents.ts|@/apps/calendar/utils/eventTime",
      "mail/composables/useUpcomingEvents.ts|@/apps/calendar/stores/user",
    ],
  },
  {
    owner: "Meet and Calendar owners",
    removal:
      "Publish Calendar scheduling contracts before changing the existing Meet integration.",
    entries: [
      "meet/components/UpcomingMeetings.vue|@/apps/calendar/stores/user",
      "meet/components/UpcomingMeetings.vue|@/apps/calendar/utils/dayjs",
      "meet/pages/Home.vue|@/apps/calendar/stores/user",
      "meet/pages/Home.vue|@/apps/calendar/utils/dayjs",
      "meet/pages/Home.vue|@/apps/calendar/components/ParticipantSelector.vue",
      "meet/pages/Home.vue|@/apps/calendar/utils/scheduleTime",
    ],
  },
  {
    owner: "Slides frontend owner",
    removal: "Move to @/apps/drive in Drive frontend adoption ticket 34.",
    entries: ["slides/components/SharePopover.vue|@/apps/drive/sdk"],
  },
  {
    owner: "Writer frontend owner",
    removal:
      "Move to @/apps/drive in Drive frontend adoption tickets 32 and 34.",
    entries: [
      "writer/components/CommentEditor.vue|@/apps/drive/sdk",
      "writer/components/CoreEditor.vue|@/apps/drive/sdk",
      "writer/components/Dialogs.vue|@/apps/drive/sdk",
      "writer/components/Dialogs.vue|@/apps/drive/data/selection",
      "writer/components/Navbar.vue|@/apps/drive/components/EditableBreadcrumbs.vue",
      "writer/components/Navbar.vue|@/apps/drive/sdk",
      "writer/components/Navbar.vue|@/apps/drive/resources/files",
      "writer/components/ToC.vue|@/apps/drive/sdk",
      "writer/composables/useDocument.ts|@/apps/drive/sdk",
      "writer/composables/useUsers.ts|@/apps/drive/sdk",
      "writer/routes.ts|@/apps/drive/sdk",
      "writer/utils/index.js|@/apps/drive/sdk",
    ],
  },
];

const baseline = new Map();
for (const group of debtGroups) {
  for (const entry of group.entries) {
    if (baseline.has(entry))
      throw new Error(`Duplicate import-boundary baseline entry: ${entry}`);
    baseline.set(entry, group);
  }
}

function* walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const item = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(item);
    else if (sourceExtensions.has(path.extname(entry.name))) yield item;
  }
}

function sourceUnits(file, source) {
  if (path.extname(file) !== ".vue") return [{ source, lineOffset: 0 }];
  const units = [];
  const scripts = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  for (let match = scripts.exec(source); match; match = scripts.exec(source)) {
    units.push({
      source: match[1],
      lineOffset: source.slice(0, match.index).split("\n").length - 1,
    });
  }
  return units;
}

function moduleSpecifiers(source, filename) {
  const sourceFile = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const found = [];
  const add = (literal) => {
    if (!literal || !ts.isStringLiteralLike(literal)) return;
    const position = sourceFile.getLineAndCharacterOfPosition(
      literal.getStart(sourceFile),
    );
    found.push({ specifier: literal.text, line: position.line + 1 });
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      add(node.moduleSpecifier);
    if (ts.isCallExpression(node)) {
      const dynamicImport =
        node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const namedCall =
        ts.isIdentifier(node.expression) && node.expression.text === "require";
      const mockCall =
        ts.isPropertyAccessExpression(node.expression) &&
        ["jest", "vi"].includes(
          node.expression.expression.getText(sourceFile),
        ) &&
        node.expression.name.text === "mock";
      if (dynamicImport || namedCall || mockCall) add(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function targetFor(file, specifier) {
  if (specifier.startsWith("@/apps/")) {
    const [target, ...rest] = specifier.slice("@/apps/".length).split("/");
    return products.has(target)
      ? { target, rest: rest.join("/"), canonical: true }
      : null;
  }
  if (!specifier.startsWith(".")) return null;
  const resolved = path.resolve(path.dirname(file), specifier);
  const relative = path.relative(appsRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  const [target, ...rest] = relative.split(path.sep);
  return products.has(target)
    ? { target, rest: rest.join("/"), canonical: false }
    : null;
}

function violationsInSource(relative, source, lineOffset = 0) {
  const file = path.join(appsRoot, relative);
  const owner = relative.split("/")[0];
  const violations = [];
  for (const item of moduleSpecifiers(source, relative)) {
    const destination = targetFor(file, item.specifier);
    if (!destination || destination.target === owner) continue;
    if (destination.canonical && destination.rest === "") continue;
    violations.push({
      path: relative,
      line: item.line + lineOffset,
      specifier: item.specifier,
      reason: destination.canonical
        ? `cross-product imports must use @/apps/${destination.target}`
        : "cross-product imports must use the target app alias, not a relative path",
    });
  }
  return violations;
}

function scan() {
  const violations = [];
  for (const file of walk(appsRoot)) {
    const relative = path.relative(appsRoot, file).split(path.sep).join("/");
    const source = fs.readFileSync(file, "utf8");
    for (const unit of sourceUnits(file, source)) {
      violations.push(
        ...violationsInSource(relative, unit.source, unit.lineOffset),
      );
    }
  }
  violations.sort(
    (left, right) =>
      left.path.localeCompare(right.path) || left.line - right.line,
  );
  return violations;
}

function keyed(violations) {
  const counts = new Map();
  const result = new Map();
  for (const violation of violations) {
    const base = `${violation.path}|${violation.specifier}`;
    const count = (counts.get(base) ?? 0) + 1;
    counts.set(base, count);
    result.set(count === 1 ? base : `${base}#${count}`, violation);
  }
  return result;
}

function selfTest() {
  const forbidden = violationsInSource(
    "writer/newFeature.ts",
    "import { require } from '@/apps/drive/internal/access'\n",
  );
  if (forbidden.length !== 1)
    throw new Error(
      "Import-boundary self-test did not reject a private cross-product import",
    );
  const allowed = violationsInSource(
    "writer/newFeature.ts",
    "import { check } from '@/apps/drive'\n",
  );
  if (allowed.length !== 0)
    throw new Error(
      "Import-boundary self-test rejected a package-root interface import",
    );
}

selfTest();
const actual = keyed(scan());
const unexpected = [...actual.keys()]
  .filter((key) => !baseline.has(key))
  .sort();
const resolved = [...baseline.keys()].filter((key) => !actual.has(key)).sort();

if (unexpected.length || resolved.length) {
  if (unexpected.length) {
    console.error("New frontend import-boundary violations:");
    for (const key of unexpected) {
      const violation = actual.get(key);
      console.error(
        `  ${violation.path}:${violation.line}: ${violation.specifier} (${violation.reason})`,
      );
    }
  }
  if (resolved.length) {
    console.error("Resolved frontend debt still present in the baseline:");
    for (const key of resolved)
      console.error(`  ${key} (owner: ${baseline.get(key).owner})`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `Frontend import boundaries passed (${actual.size} owned legacy violations baselined).`,
  );
}
