import { toast } from "frappe-ui";
import audioNotificationManager from "../utils/audioNotifications";
import { E2EEMeeting } from "../utils/media/E2EEMeeting";
import type { SFUClient } from "../utils/SFUClient";
import type { ChatMessage, ChatStore } from "./useChatStore";
import type { CurrentUser } from "./useCurrentUser";
import { isUnknownRecord } from "../types";

interface ChatAPI {
	setupChatEvents: (notify: (notification: ChatNotification) => void) => void;
	onSendChat: (text: string) => void;
	toggleRestriction: (enabled: boolean) => void;
	pinMessage: (messageId: string, action?: "pin" | "unpin") => void;
}

interface ChatNotification {
	message: string;
	fromUser: string;
	fromName: string;
	type: "chat";
}

interface IncomingChatMessage {
	fromUser: string;
	fromName: string;
	message: string;
	timestamp: string;
	messageId?: string;
}

function normalizeChatMessage(value: unknown): IncomingChatMessage | null {
	if (
		!isUnknownRecord(value) ||
		typeof value.fromUser !== "string" ||
		typeof value.message !== "string"
	) return null;
	return {
		fromUser: value.fromUser,
		fromName:
			typeof value.fromName === "string" ? value.fromName : value.fromUser,
		message: value.message,
		timestamp:
			typeof value.timestamp === "string"
				? value.timestamp
				: new Date().toISOString(),
		messageId:
			typeof value.messageId === "string" ? value.messageId : undefined,
	};
}

const E2EE_CHAT_PREFIX = "e2ee:";

function isEncryptedChatMessage(message: string): boolean {
	return message.startsWith(E2EE_CHAT_PREFIX);
}

async function encryptChatMessage(
	key: CryptoKey,
	text: string,
): Promise<string> {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const encoded = new TextEncoder().encode(text);
	const encrypted = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv },
		key,
		encoded,
	);

	const combined = new Uint8Array(iv.length + encrypted.byteLength);
	combined.set(iv);
	combined.set(new Uint8Array(encrypted), iv.length);

	const binary = Array.from(combined)
		.map((b) => String.fromCharCode(b))
		.join("");
	return E2EE_CHAT_PREFIX + btoa(binary);
}

async function decryptChatMessage(
	key: CryptoKey,
	encryptedMessage: string,
): Promise<string> {
	const payload = encryptedMessage.slice(E2EE_CHAT_PREFIX.length);
	const binary = atob(payload);
	const combined = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		combined[i] = binary.charCodeAt(i);
	}

	const iv = combined.slice(0, 12);
	const ciphertext = combined.slice(12);

	const decrypted = await crypto.subtle.decrypt(
		{ name: "AES-GCM", iv },
		key,
		ciphertext,
	);
	return new TextDecoder().decode(decrypted);
}

function shouldEncryptChat(): boolean {
	return E2EEMeeting.instance.hasMeetingContext();
}

function isE2EERequired(sfuClient: SFUClient): boolean {
	return sfuClient.isE2EERequired?.() ?? false;
}

