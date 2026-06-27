<template>
	<Transition
		enter-active-class="transition-all duration-300 ease-out"
		enter-from-class="opacity-0 transform translate-x-full"
		enter-to-class="opacity-100 transform translate-x-0"
		leave-active-class="transition-all duration-300 ease-in"
		leave-from-class="opacity-100 transform translate-x-0"
		leave-to-class="opacity-0 transform translate-x-full"
	>
		<div v-show="open" class="h-full flex justify-end py-2.5" data-testid="chat-panel-wrapper">
			<div
				class="mr-2 flex h-full w-[calc(100%-0.5rem)] max-w-[380px] flex-col rounded-[10px] bg-surface-gray-1 z-40 overflow-hidden"
				data-testid="chat-panel"
			>
				<div class="flex items-center justify-between gap-3 px-4 py-5 shrink-0">
					<div class="min-w-0 truncate text-sm-medium text-ink-gray-8 tracking-[0.21px]">
						Chat
					</div>
					<div class="flex shrink-0 items-center gap-1">
						<Dropdown
							v-if="isHost || isCohost"
							:options="pollMenuOptions"
						>
							<Button variant="ghost" icon="more-horizontal" class="text-ink-gray-6 hover:bg-surface-gray-2" />
						</Dropdown>

						<Button variant="ghost" class="text-ink-gray-6 hover:bg-surface-gray-2" @click="$emit('close')">
							<lucide-x class="h-4 w-4 text-ink-gray-8" />
						</Button>
					</div>
				</div>

				<div ref="listEl" class="flex-1 overflow-y-auto px-3 py-7" data-testid="chat-messages">
					<div class="flex flex-col gap-5">
						<template v-for="item in chatItems" :key="item.key">
							<div v-if="item.type === 'poll'" class="min-w-0">
								<div class="mb-1 flex items-center gap-1 text-[11px] tracking-[0.11px]">
									<span class="truncate text-ink-gray-7">{{ pollCreatorName(item.poll) }}</span>
									<span class="shrink-0 text-ink-gray-5">· {{ time(item.timestamp) }}</span>
								</div>
								<PollMessageCard :poll="item.poll" :is-guest="isGuest" />
							</div>

							<div
							v-else
							class="flex min-w-0 gap-2"
							:class="item.group.isOwn ? 'justify-end' : 'justify-start'"
						>
							<div
								v-if="!item.group.isOwn"
								class="mt-6 flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-gray-3 text-xs text-ink-gray-7"
							>
								{{ getInitials(item.group.user_name) }}
							</div>

							<div
								class="flex min-w-0 max-w-[314px] flex-col gap-1.5"
								:class="item.group.isOwn ? 'items-end' : 'items-start'"
							>
								<div v-if="!item.group.isOwn" class="flex max-w-full items-center gap-1 text-[11px] tracking-[0.11px]">
									<span class="truncate text-ink-gray-7">{{ item.group.user_name }}</span>
									<span class="shrink-0 text-ink-gray-5">· {{ time(item.group.timestamp) }}</span>
								</div>

								<div class="flex flex-col gap-2.5" :class="item.group.isOwn ? 'items-end' : 'items-start'">
									<div
										v-for="message in item.group.messages"
										:key="message.id"
										class="max-w-full whitespace-pre-wrap rounded-[18px] px-3 py-2.5 text-sm leading-[1.15] tracking-[0.28px] text-ink-gray-8 [overflow-wrap:anywhere]"
										:class="item.group.isOwn ? 'bg-surface-gray-3 text-right' : 'bg-surface-gray-2'"
									>
										<template
											v-for="(token, i) in tokenizeChatMessage(message.message)"
											:key="i"
										>
											<a
												v-if="token.type === 'link'"
												:href="token.url"
												target="_blank"
												rel="noopener noreferrer"
												class="text-ink-blue-5 underline"
											>{{ token.text }}</a>
											<span v-else>{{ token.text }}</span>
										</template>
									</div>
								</div>
							</div>
						</div>
						</template>
					</div>

					<div v-if="chatItems.length === 0" class="mt-8 text-center text-sm text-ink-gray-5">
						No messages yet
					</div>
				</div>

				<form class="relative shrink-0 p-3" @submit.prevent="handleSend">
					<template v-if="canSendMessages">
						<div
							class="flex cursor-text items-center gap-3 rounded-full bg-surface-gray-2 py-2.5 pl-5 pr-3"
							data-testid="chat-input-wrapper"
							@click="focusInput"
						>
							<input
								ref="inputEl"
								v-model="draft"
								@keydown="handleKeydown"
								placeholder="Type a message"
								class="min-w-0 flex-1 appearance-none border-none bg-transparent p-0 text-sm text-ink-gray-8 shadow-none outline-none ring-0 tracking-[0.28px] placeholder:text-ink-gray-5 focus:border-none focus:outline-none focus:ring-0 focus-visible:outline-none"
								autocomplete="off"
								data-testid="chat-input"
							/>
							<Button
								type="submit"
								variant="solid"
								theme="gray"
								class="!h-7 !w-7 shrink-0 !rounded-lg p-0"
								style="background-color: var(--surface-gray-3); color: var(--ink-gray-8)"
								aria-label="Send message"
								data-testid="chat-send"
							>
								<template #icon>
									<lucide-send class="h-4 w-4" />
								</template>
							</Button>
						</div>
						<EmojiPicker
							:show="showEmojiPicker"
							:filtered-emojis="filteredEmojis"
							:selected-index="selectedEmojiIndex"
							@select="addEmoji"
						/>
					</template>
					<div v-else class="m-2 rounded-lg border border-outline-gray-2 bg-surface-gray-2 py-3 text-center text-sm text-ink-gray-5">
						The host has restricted chat to hosts and co-hosts only.
					</div>
				</form>
				<CreatePollModal
					v-model="showPollModal"
					@submit="handlePollSubmit"
				/>
			</div>
		</div>
	</Transition>
