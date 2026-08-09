import test from "node:test";
import assert from "node:assert/strict";
import { analyzeSource } from "./check.mjs";

test("rejects open records without matching text in comments", () => {
	const findings = analyzeSource(
		"frontend/src/apps/meet/example.ts",
		"// Record<string, unknown>\ntype Data = Record<string, unknown>;\n",
	);
	assert.deepEqual(findings.map(({ rule, line }) => ({ rule, line })), [
		{ rule: "MTP001", line: 2 },
	]);
});

test("rejects open unknown index signatures", () => {
	const findings = analyzeSource(
		"suite/meet/types/example.ts",
		"interface Data { [key: string]: unknown }",
	);
	assert.deepEqual(findings.map(({ rule }) => rule), ["MTP001"]);
});

test("rejects explicit any but accepts boundary unknown", () => {
	const findings = analyzeSource(
		"frontend/src/apps/meet/example.ts",
		"function parse(value: unknown): any { return value }",
	);
	assert.deepEqual(findings.map(({ rule }) => rule), ["MTP002"]);
});

test("rejects production double assertions", () => {
	const findings = analyzeSource(
		"frontend/src/apps/meet/example.ts",
		"const participant = input as unknown as Participant;",
	);
	assert.deepEqual(findings.map(({ rule }) => rule), ["MTP003"]);
});

test("rejects angle-bracket double assertions", () => {
	const findings = analyzeSource(
		"frontend/src/apps/meet/example.ts",
		"const participant = <Participant><unknown>input;",
	);
	assert.deepEqual(findings.map(({ rule }) => rule), ["MTP003"]);
});

test("rejects parenthesized double assertions", () => {
	const findings = analyzeSource(
		"frontend/src/apps/meet/example.ts",
		"const participant = (<unknown>input) as Participant;",
	);
	assert.deepEqual(findings.map(({ rule }) => rule), ["MTP003"]);
});

test("permits test-double assertions", () => {
	const findings = analyzeSource(
		"suite/meet/sfu-server/src/example.test.ts",
		"const socket = fake as unknown as Socket;",
	);
	assert.deepEqual(findings, []);
});

test("maps Vue script findings to original lines", () => {
	const findings = analyzeSource(
		"frontend/src/apps/meet/Example.vue",
		'<template>ok</template>\n<script setup lang="ts">\nconst value: any = 1\n</script>\n',
	);
	assert.deepEqual(findings.map(({ rule, line }) => ({ rule, line })), [
		{ rule: "MTP002", line: 3 },
	]);
});
