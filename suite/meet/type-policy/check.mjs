import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const POLICY_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(POLICY_DIR, "../../..");
const ALLOWLIST_PATH = path.join(POLICY_DIR, "allowlist.json");
const SOURCE_ROOTS = [
	"frontend/src/apps/meet",
	"frontend/recorder",
	"suite/meet/types",
	"suite/meet/sfu-server/src",
	"suite/meet/recorder-server/src",
	"e2e/meet",
];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".vue"]);

function isTestPath(relativePath) {
	return /(?:^|\/)(?:__tests__|test)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/.test(
		relativePath,
	);
}

function filesUnder(directory) {
	if (!fs.existsSync(directory)) return [];
	const files = [];
	for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
		const entryPath = path.join(directory, entry.name);
		if (entry.isDirectory()) files.push(...filesUnder(entryPath));
		else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) files.push(entryPath);
	}
	return files.sort();
}

function vueScripts(source) {
	const scripts = [];
	const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
	for (const match of source.matchAll(pattern)) {
		if (!/\blang\s*=\s*["']ts["']/.test(match[1])) continue;
		const openingTagLength = match[0].indexOf(">");
		scripts.push({
			text: match[2],
			offset: match.index + openingTagLength + 1,
		});
	}
	return scripts;
}

function locationAt(source, offset) {
	const before = source.slice(0, offset);
	const line = before.split("\n").length;
	const lineStart = before.lastIndexOf("\n") + 1;
	const lineEnd = source.indexOf("\n", offset);
	return {
		line,
		column: offset - lineStart + 1,
		lineText: source.slice(lineStart, lineEnd === -1 ? source.length : lineEnd),
	};
}

function isRawOpenRecord(node) {
	if (!ts.isTypeReferenceNode(node) || node.typeArguments?.length !== 2) return false;
	if (!ts.isIdentifier(node.typeName) || node.typeName.text !== "Record") return false;
	const [key, value] = node.typeArguments;
	return (
		key.kind === ts.SyntaxKind.StringKeyword &&
		(value.kind === ts.SyntaxKind.UnknownKeyword || value.kind === ts.SyntaxKind.AnyKeyword)
	);
}

function isUnknownStringIndex(node) {
	if (!ts.isIndexSignatureDeclaration(node) || node.parameters.length !== 1) return false;
	const parameterType = node.parameters[0].type;
	return (
		parameterType?.kind === ts.SyntaxKind.StringKeyword &&
		node.type?.kind === ts.SyntaxKind.UnknownKeyword
	);
}

function isUnsafeUnknownAssertion(node) {
	return (
		ts.isAsExpression(node) &&
		ts.isAsExpression(node.expression) &&
		node.expression.type.kind === ts.SyntaxKind.UnknownKeyword
	);
}

export function analyzeSource(relativePath, source) {
	const findings = [];
	const sections = relativePath.endsWith(".vue")
		? vueScripts(source)
		: [{ text: source, offset: 0 }];

	for (const section of sections) {
		const scriptKind = relativePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
		const sourceFile = ts.createSourceFile(
			relativePath,
			section.text,
			ts.ScriptTarget.Latest,
			true,
			scriptKind,
		);

		for (const diagnostic of sourceFile.parseDiagnostics) {
			const offset = section.offset + (diagnostic.start ?? 0);
			findings.push({
				path: relativePath,
				rule: "MTP000",
				message: ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
				...locationAt(source, offset),
			});
		}

		function visit(node) {
			let rule;
			let message;
			if (isRawOpenRecord(node) || isUnknownStringIndex(node)) {
				rule = "MTP001";
				message = "Use a concrete domain type, or validate an unknown value at the boundary.";
			} else if (node.kind === ts.SyntaxKind.AnyKeyword) {
				rule = "MTP002";
				message = "Explicit any disables the Meet type contract.";
			} else if (!isTestPath(relativePath) && isUnsafeUnknownAssertion(node)) {
				rule = "MTP003";
				message = "Do not launder a value through 'as unknown as'; model or validate it.";
			}

			if (rule) {
				findings.push({
					path: relativePath,
					rule,
					message,
					...locationAt(source, section.offset + node.getStart(sourceFile)),
				});
				if (rule === "MTP001") return;
			}
			ts.forEachChild(node, visit);
		}
		visit(sourceFile);
	}

	return findings;
}

function loadAllowlist() {
	const parsed = JSON.parse(fs.readFileSync(ALLOWLIST_PATH, "utf8"));
	if (parsed.version !== 1 || !Array.isArray(parsed.exceptions)) {
		throw new Error("allowlist.json must contain version 1 and an exceptions array");
	}
	const keys = new Set();
	for (const exception of parsed.exceptions) {
		const fields = ["path", "line", "column", "rule", "lineText", "reason"];
		if (
			Object.keys(exception).sort().join(",") !== fields.sort().join(",") ||
			!fields.every((field) => exception[field] !== undefined)
		) {
			throw new Error("Every allowlist exception must have only the required fields");
		}
		if (exception.rule !== "MTP001" || exception.reason.trim().length < 20) {
			throw new Error("Only reviewed MTP001 boundaries with a meaningful reason may be allowlisted");
		}
		const key = `${exception.path}:${exception.line}:${exception.column}:${exception.rule}`;
		if (keys.has(key)) throw new Error(`Duplicate allowlist entry: ${key}`);
		keys.add(key);
	}
	const sorted = [...parsed.exceptions].sort((left, right) =>
		`${left.path}:${String(left.line).padStart(8, "0")}:${String(left.column).padStart(8, "0")}`.localeCompare(
			`${right.path}:${String(right.line).padStart(8, "0")}:${String(right.column).padStart(8, "0")}`,
		),
	);
	if (JSON.stringify(sorted) !== JSON.stringify(parsed.exceptions)) {
		throw new Error("Allowlist exceptions must be sorted by path, line, and column");
	}
	return parsed.exceptions;
}

export function runPolicy() {
	const findings = SOURCE_ROOTS.flatMap((root) =>
		filesUnder(path.join(ROOT, root)).flatMap((file) => {
			const relativePath = path.relative(ROOT, file).split(path.sep).join("/");
			return analyzeSource(relativePath, fs.readFileSync(file, "utf8"));
		}),
	).sort((left, right) =>
		`${left.path}:${String(left.line).padStart(8, "0")}:${String(left.column).padStart(8, "0")}:${left.rule}`.localeCompare(
			`${right.path}:${String(right.line).padStart(8, "0")}:${String(right.column).padStart(8, "0")}:${right.rule}`,
		),
	);

	const allowlist = loadAllowlist();
	const used = new Set();
	const active = findings.filter((finding) => {
		const index = allowlist.findIndex(
			(exception) =>
				exception.path === finding.path &&
				exception.line === finding.line &&
				exception.column === finding.column &&
				exception.rule === finding.rule &&
				exception.lineText === finding.lineText,
		);
		if (index === -1) return true;
		used.add(index);
		return false;
	});

	for (let index = 0; index < allowlist.length; index += 1) {
		if (!used.has(index)) {
			const exception = allowlist[index];
			active.push({
				...exception,
				rule: "MTP004",
				message: `Stale allowlist entry for ${exception.rule}`,
			});
		}
	}

	return active.sort((left, right) =>
		`${left.path}:${String(left.line).padStart(8, "0")}:${String(left.column).padStart(8, "0")}:${left.rule}`.localeCompare(
			`${right.path}:${String(right.line).padStart(8, "0")}:${String(right.column).padStart(8, "0")}:${right.rule}`,
		),
	);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
	try {
		const findings = runPolicy();
		for (const finding of findings) {
			console.error(
				`${finding.path}:${finding.line}:${finding.column} ${finding.rule} ${finding.message}`,
			);
		}
		if (findings.length) process.exitCode = 1;
		else console.log("Meet type policy passed");
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	}
}