</template>

<script setup lang="ts">
import data from "@emoji-mart/data";
import { init, SearchIndex } from "emoji-mart";
import { Button, Dropdown } from "frappe-ui";
import {
	computed,
	inject,
	markRaw,
	nextTick,
	onMounted,
	ref,
	watch,
} from "vue";
import { tokenizeChatMessage } from "../utils/chatMessageTokens";
import { getInitials } from "../utils/text";
import EmojiPicker from "./EmojiPicker.vue";
import { usePollStore } from "../composables/usePollStore";
import type { PollPayloadFE } from "../types";
import CreatePollModal from "./CreatePollModal.vue";
import PollMessageCard from "./PollMessageCard.vue";
import LucideChartColumn from "~icons/lucide/chart-column";

interface ChatMessage {
	id: string | number;
	user_id: string;
	user_name: string;
	message: string;
	timestamp: string;
}

interface EmojiItem {
	emoji: string;
	keywords: string[];
}

interface MessageGroup {
	id: string | number;
	user_id: string;
	user_name: string;
	timestamp: string;
	isOwn: boolean;
	messages: ChatMessage[];
}

type ChatItem = {
	type: 'poll';
	key: string;
	poll: PollPayloadFE;
	timestamp: string;
} | {
	type: 'message';
	key: string;
	group: MessageGroup;
	timestamp: string;
};

const props = defineProps<{
	open?: boolean;
	userId?: string;
	userName?: string;
	messages?: ChatMessage[];
	isHost?: boolean;
	isCohost?: boolean;
	isGuest?: boolean;
	hostOnlyChat?: boolean;
}>();

const pollStore = usePollStore();
const pollService = inject("poll") as any;
const showPollModal = ref(false);

const activePolls = computed(() => pollStore.activePolls);
const pollMenuOptions = [
	{
		label: "Create Poll",
		icon: markRaw(LucideChartColumn),
		onClick: () => {
			showPollModal.value = true;
		},
	},
];

const handlePollSubmit = (payload: {
	question: string;
	options: { text: string }[];
}) => {
	if (pollService) {
		pollService.createPoll(payload.question, payload.options);
		showPollModal.value = false;
	} else {
        console.error("ERROR: pollService is undefined! The inject failed.");
    }
};

