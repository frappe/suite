import test from "node:test";
import assert from "node:assert/strict";
import { applyFixturePatches } from "./fixture-patches.mjs";
test("a fixture refactor cannot silently bypass a production-code patch", () => {
	assert.throws(
		() =>
			applyFixturePatches("publishRaw(track)", [
				["oldPublish(track)", "publishWithMeet(track)"],
			]),
		/expected one occurrence/,
	);
	assert.throws(
		() =>
			applyFixturePatches("publishRaw(track);publishRaw(track)", [
				["publishRaw(track)", "publishWithMeet(track)"],
			]),
		/expected one occurrence/,
	);
	assert.equal(
		applyFixturePatches("await publishRaw(track)", [
			["publishRaw(track)", "publishWithMeet(track)"],
		]),
		"await publishWithMeet(track)",
	);
});
