import { describe, expect, it } from "vitest";
import {
	findColonQuery,
	insertEmojiAtQuery,
	suggestEmojis,
} from "../emojiSuggest";

describe("findColonQuery", () => {
	it("finds trailing colon query", () => {
		expect(findColonQuery("hi :smi", 7)).toEqual({ start: 3, query: "smi" });
	});

	it("returns null when no colon query", () => {
		expect(findColonQuery("hello", 5)).toBeNull();
	});

	it("does not match URL schemes", () => {
		expect(findColonQuery("http://example.com", 18)).toBeNull();
	});
});

describe("suggestEmojis", () => {
	it("ranks exact and prefix matches first", () => {
		const hits = suggestEmojis("fire");
		expect(hits.length).toBeGreaterThan(0);
		expect(hits[0].name).toBe("fire");
		expect(hits[0].emoji).toBe("🔥");
	});

	it("limits results", () => {
		expect(suggestEmojis("", 5)).toHaveLength(5);
	});
});

describe("insertEmojiAtQuery", () => {
	it("replaces :query with the emoji", () => {
		const { text, caret } = insertEmojiAtQuery("hi :smile", 9, 3, "😄");
		expect(text).toBe("hi 😄");
		expect(caret).toBe(5);
	});
});
