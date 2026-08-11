import { toast } from "frappe-ui";
import { E2EEMeeting } from "../utils/media/E2EEMeeting";
import type { SFUClient } from "../utils/SFUClient";
import type { CurrentUser } from "./useCurrentUser";
import { usePollStore } from "./usePollStore";
import { useChatStore } from "./useChatStore";
import { PollPayloadFE } from "../types";
import { getErrorMessage } from "../utils/error";
import audioNotificationManager from "../utils/audioNotifications";
import type { InjectionKey } from "vue";

export interface PollAPI {
	setupPollEvents: (notify: (notification: PollNotification) => void) => void;
	createPoll: (question: string, options: { text: string }[]) => Promise<void>;
	submitVote: (pollId: string, optionId: string) => Promise<void>;
}

export const pollKey: InjectionKey<PollAPI> = Symbol("poll");

interface PollNotification {
	message: string;
	fromUser: string;
	fromName: string;
	type: "poll";
}

const E2EE_POLL_PREFIX = "e2ee:";

interface PollResponse {
	success: boolean;
	error?: string;
	poll?: PollPayloadFE;
	polls?: PollPayloadFE[];
}

function isPollOption(value: unknown): value is PollPayloadFE["options"][number] {
	return (
		typeof value === "object" &&
		value !== null &&
		"id" in value &&
		typeof value.id === "string" &&
		"text" in value &&
		typeof value.text === "string" &&
		"votes" in value &&
		typeof value.votes === "number"
	);
}

function isPollPayload(value: unknown): value is PollPayloadFE {
	return (
		typeof value === "object" &&
		value !== null &&
		"pollId" in value &&
		typeof value.pollId === "string" &&
		"createdBy" in value &&
		typeof value.createdBy === "string" &&
		(!("createdByName" in value) ||
			value.createdByName === undefined ||
			typeof value.createdByName === "string") &&
		"question" in value &&
		typeof value.question === "string" &&
		"options" in value &&
		Array.isArray(value.options) &&
		value.options.every(isPollOption) &&
		"isActive" in value &&
		typeof value.isActive === "boolean" &&
		(!("hasVoted" in value) ||
			value.hasVoted === undefined ||
			typeof value.hasVoted === "boolean") &&
		"createdAt" in value &&
		typeof value.createdAt === "string"
	);
}

function isPollResponse(value: unknown): value is PollResponse {
	return (
		typeof value === "object" &&
		value !== null &&
		"success" in value &&
		typeof value.success === "boolean" &&
		(!("error" in value) ||
			value.error === undefined ||
			typeof value.error === "string") &&
		(!("poll" in value) || value.poll === undefined || isPollPayload(value.poll)) &&
		(!("polls" in value) ||
			value.polls === undefined ||
			(Array.isArray(value.polls) && value.polls.every(isPollPayload)))
	);
}

function isExistingPollsEvent(value: unknown): value is { polls: PollPayloadFE[] } {
	return (
		typeof value === "object" &&
		value !== null &&
		"polls" in value &&
		Array.isArray(value.polls) &&
		value.polls.every(isPollPayload)
	);
}

function requirePollResponse(value: unknown, operation: string): PollResponse {
	if (!isPollResponse(value)) throw new Error(`Invalid ${operation} response`);
	return value;
}

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
	if (
		!options.every(
			(option): option is PollPayloadFE["options"][number] => option !== null,
		)
	) return null;
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
				const response = requirePollResponse(
					await sfuClient.sendRequest("poll:sync_encrypted", payload),
					"poll sync",
				);
				if (!response?.success) return;
			}),
		);
	};

	const fetchExistingPolls = async () => {
		if (!sfuClient.isConnected()) return;
		const key = await E2EEMeeting.instance.getE2EEPollKey();
		if (!key && sfuClient.isE2EERequired?.()) return;
		try {
			const response = requirePollResponse(
				await sfuClient.sendRequest("get_existing_polls", {}),
				"existing polls",
			);
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

	const setupPollEvents = (notify: (notification: PollNotification) => void) => {
		sfuClient.on("poll:new", async (data: unknown) => {
			if (!isPollPayload(data)) return;
			const key = await E2EEMeeting.instance.getE2EEPollKey();
			if (!key && hasEncryptedPollText(data)) return;
			const poll = await decryptPollPayload(key, data);
			if (!poll) return;
			pollStore.addPoll(poll);
			if (poll.createdBy !== currentUserId() && !chatStore.isChatOpen) {
				chatStore.hasUnreadMessages = true;
				notify({
					message: poll.question,
					fromUser: poll.createdBy,
					fromName: poll.createdByName || poll.createdBy,
					type: "poll",
				});
				audioNotificationManager.playChatNotification();
			}
		});

		sfuClient.on("poll:update", async (data: unknown) => {
			if (!isPollPayload(data)) return;
			const key = await E2EEMeeting.instance.getE2EEPollKey();
			if (!key && hasEncryptedPollText(data)) return;
			const poll = await decryptPollPayload(key, data);
			if (!poll) return;
			pollStore.updatePoll(poll);
		});

		sfuClient.on("existing_polls", async (data: unknown) => {
			if (!isExistingPollsEvent(data)) return;
			const key = await E2EEMeeting.instance.getE2EEPollKey();
			if (!key && data.polls.some(hasEncryptedPollText)) return;
			const decrypted = (
				await Promise.all(
					data.polls.map((p) => decryptPollPayload(key, p)),
				)
			).filter((poll): poll is PollPayloadFE => poll !== null);
			if (decrypted.length === 0 && data.polls.length > 0) return;
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

			const response = requirePollResponse(
				await sfuClient.sendRequest("poll:create", payload),
				"poll creation",
			);

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
			const response = requirePollResponse(
				await sfuClient.sendRequest("poll:vote", { pollId, optionId }),
				"poll vote",
			);

			if (!response.success) {
				throw new Error(response.error ?? "Failed to submit vote");
			}

			pollStore.markPollAsVoted(pollId);
		} catch (error) {
			console.error("Failed to submit vote:", error);
			toast.error(getErrorMessage(error));
			throw error;
		}
	};

	return {
		setupPollEvents,
		createPoll,
		submitVote,
	};
}
