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

function makeSFUClient(overrides: Record<string, unknown> = {}) {
	const handlers = new Map<string, (data: Record<string, unknown>) => void>();
	return {
		on: vi.fn((event: string, handler: (data: Record<string, unknown>) => void) => {
			handlers.set(event, handler);
		}),
		isConnected: vi.fn(() => true),
		isE2EERequired: vi.fn(() => true),
		sendChatMessage: vi.fn(),
		emitChatMessage: (data: Record<string, unknown>) =>
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
		chat.setupChatEvents({});

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
});
