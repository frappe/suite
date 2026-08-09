import { describe, expect, it, vi } from "vitest";
import { useChat } from "../useChat";
import type { ChatMessage, ChatStore } from "../useChatStore";
import { E2EEMeeting } from "../../utils/media/E2EEMeeting";

vi.mock("frappe-ui", () => ({
	toast: { error: vi.fn() },
}));

vi.mock("../../utils/audioNotifications", () => ({
	default: { playChatNotification: vi.fn() },
}));

function makeChatStore(): ChatStore {
	const messages: ChatMessage[] = [];
	return {
		isChatOpen: true,
		chatMessages: messages,
		hasUnreadMessages: false,
		hostOnlyChat: false,
		toggleChat: vi.fn(),
		markAsRead: vi.fn(),
		addMessage: vi.fn((message: ChatMessage) => messages.push(message)),
		$reset: vi.fn(),
	};
}

function makeSFUClient(
	overrides: Partial<{
		isE2EERequired: () => boolean;
		sendChatMessage: (message: string) => Promise<{
			success: boolean;
			timestamp: string;
		}>;
	}> = {},
) {
	const handlers = new Map<string, (data: unknown) => void>();
	return {
		on: vi.fn((event: string, handler: (data: unknown) => void) => {
			handlers.set(event, handler);
		}),
		isConnected: vi.fn(() => true),
		isE2EERequired: vi.fn(() => true),
		sendChatMessage: vi.fn(),
		emitChatMessage: (data: unknown) =>
			handlers.get("chat:message")?.(data),
		...overrides,
	};
}

const currentUser = {
	currentUser: {
		value: {
			user_id: "alice@example.com",
			full_name: "Alice",
			name: "Alice",
		},
	},
};

describe("useChat E2EE gating", () => {
	it("does not send plaintext chat while E2EE is required but not ready", async () => {
		E2EEMeeting.instance = new E2EEMeeting();
		const chatStore = makeChatStore();
		const sfuClient = makeSFUClient();
		const chat = useChat({
			chatStore,
			currentUser: currentUser as never,
			sfuClient: sfuClient as never,
		});

		await chat.onSendChat("secret");

		expect(sfuClient.sendChatMessage).not.toHaveBeenCalled();
		expect(chatStore.addMessage).not.toHaveBeenCalled();
	});

	it("blocks inbound plaintext chat while E2EE is required", async () => {
		E2EEMeeting.instance = new E2EEMeeting();
		const chatStore = makeChatStore();
		const sfuClient = makeSFUClient();
		const chat = useChat({
			chatStore,
			currentUser: currentUser as never,
			sfuClient: sfuClient as never,
		});
		chat.setupChatEvents(vi.fn());

		sfuClient.emitChatMessage({
			fromUser: "bob@example.com",
			fromName: "Bob",
			message: "plaintext",
		});
		await Promise.resolve();

		expect(chatStore.chatMessages.at(-1)?.message).toBe(
			"[Unencrypted message blocked]",
		);
	});

	it("notifies for inbound messages while chat is closed", async () => {
		E2EEMeeting.instance = new E2EEMeeting();
		const chatStore = makeChatStore();
		chatStore.isChatOpen = false;
		const sfuClient = makeSFUClient({ isE2EERequired: vi.fn(() => false) });
		const notify = vi.fn();
		const chat = useChat({
			chatStore,
			currentUser: currentUser as never,
			sfuClient: sfuClient as never,
		});
		chat.setupChatEvents(notify);

		sfuClient.emitChatMessage({
			fromUser: "bob@example.com",
			fromName: "Bob",
			message: "Hello",
		});
		await Promise.resolve();

		expect(notify).toHaveBeenCalledWith({
			message: "Hello",
			fromUser: "bob@example.com",
			fromName: "Bob",
			type: "chat",
		});
	});

	it("uses the server timestamp for locally sent messages", async () => {
		E2EEMeeting.instance = new E2EEMeeting();
		const chatStore = makeChatStore();
		const timestamp = "2026-07-28T12:02:00.000Z";
		const sfuClient = makeSFUClient({
			isE2EERequired: vi.fn(() => false),
			sendChatMessage: vi.fn(async () => ({ success: true, timestamp })),
		});
		const chat = useChat({
			chatStore,
			currentUser: currentUser as never,
			sfuClient: sfuClient as never,
		});

		await chat.onSendChat("After the poll");

		expect(chatStore.chatMessages.at(-1)?.timestamp).toBe(timestamp);
	});
});
