import { describe, expect, it } from "vitest";
import type { PollPayloadFE } from "../../types";
import type { ChatMessage } from "../../composables/useChatStore";
import { buildChatTimeline } from "../chatTimeline";

const poll: PollPayloadFE = {
	pollId: "poll-1",
	createdBy: "alice@example.com",
	question: "Lunch?",
	options: [],
	isActive: true,
	createdAt: "2026-07-28T12:01:00.000Z",
};

describe("buildChatTimeline", () => {
	it("does not group messages across a poll", () => {
		const messages: ChatMessage[] = [
			{
				id: 1,
				user_id: "alice@example.com",
				user_name: "Alice",
				message: "Before",
				timestamp: "2026-07-28T12:00:00.000Z",
			},
			{
				id: 2,
				user_id: "alice@example.com",
				user_name: "Alice",
				message: "After",
				timestamp: "2026-07-28T12:02:00.000Z",
			},
		];

		const timeline = buildChatTimeline(messages, [poll], "alice@example.com");

		expect(timeline.map((item) => item.type)).toEqual([
			"message",
			"poll",
			"message",
		]);
		expect(timeline[2].type === "message" && timeline[2].group.messages[0].message).toBe(
			"After",
		);
	});
});
