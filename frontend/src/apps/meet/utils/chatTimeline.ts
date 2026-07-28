import type { PollPayloadFE } from "../types";

export interface TimelineMessage {
	id: string | number;
	user_id: string;
	user_name: string;
	message: string;
	timestamp: string;
}

export interface MessageGroup {
	id: string | number;
	user_id: string;
	user_name: string;
	timestamp: string;
	isOwn: boolean;
	messages: TimelineMessage[];
}

export type ChatItem =
	| {
			type: "poll";
			key: string;
			poll: PollPayloadFE;
			timestamp: string;
	  }
	| {
			type: "message";
			key: string;
			group: MessageGroup;
			timestamp: string;
	  };

type TimelineEntry =
	| { type: "poll"; timestamp: string; poll: PollPayloadFE }
	| { type: "message"; timestamp: string; message: TimelineMessage };

const GROUP_WINDOW_MS = 5 * 60 * 1000;

export function buildChatTimeline(
	messages: TimelineMessage[],
	polls: PollPayloadFE[],
	currentUserId?: string,
): ChatItem[] {
	const entries: TimelineEntry[] = [
		...polls.map((poll) => ({
			type: "poll" as const,
			timestamp: poll.createdAt || "1970-01-01T00:00:00.000Z",
			poll,
		})),
		...messages.map((message) => ({
			type: "message" as const,
			timestamp: message.timestamp,
			message,
		})),
	];

	entries.sort((a, b) => {
		const difference = Date.parse(a.timestamp) - Date.parse(b.timestamp);
		if (difference) return difference;
		if (a.type === b.type) return 0;
		return a.type === "poll" ? -1 : 1;
	});

	const items: ChatItem[] = [];
	let currentGroup: MessageGroup | null = null;

	for (const entry of entries) {
		if (entry.type === "poll") {
			items.push({
				type: "poll",
				key: `poll-${entry.poll.pollId}`,
				poll: entry.poll,
				timestamp: entry.timestamp,
			});
			currentGroup = null;
			continue;
		}

		const { message } = entry;
		const isOwn = message.user_id === currentUserId;
		const shouldStartNewGroup =
			!currentGroup ||
			currentGroup.user_id !== message.user_id ||
			currentGroup.isOwn !== isOwn ||
			Date.parse(message.timestamp) - Date.parse(currentGroup.timestamp) >
				GROUP_WINDOW_MS;

		if (shouldStartNewGroup) {
			currentGroup = {
				id: message.id,
				user_id: message.user_id,
				user_name: message.user_name,
				timestamp: message.timestamp,
				isOwn,
				messages: [message],
			};
			items.push({
				type: "message",
				key: `msg-${currentGroup.id}`,
				group: currentGroup,
				timestamp: currentGroup.timestamp,
			});
		} else {
			currentGroup.messages.push(message);
		}
	}

	return items;
}
