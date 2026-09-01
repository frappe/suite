import { beforeEach, describe, expect, it } from "vitest";
import {
	readBoolean,
	readJSON,
	readString,
	remove,
	writeBoolean,
	writeJSON,
	writeString,
} from "./localStorage";

describe("localStorage", () => {
	beforeEach(() => localStorage.clear());

	it("reads and writes booleans using the existing 1/0 encoding", () => {
		expect(readBoolean("enabled", true)).toBe(true);

		writeBoolean("enabled", false);
		expect(localStorage.getItem("enabled")).toBe("0");
		expect(readBoolean("enabled", true)).toBe(false);
	});

	it("reads and writes strings", () => {
		expect(readString("name", "fallback")).toBe("fallback");

		writeString("name", "Meet");
		expect(readString("name")).toBe("Meet");
	});

	it("reads and writes JSON values", () => {
		const value = { x: 1, enabled: true };

		writeJSON("value", value);
		expect(readJSON("value")).toEqual(value);
	});

	it("removes values", () => {
		writeString("name", "Meet");
		remove("name");

		expect(readString("name", "fallback")).toBe("fallback");
	});
});