const emit = defineEmits<{
	close: [];
	send: [text: string];
}>();
const listEl = ref<HTMLElement | null>(null);
const inputEl = ref<HTMLInputElement | null>(null);
const draft = ref("");
const selectedEmojiIndex = ref(0);
const filteredEmojis = ref<EmojiItem[]>([]);
const isEmojiDataReady = ref(false);

const canSendMessages = computed(() => {
	if (!props.hostOnlyChat) return true;
	return props.isHost || props.isCohost;
});

const defaultEmojis: EmojiItem[] = [
	{ emoji: "😀", keywords: ["smile"] },
	{ emoji: "😂", keywords: ["laugh"] },
	{ emoji: "❤️", keywords: ["heart"] },
	{ emoji: "👍", keywords: ["thumbs up"] },
	{ emoji: "👏", keywords: ["clap"] },
	{ emoji: "🔥", keywords: ["fire"] },
	{ emoji: "💯", keywords: ["100"] },
	{ emoji: "🙌", keywords: ["raised hands"] },
	{ emoji: "😊", keywords: ["blush"] },
	{ emoji: "🎉", keywords: ["party"] },
];

const recentlyUsedEmojis = ref<EmojiItem[]>(defaultEmojis.slice());

onMounted(async () => {
	await scrollToBottom();
	try {
		await init({ data });
		isEmojiDataReady.value = true;

		const stored = localStorage.getItem("recentEmojis");
		if (stored) {
			try {
				recentlyUsedEmojis.value = JSON.parse(stored);
			} catch {
				recentlyUsedEmojis.value = defaultEmojis.slice();
			}
		} else {
			recentlyUsedEmojis.value = defaultEmojis.slice();
		}
	} catch (error) {
		console.error("Failed to initialize emoji data:", error);
	}
});

const groupedMessages = computed<MessageGroup[]>(() => {
	const msgs = props.messages;
	if (!msgs || msgs.length === 0) return [];

	const groups: MessageGroup[] = [];
	let currentGroup: MessageGroup | null = null;

	for (const message of msgs) {
		const isOwn = message.user_id === props.userId;
		const shouldStartNewGroup =
			!currentGroup ||
			currentGroup.user_id !== message.user_id ||
			currentGroup.isOwn !== isOwn ||
			(currentGroup.messages.length > 0 &&
				Math.abs(
					new Date(message.timestamp).getTime() -
						new Date(currentGroup.messages[0].timestamp).getTime(),
				) > 300000);

		if (shouldStartNewGroup) {
			currentGroup = {
				id: message.id,
				user_id: message.user_id,
				user_name: message.user_name,
				timestamp: message.timestamp,
				isOwn,
				messages: [message],
			};
			groups.push(currentGroup);
		} else {
			currentGroup.messages.push(message);
		}
	}

	return groups;
});

const chatItems = computed<ChatItem[]>(() => {
	const items: ChatItem[] = [];
	for (const poll of activePolls.value) {
		items.push({
			type: 'poll',
			key: `poll-${poll.pollId}`,
			poll,
			timestamp: poll.createdAt || '1970-01-01T00:00:00.000Z',
		});
	}
	for (const group of groupedMessages.value) {
		items.push({
			type: 'message',
			key: `msg-${group.id}`,
			group,
			timestamp: group.timestamp,
		});
	}
	items.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
	return items;
});

function time(ts) {
	try {
		return new Date(ts).toLocaleTimeString([], {
			hour: "2-digit",
			minute: "2-digit",
			hour12: true,
		});
	} catch {
		return "";
	}
}

function pollCreatorName(poll: PollPayloadFE) {
	if (poll.createdBy === props.userId) return props.userName || "You";
	return poll.createdByName || poll.createdBy;
}

const showEmojiPicker = computed(() => {
	const colonIndex = draft.value.lastIndexOf(":");
	if (colonIndex === -1) return false;
	const afterColon = draft.value.slice(colonIndex + 1);
	return !afterColon.includes(" ") && /^[a-zA-Z0-9]*$/.test(afterColon);
});

