import { toast } from "frappe-ui";
import { E2EEMeeting } from "../utils/media/E2EEMeeting";
import type { SFUClient } from "../utils/SFUClient";
import type { CurrentUser } from "./useCurrentUser";
import { usePollStore } from "./usePollStore";
import { useChatStore } from "./useChatStore";
import { PollPayloadFE } from "../types";
import { getErrorMessage } from "../utils/error";
import audioNotificationManager from "../utils/audioNotifications";

interface PollAPI {
	setupPollEvents: (notificationQueue?: unknown) => void;
	createPoll: (question: string, options: { text: string }[]) => void;
	submitVote: (pollId: string, optionId: string) => void;
}

const E2EE_POLL_PREFIX = "e2ee:";

function isEncryptedPollText(text: string): boolean {
	return typeof text === "string" && text.startsWith(E2EE_POLL_PREFIX);
}

function hasEncryptedPollText(poll: PollPayloadFE): boolean {
	return (
		isEncryptedPollText(poll.question) ||
		poll.options.some((option) => isEncryptedPollText(option.text))
	);
}

async function encryptPollText(key: CryptoKey, text: string): Promise<string> {
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
	return E2EE_POLL_PREFIX + btoa(binary);
}

async function decryptPollText(key: CryptoKey, encryptedText: string): Promise<string> {
	const payload = encryptedText.slice(E2EE_POLL_PREFIX.length);
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

async function decryptPollPayload(
	key: CryptoKey | null,
	poll: PollPayloadFE,
): Promise<PollPayloadFE | null> {
	let question = poll.question;
	if (isEncryptedPollText(question)) {
		if (!key) return null;
		try {
			question = await decryptPollText(key, question);
		} catch {
			return null;
		}
	}
	const options = await Promise.all(
		poll.options.map(async (opt) => {
			let text = opt.text;
			if (isEncryptedPollText(text)) {
				if (!key) return null;
				try {
					text = await decryptPollText(key, text);
				} catch {
					return null;
				}
			}
			return { ...opt, text };
		}),
	);
	if (options.some((option) => option === null)) return null;
	return { ...poll, question, options };
}

async function encryptPollPayload(key: CryptoKey | null, question: string, options: { text: string }[]) {
	if (!key) return { question, options };
	const encryptedQuestion = await encryptPollText(key, question);
	const encryptedOptions = await Promise.all(
		options.map(async (opt) => ({ text: await encryptPollText(key, opt.text) })),
	);
	return { question: encryptedQuestion, options: encryptedOptions };
}

async function encryptExistingPollPayload(key: CryptoKey, poll: PollPayloadFE) {
	return {
		pollId: poll.pollId,
		question: await encryptPollText(key, poll.question),
		options: await Promise.all(
			poll.options.map(async (opt) => ({
				id: opt.id,
				text: await encryptPollText(key, opt.text),
			})),
		),
	};
}

export function usePoll(deps: {
	pollStore: ReturnType<typeof usePollStore>;
	currentUser: CurrentUser;
	sfuClient: SFUClient;
}): PollAPI {
	const { pollStore, currentUser, sfuClient } = deps;
	const chatStore = useChatStore();

	const currentUserId = () => currentUser.currentUser.value?.user_id;
	const currentUserName = () =>
		(currentUser.currentUser.value?.full_name as string) ||
		(currentUser.currentUser.value?.name as string) ||
		(currentUser.currentUser.value?.user_id as string) ||
		"";

	const syncEncryptedPolls = async (key: CryptoKey) => {
		if (!sfuClient.isConnected() || !sfuClient.isE2EERequired?.()) return;
		const plaintextPolls = pollStore.activePolls.filter(
			(poll) => !hasEncryptedPollText(poll),
		);
		await Promise.all(
			plaintextPolls.map(async (poll) => {
				const payload = await encryptExistingPollPayload(key, poll);
				const response = await sfuClient.sendRequest("poll:sync_encrypted", payload) as {
					success?: boolean;
				};
				if (!response?.success) return;
			}),
		);
	};

	const fetchExistingPolls = async () => {
		if (!sfuClient.isConnected()) return;
		const key = await E2EEMeeting.instance.getE2EEPollKey();
		if (!key && sfuClient.isE2EERequired?.()) return;
		try {
			const response = (await sfuClient.sendRequest("get_existing_polls", {})) as {
				success: boolean;
				polls?: PollPayloadFE[];
			};
			if (response.success && response.polls) {
				if (!key && response.polls.some(hasEncryptedPollText)) return;
				const decrypted = (
					await Promise.all(
						response.polls.map((p) => decryptPollPayload(key, p)),
					)
				).filter((poll): poll is PollPayloadFE => poll !== null);
				if (decrypted.length === 0 && response.polls.length > 0) return;
				pollStore.setExistingPolls(decrypted);
			}
		} catch (error) {
			console.error("Failed to fetch existing polls:", error);
		}
	};

	const syncThenFetchExistingPolls = async () => {
		const key = await E2EEMeeting.instance.getE2EEPollKey();
		if (key) {
			await syncEncryptedPolls(key);
		}
		await fetchExistingPolls();
	};

	const setupPollEvents = (notificationQueue?: unknown) => {
		sfuClient.on("poll:new", async (data: unknown) => {
			const key = await E2EEMeeting.instance.getE2EEPollKey();
			const payload = data as PollPayloadFE;
			if (!key && hasEncryptedPollText(payload)) return;
			const poll = await decryptPollPayload(key, payload);
			if (!poll) return;
			pollStore.addPoll(poll);
			if (poll.createdBy !== currentUserId() && !chatStore.isChatOpen) {
				chatStore.hasUnreadMessages = true;
				(
					notificationQueue as { addNotification?: (n: unknown) => void }
				)?.addNotification?.({
					message: poll.question,
					fromUser: poll.createdBy,
					fromName: poll.createdByName || poll.createdBy,
					timestamp: poll.createdAt || new Date().toISOString(),
					type: "poll",
				});
				audioNotificationManager.playChatNotification();
			}
		});

		sfuClient.on("poll:update", async (data: unknown) => {
			const key = await E2EEMeeting.instance.getE2EEPollKey();
			const payload = data as PollPayloadFE;
			if (!key && hasEncryptedPollText(payload)) return;
			const poll = await decryptPollPayload(key, payload);
			if (!poll) return;
			pollStore.updatePoll(poll);
		});

		sfuClient.on("existing_polls", async (data: unknown) => {
			const key = await E2EEMeeting.instance.getE2EEPollKey();
			const payload = data as { polls: PollPayloadFE[] };
			if (!key && payload.polls.some(hasEncryptedPollText)) return;
			const decrypted = (
				await Promise.all(
					payload.polls.map((p) => decryptPollPayload(key, p)),
				)
			).filter((poll): poll is PollPayloadFE => poll !== null);
			if (decrypted.length === 0 && payload.polls.length > 0) return;
			pollStore.setExistingPolls(decrypted);
		});

		document.addEventListener("meet:e2ee-context-ready", () => {
			void syncThenFetchExistingPolls();
		});

		if (E2EEMeeting.instance.hasMeetingContext()) {
			void syncThenFetchExistingPolls();
		}
	};

	const createPoll = async (question: string, options: { text: string }[]) => {
		if (!sfuClient.isConnected()) {
			toast.error("Not connected to meeting server");
			return;
		}

		try {
			const key = E2EEMeeting.instance.hasMeetingContext()
				? await E2EEMeeting.instance.getE2EEPollKey()
				: null;
			const payload = {
				...(await encryptPollPayload(key, question, options)),
				createdByName: currentUserName(),
			};

			const response = (await sfuClient.sendRequest("poll:create", payload)) as any;

			if (response && response.success) {
				if (response.poll) {
					const decrypted = await decryptPollPayload(key, response.poll);
					if (!decrypted) return;
					pollStore.addPoll(decrypted);
				}
				toast.success("Poll created!");
			} else {
				toast.error(response?.error || "Failed to create poll");
			}
		} catch (error) {
			console.error("Failed to create poll:", error);
			toast.error(getErrorMessage(error) || "Failed to create poll");
		}
	};

	const submitVote = async (pollId: string, optionId: string) => {
		if (!sfuClient.isConnected()) {
			toast.error("Not connected to meeting server");
			return;
		}

		try {
			const response = await sfuClient.sendRequest("poll:vote", {
				pollId,
				optionId,
			}) as { success: boolean; error?: string };

			if (!response.success) {
				throw new Error(response.error ?? "Failed to submit vote");
			}

			pollStore.markPollAsVoted(pollId);
		} catch (error) {
			console.error("Failed to submit vote:", error);
			toast.error((error as Error).message);
			throw error;
		}
	};

	return {
		setupPollEvents,
		createPoll,
		submitVote,
	};
}