export function useChat(deps: {
	chatStore: ChatStore;
	currentUser: CurrentUser;
	sfuClient: SFUClient;
	canPin?: () => boolean;
}): ChatAPI {
	const { chatStore, currentUser, sfuClient, canPin = () => false } = deps;

	async function getChatKey(): Promise<CryptoKey | null> {
		return E2EEMeeting.instance.getE2EEChatKey();
	}

	async function resolvePlaintext(raw: string): Promise<string> {
		if (isEncryptedChatMessage(raw)) {
			const key = await getChatKey();
			if (!key) {
				console.warn(
					"E2EE chat: received encrypted message but no meeting context set",
				);
				return "[Encrypted message]";
			}
			try {
				return await decryptChatMessage(key, raw);
			} catch (e) {
				console.error("E2EE chat: decryption failed", e);
				const errName = e instanceof Error ? e.name : "Error";
				return `[Encrypted: ${errName}]`;
			}
		}
		if (isE2EERequired(sfuClient)) {
			return "[Unencrypted message blocked]";
		}
		return raw;
	}

	function toChatMessage(data: IncomingChatMessage): ChatMessage {
		return {
			id: Date.now() + Math.random(),
			messageId: data.messageId,
			user_id: data.fromUser,
			user_name: data.fromName,
			message: data.message,
			timestamp: data.timestamp,
		};
	}

	const setupChatEvents = (notify: (notification: ChatNotification) => void) => {
		let pendingPinnedMessage: IncomingChatMessage | null = null;
		let pinnedMessageUpdate = 0;

		sfuClient.on("chat:message", async (value: unknown) => {
			const data = normalizeChatMessage(value);
			if (!data) return;
			if (data.fromUser === currentUser.currentUser.value?.user_id) {
				return;
			}

			data.message = await resolvePlaintext(data.message);
			const message = toChatMessage(data);

			chatStore.addMessage(message);

			if (
				!chatStore.isChatOpen &&
				data.fromUser !== currentUser.currentUser.value?.user_id
			) {
				chatStore.hasUnreadMessages = true;

				notify({
					message: data.message,
					fromUser: data.fromUser,
					fromName: data.fromName,
					type: "chat",
				});
				audioNotificationManager.playChatNotification();
			}
		});

		const applyPinnedMessage = async (value: unknown) => {
			const update = ++pinnedMessageUpdate;
			if (!isUnknownRecord(value) || value.pinned == null) {
				pendingPinnedMessage = null;
				chatStore.setPinnedMessage(null);
				return;
			}
			const data = normalizeChatMessage(value.pinned);
			if (!data) return;
			pendingPinnedMessage = data;
			if (isEncryptedChatMessage(data.message) && !(await getChatKey())) return;
			const plaintext = await resolvePlaintext(data.message);
			if (
				isEncryptedChatMessage(data.message) &&
				plaintext.startsWith("[Encrypted")
			) {
				return;
			}
			if (update !== pinnedMessageUpdate) return;
			data.message = plaintext;
			const message = toChatMessage(data);
			if (
				message.messageId &&
				!chatStore.chatMessages.some(
					(existing) => existing.messageId === message.messageId,
				)
			) {
				chatStore.addMessage(message);
			}
			chatStore.setPinnedMessage(message);
			pendingPinnedMessage = null;
		};

		sfuClient.on("chat:pin_updated", applyPinnedMessage);
		sfuClient.on("existing_pinned_message", applyPinnedMessage);
		document.addEventListener("meet:e2ee-context-ready", () => {
			if (pendingPinnedMessage) {
				void applyPinnedMessage({ pinned: pendingPinnedMessage });
			}
			if (canPin() && chatStore.pinnedMessage?.messageId) {
				void pinMessage(chatStore.pinnedMessage.messageId);
			}
		});
		sfuClient.on("chat:restriction_updated", (value: unknown) => {
			if (isUnknownRecord(value) && typeof value.enabled === "boolean") {
				chatStore.hostOnlyChat = value.enabled;
			}
		});

		sfuClient.on("sfu_error", (value: unknown) => {
			if (isUnknownRecord(value) && value.code === "HOST_ONLY_CHAT") {
				toast.error("The host has restricted chat to hosts and co-hosts only.");
				chatStore.hostOnlyChat = true;
			}
		});
	};

	const toggleRestriction = (enabled: boolean) => {
		if (sfuClient.isConnected()) {
			sfuClient.sendEvent("chat:toggle_restriction", { enabled });
		}
	};

	const onSendChat = async (text: string) => {
		try {
			let messageToSend = text;
			if (sfuClient.isConnected()) {
				if (isE2EERequired(sfuClient) || shouldEncryptChat()) {
					const key = await getChatKey();
					if (!key) {
						toast.error(
							"Encrypted chat is not ready yet. Wait for encryption to finish, then try again.",
						);
						return;
					}
					messageToSend = await encryptChatMessage(key, text);
				}
			}

			let timestamp = new Date().toISOString();
			let messageId: string | undefined;
			if (sfuClient.isConnected()) {
				const response = await sfuClient.sendChatMessage(messageToSend, {
					clientId: currentUser.currentUser.value?.user_id,
				});
				timestamp = response.timestamp;
				messageId = response.messageId;
			}

			const message: ChatMessage = {
				id: Date.now() + Math.random(),
				messageId,
				user_id: currentUser.currentUser.value?.user_id as string,
				user_name:
					(currentUser.currentUser.value?.full_name as string) ||
					(currentUser.currentUser.value?.name as string) ||
					(currentUser.currentUser.value?.user_id as string),
				message: text,
				timestamp,
			};
			chatStore.addMessage(message);
		} catch (error) {
			console.error("Failed to send chat message:", error);
			toast.error("Failed to send message");
		}
	};

	const pinMessage = async (
		messageId: string,
		action: "pin" | "unpin" = "pin",
	) => {
		try {
			if (sfuClient.isConnected()) {
				let encryptedMessage: string | undefined;
				if (action === "pin" && shouldEncryptChat()) {
					const message = chatStore.chatMessages.find(
						(item) => item.messageId === messageId,
					);
					const key = await getChatKey();
					if (message && key && !isEncryptedChatMessage(message.message)) {
						encryptedMessage = await encryptChatMessage(key, message.message);
					}
				}
				await sfuClient.sendChatPin(messageId, action, encryptedMessage);
			}
		} catch (error) {
			console.error("Failed to pin chat message:", error);
			toast.error("Failed to pin message");
		}
	};

	return {
		setupChatEvents,
		toggleRestriction,
		onSendChat,
		pinMessage,
	};
}