const emojiQuery = computed(() => {
	const colonIndex = draft.value.lastIndexOf(":");
	if (colonIndex === -1) return "";
	const afterColon = draft.value.slice(colonIndex + 1);
	if (afterColon.includes(" ")) return "";
	// don't allow special characters in emoji query
	// or while pasting url you'll have emoji picker popup
	if (!/^[a-zA-Z0-9]*$/.test(afterColon)) return "";
	return afterColon;
});

watch(emojiQuery, async (query) => {
	if (!query) {
		filteredEmojis.value = recentlyUsedEmojis.value;
		selectedEmojiIndex.value = 0;
		return;
	}

	if (!isEmojiDataReady.value) {
		filteredEmojis.value = [];
		return;
	}
	try {
		const results = await SearchIndex.search(query, {
			maxResults: 10,
			caller: undefined as unknown as string,
		});
		filteredEmojis.value = results.map((emoji) => ({
			emoji: emoji.skins[0].native,
			keywords: emoji.keywords || [],
		}));
		if (selectedEmojiIndex.value >= filteredEmojis.value.length) {
			selectedEmojiIndex.value = 0;
		}
	} catch (error) {
		filteredEmojis.value = [];
	}
});

// Watch for when emoji picker should be shown
watch(showEmojiPicker, (isShown) => {
	if (isShown && emojiQuery.value === "") {
		// Show recently used emojis when picker first opens with just :
		filteredEmojis.value = recentlyUsedEmojis.value;
		selectedEmojiIndex.value = 0;
	}
});
function handleKeydown(event) {
	if (!showEmojiPicker.value) return;
	const { key } = event;
	if (key === "ArrowDown") {
		event.preventDefault();
		selectedEmojiIndex.value =
			(selectedEmojiIndex.value + 1) % filteredEmojis.value.length;
	} else if (key === "ArrowUp") {
		event.preventDefault();
		selectedEmojiIndex.value =
			selectedEmojiIndex.value === 0
				? filteredEmojis.value.length - 1
				: selectedEmojiIndex.value - 1;
	} else if (key === "Enter") {
		event.preventDefault();
		if (filteredEmojis.value.length > 0) {
			addEmoji(filteredEmojis.value[selectedEmojiIndex.value]);
		}
	} else if (key === "Escape") {
		event.preventDefault();
		// Remove the last colon to hide picker
		const colonIndex = draft.value.lastIndexOf(":");
		if (colonIndex > -1) {
			draft.value = draft.value.slice(0, colonIndex);
		}
	}
}

function addEmoji(item) {
	const emoji = item.emoji;
	const colonIndex = draft.value.lastIndexOf(":");
	const beforeColon = draft.value.slice(0, colonIndex);
	const afterColon = draft.value.slice(colonIndex + 1);

	if (afterColon) {
		// Replace :<query> with emoji
		draft.value = beforeColon + emoji;
	} else {
		// Replace : with emoji
		draft.value = beforeColon + emoji;
	}

	const existingIndex = recentlyUsedEmojis.value.findIndex(
		(e) => e.emoji === emoji,
	);
	if (existingIndex > -1) {
		recentlyUsedEmojis.value.splice(existingIndex, 1);
	}
	recentlyUsedEmojis.value.unshift(item);
	if (recentlyUsedEmojis.value.length > 10) {
		recentlyUsedEmojis.value = recentlyUsedEmojis.value.slice(0, 10);
	}
	localStorage.setItem(
		"recentEmojis",
		JSON.stringify(recentlyUsedEmojis.value),
	);
}

function handleSend() {
	if (showEmojiPicker.value && filteredEmojis.value.length > 0) {
		addEmoji(filteredEmojis.value[selectedEmojiIndex.value]);
		return;
	}
	const text = draft.value.trim();
	if (!canSendMessages.value) return;
	if (!text) return;
	emit("send", text);
	draft.value = "";
}

function focusInput() {
	inputEl.value?.focus();
}

async function scrollToBottom() {
	await nextTick();
	const el = listEl.value;
	el.scrollTop = el.scrollHeight;
}

watch([chatItems], scrollToBottom, { deep: true });
</script>
