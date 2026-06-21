<template>
	<Transition
		enter-active-class="transition-all duration-300 ease-out"
		enter-from-class="opacity-0 transform translate-x-full"
		enter-to-class="opacity-100 transform translate-x-0"
		leave-active-class="transition-all duration-300 ease-in"
		leave-from-class="opacity-100 transform translate-x-0"
		leave-to-class="opacity-0 transform translate-x-full"
	>
		<div v-show="open" class="h-full py-4 flex justify-end" data-testid="chat-panel-wrapper">
			<div
				class="w-80 sm:w-96 bg-white border border-gray-200 shadow-xl flex flex-col z-40 h-full rounded-lg mr-4"
				data-testid="chat-panel"
			>
				<div class="flex items-center justify-between p-4 border-b border-gray-200">
					<div class="text-gray-900 text-base-medium">Chat</div>
					<lucide-x
						@click="$emit('close')"
						class="w-4 h-4 text-gray-900 cursor-pointer hover:text-gray-600"
					/>
				</div>

				<div ref="listEl" class="flex-1 overflow-y-auto p-4 space-y-4" data-testid="chat-messages">
					<div v-for="group in groupedMessages" :key="group.id" class="min-w-0">
						<div class="text-xs flex items-center gap-2">
							<span class="truncate font-medium">{{ group.user_name }}</span>
							<span class="text-gray-600">{{ time(group.timestamp) }}</span>
						</div>
						<div class="my-1 space-y-2">
							<div
								v-for="message in group.messages"
								:key="message.id"
								class="text-sm text-gray-900 whitespace-pre-wrap [overflow-wrap:anywhere] leading-4"
							>
								<span v-html="linkify(message.message)"></span>
							</div>
						</div>
					</div>
					<div v-if="resolvedMessages.length === 0" class="text-gray-500 text-sm text-center mt-8">
						No messages yet
					</div>
				</div>

				<form class="p-2 relative" @submit.prevent="handleSend">
					<template v-if="canSendMessages">
						<div class="flex gap-2">
							<FormControl
								size="md"
								v-model="draft"
								@keydown="handleKeydown"
								placeholder="Type a message"
								class="flex-1"
								autocomplete="off"
								data-testid="chat-input"
							/>
							<Button size="md" type="submit" variant="outline" data-testid="chat-send"> Send </Button>
						</div>
						<EmojiPicker
							:show="showEmojiPicker"
							:filtered-emojis="filteredEmojis"
							:selected-index="selectedEmojiIndex"
							@select="addEmoji"
						/>
					</template>
					<div v-else class="text-center text-sm text-gray-500 py-3 bg-gray-50 rounded border border-gray-200 m-2">
						The host has restricted chat to hosts and co-hosts only.
					</div>
				</form>
			</div>
		</div>
	</Transition>
</template>

<script setup lang="ts">
import data from "@emoji-mart/data";
import { init, SearchIndex } from "emoji-mart";
import { Button, FormControl } from "frappe-ui";
import {
	computed,
	nextTick,
	onMounted,
	type Ref,
	ref,
	toRefs,
	watch,
} from "vue";
import EmojiPicker from "./EmojiPicker.vue";

interface ChatMessage {
	id: string | number;
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
	user_name: string;
	timestamp: string;
	messages: ChatMessage[];
}

const props = defineProps<{
	open?: boolean;
	userId?: string;
	userName?: string;
	messages?: ChatMessage[] | { value: ChatMessage[] };
	isHost?: boolean;
	isCohost?: boolean;
	hostOnlyChat?: boolean;
}>();

const emit = defineEmits<{
	close: [];
	send: [text: string];
}>();
const listEl = ref<HTMLElement | null>(null);
const { messages } = toRefs(props) as {
	messages: Ref<ChatMessage[] | { value: ChatMessage[] }>;
};
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

const resolvedMessages = computed<ChatMessage[]>(() => {
	const m = messages.value;
	if (!m) return [];
	if (Array.isArray(m)) return m;
	return m.value || [];
});

const groupedMessages = computed<MessageGroup[]>(() => {
	if (resolvedMessages.value.length === 0) return [];

	const groups: MessageGroup[] = [];
	let currentGroup: MessageGroup | null = null;

	for (const message of resolvedMessages.value) {
		const shouldStartNewGroup =
			!currentGroup ||
			currentGroup.user_name !== message.user_name ||
			(currentGroup.messages.length > 0 &&
				Math.abs(
					new Date(message.timestamp).getTime() -
						new Date(currentGroup.messages[0].timestamp).getTime(),
				) > 300000);

		if (shouldStartNewGroup) {
			currentGroup = {
				id: message.id,
				user_name: message.user_name,
				timestamp: message.timestamp,
				messages: [message],
			};
			groups.push(currentGroup);
		} else {
			currentGroup.messages.push(message);
		}
	}

	return groups;
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

function linkify(text) {
	const urlRegex = /(https?:\/\/[^\s]+)/g;
	return text.replace(
		urlRegex,
		'<a href="$1" target="_blank" rel="noopener noreferrer" class="text-blue-500 underline">$1</a>',
	);
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

async function scrollToBottom() {
	await nextTick();
	const el = listEl.value;
	el.scrollTop = el.scrollHeight;
}

watch(messages, scrollToBottom, { deep: true });
</script>
