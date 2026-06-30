import { describe, expect, it } from "vitest";
import type { ChatMessageToken } from "../chatMessageTokens";
import { tokenizeChatMessage } from "../chatMessageTokens";

describe("tokenizeChatMessage", () => {
	it("plain text produces a single text token", () => {
		expect(tokenizeChatMessage("hello world")).toEqual([
			{ type: "text", text: "hello world" },
		]);
	});

	it("single URL produces text-link-text", () => {
		expect(tokenizeChatMessage("see https://example.com here")).toEqual([
			{ type: "text", text: "see " },
			{
				type: "link",
				text: "https://example.com",
				url: "https://example.com/",
			},
			{ type: "text", text: " here" },
		]);
	});

	it("multiple URLs in one message", () => {
		expect(tokenizeChatMessage("a https://one.io b https://two.io c")).toEqual([
			{ type: "text", text: "a " },
			{ type: "link", text: "https://one.io", url: "https://one.io/" },
			{ type: "text", text: " b " },
			{ type: "link", text: "https://two.io", url: "https://two.io/" },
			{ type: "text", text: " c" },
		]);
	});

	it("URL containing HTML-looking characters stays a link with no raw HTML", () => {
		const input = "https://example.com/?q=%22%3E%3Cscript%3E";
		const tokens = tokenizeChatMessage(input);
		const link = tokens.find((t) => t.type === "link");
		expect(link).toBeDefined();
		if (link?.type === "link") {
			expect(link.text).toBe(input);
			expect(link.url).toBe(input);
		}
		for (const t of tokens) {
			if (t.type === "text") {
				expect(t.text).not.toMatch(/<script>/i);
			}
		}
	});

	it("javascript: scheme URL is treated as text, not a link", () => {
		const tokens = tokenizeChatMessage("javascript:alert(1)");
		expect(tokens).toEqual([{ type: "text", text: "javascript:alert(1)" }]);
		expect(tokens.some((t) => t.type === "link")).toBe(false);
	});

	it("data: scheme URL is treated as text", () => {
		const tokens = tokenizeChatMessage(
			"data:text/html,<script>alert(1)</script>",
		);
		expect(tokens).toEqual([
			{ type: "text", text: "data:text/html,<script>alert(1)</script>" },
		]);
		expect(tokens.some((t) => t.type === "link")).toBe(false);
	});

	it("mailto: and other non-http(s) schemes are treated as text", () => {
		const inputs = [
			"mailto:[email protected]",
			"tel:+15555550100",
			"ftp://x.example/",
		];
		for (const input of inputs) {
			const tokens = tokenizeChatMessage(input);
			expect(tokens).toEqual([{ type: "text", text: input }]);
			expect(tokens.some((t) => t.type === "link")).toBe(false);
		}
	});

	it("malformed URL falls back to text", () => {
		const tokens = tokenizeChatMessage("https://");
		expect(tokens).toEqual([{ type: "text", text: "https://" }]);
		expect(tokens.some((t) => t.type === "link")).toBe(false);
	});

	it("empty string produces no tokens", () => {
		expect(tokenizeChatMessage("")).toEqual([]);
	});

	it("whitespace-only produces a single text token", () => {
		expect(tokenizeChatMessage("   \t  ")).toEqual([
			{ type: "text", text: "   \t  " },
		]);
	});

	it("newline and tab characters pass through to text tokens", () => {
		const tokens = tokenizeChatMessage("line1\nline2\thttps://x.example");
		expect(tokens).toEqual([
			{ type: "text", text: "line1\nline2\t" },
			{ type: "link", text: "https://x.example", url: "https://x.example/" },
		]);
	});

	it("URL at start of message", () => {
		const tokens = tokenizeChatMessage("https://x.example trailing");
		expect(tokens).toEqual([
			{ type: "link", text: "https://x.example", url: "https://x.example/" },
			{ type: "text", text: " trailing" },
		]);
	});

	it("URL at end of message", () => {
		const tokens = tokenizeChatMessage("leading https://x.example");
		expect(tokens).toEqual([
			{ type: "text", text: "leading " },
			{ type: "link", text: "https://x.example", url: "https://x.example/" },
		]);
	});
});
