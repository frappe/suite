import { defineStore } from "pinia";
import { ref } from "vue";

export interface ChatMessage {
	id: number;
	messageId?: string;
	user_id: string;
	user_name: string;
	message: string;
	timestamp: string;
}

export interface ChatStore {
	isChatOpen: boolean;
	chatMessages: ChatMessage[];
	hasUnreadMessages: boolean;
	toggleChat: () => void;
	hostOnlyChat: boolean;
	markAsRead: () => void;
	addMessage: (message: ChatMessage) => void;
	pinnedMessage: ChatMessage | null;
	setPinnedMessage: (message: ChatMessage | null) => void;
	$reset: () => void;
}

export const useChatStore = defineStore("meet-chat", () => {
	const isChatOpen = ref(false);
	const chatMessages = ref<ChatMessage[]>([]);
	const hasUnreadMessages = ref(false);
	const hostOnlyChat = ref(false);
	const pinnedMessage = ref<ChatMessage | null>(null);

	function toggleChat() {
		isChatOpen.value = !isChatOpen.value;
		if (isChatOpen.value) {
			hasUnreadMessages.value = false;
		}
	}

	function markAsRead() {
		hasUnreadMessages.value = false;
	}

	function addMessage(message: ChatMessage) {
		if (!chatMessages.value) {
			chatMessages.value = [];
		}
		chatMessages.value.push(message);
	}

	function setPinnedMessage(message: ChatMessage | null) {
		pinnedMessage.value = message;
	}

	function $reset() {
		isChatOpen.value = false;
		chatMessages.value = [];
		hasUnreadMessages.value = false;
		hostOnlyChat.value = false;
		pinnedMessage.value = null;
	}

	return {
		isChatOpen,
		chatMessages,
		hasUnreadMessages,
		toggleChat,
		hostOnlyChat,
		markAsRead,
		addMessage,
		pinnedMessage,
		setPinnedMessage,
		$reset,
	};
});
