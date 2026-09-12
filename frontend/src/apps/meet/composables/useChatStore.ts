import { defineStore } from "pinia";

export interface ChatMessage {
	id: number;
	messageId?: string;
	user_id: string;
	user_name: string;
	message: string;
	timestamp: string;
}

export const useChatStore = defineStore("meet-chat", {
	state: () => ({
		isChatOpen: false,
		chatMessages: [] as ChatMessage[],
		hasUnreadMessages: false,
		hostOnlyChat: false,
		pinnedMessage: null as ChatMessage | null,
	}),
	actions: {
		toggleChat() {
			this.isChatOpen = !this.isChatOpen;
			if (this.isChatOpen) this.hasUnreadMessages = false;
		},
		markAsRead() {
			this.hasUnreadMessages = false;
		},
		addMessage(message: ChatMessage) {
			if (!this.chatMessages) this.chatMessages = [];
			this.chatMessages.push(message);
		},
		setPinnedMessage(message: ChatMessage | null) {
			this.pinnedMessage = message;
		},
	},
});

export type ChatStore = ReturnType<typeof useChatStore>;
