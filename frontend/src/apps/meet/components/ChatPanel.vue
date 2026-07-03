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
							<Button variant="ghost" icon="lucide-more-horizontal" class="text-ink-gray-6 hover:bg-surface-gray-2" />
						</Dropdown>

						<Button variant="ghost" class="text-ink-gray-6 hover:bg-surface-gray-2" @click="$emit('close')">
							<lucide-x class="h-4 w-4 text-ink-gray-8" />
						</Button>
					</div>
				</div>

				<div ref="listEl" class="flex-1 overflow-y-auto px-3 py-7" data-testid="chat-messages">
					<div class="flex flex-col gap-5">
						<template v-for="item in chatItems" :key="item.key">
							<div
								v-if="item.type === 'poll'"
								class="flex min-w-0 gap-2"
								:class="item.poll.createdBy === userId ? 'justify-end' : 'justify-start'"
							>
								<Avatar
									v-if="item.poll.createdBy !== userId"
									size="lg"
									:label="item.poll.createdByName || item.poll.createdBy"
									class="mt-6 shrink-0"
								/>
								<div
									class="flex min-w-0 max-w-[314px] flex-col gap-1.5"
									:class="item.poll.createdBy === userId ? 'items-end' : 'items-start'"
								>
									<div class="flex max-w-full items-center gap-1 text-[11px] tracking-[0.11px]">
										<template v-if="item.poll.createdBy !== userId">
											<span class="truncate text-ink-gray-7">{{ pollCreatorName(item.poll) }}</span>
											<span class="shrink-0 text-ink-gray-5">·</span>
										</template>
										<span class="shrink-0 text-ink-gray-5">{{ time(item.timestamp) }}</span>
									</div>
									<PollMessageCard :poll="item.poll" :is-guest="isGuest" />
								</div>
							</div>

							<div
							v-else
							class="flex min-w-0 gap-2"
							:class="item.group.isOwn ? 'justify-end' : 'justify-start'"
						>
							<Avatar
								v-if="!item.group.isOwn"
								size="lg"
								:label="item.group.user_name"
								class="mt-6 shrink-0"
							/>

							<div
								class="flex min-w-0 max-w-[314px] flex-col gap-1.5"
								:class="item.group.isOwn ? 'items-end' : 'items-start'"
							>
								<div v-if="!item.group.isOwn" class="flex max-w-full items-center gap-1 text-[11px] tracking-[0.11px]">
									<span class="truncate text-ink-gray-7">{{ item.group.user_name }}</span>
									<span class="shrink-0 text-ink-gray-5">· {{ time(item.group.timestamp) }}</span>
								</div>
								<span v-else class="text-[11px] tracking-[0.11px] text-ink-gray-5">{{ time(item.group.timestamp) }}</span>

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
							class="flex cursor-text items-end gap-2 rounded-lg border border-outline-gray-2 bg-surface-gray-1 px-2.5 py-2 shadow-sm transition-colors focus-within:border-outline-gray-3"
							data-testid="chat-input-wrapper"
							@click="focusInput"
						>
							<Editor
								ref="editorRef"
								v-model="draft"
								placeholder="Type a message"
								:extensions="editorExtensions"
							>
								<template #default="{ editor }">
									<EditorContent
										:editor="editor"
										class="chat-composer-editor min-w-0 flex-1 text-sm text-ink-gray-8 tracking-[0.28px]"
										data-testid="chat-input"
									/>
								</template>
							</Editor>
							<Button
								type="submit"
								variant="subtle"
								theme="gray"
								class="!h-7 !w-7 shrink-0 !rounded-md p-0"
								aria-label="Send message"
								data-testid="chat-send"
							>
								<template #icon>
									<lucide-send class="h-4 w-4" />
								</template>
							</Button>
						</div>
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
import { Extension } from "@tiptap/core";
import { Avatar, Button, Dropdown } from "frappe-ui";
import { Editor, EditorContent, CommentKit } from "frappe-ui/editor";
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
const editorRef = ref();
const draft = ref("");

const editorExtensions = computed(() => [
	CommentKit.configure({
		starterKit: { heading: false },
		emoji: {},
		mention: false,
		tag: false,
		image: false,
		video: false,
		table: false,
		contentPaste: false,
	}),
	Extension.create({
		name: "enterToSend",
		addKeyboardShortcuts() {
			return {
				Enter: ({ editor }) => {
					if (editor.view.dom.querySelector(".suggestion")) return false;
					handleSend();
					return true;
				},
			};
		},
	}),
]);

const canSendMessages = computed(() => {
	if (!props.hostOnlyChat) return true;
	return props.isHost || props.isCohost;
});

onMounted(async () => {
	await scrollToBottom();
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

function handleSend() {
	const editor = editorRef.value?.editor;
	if (!editor) return;
	const text = editor.getText().trim();
	if (!canSendMessages.value) return;
	if (!text) return;
	emit("send", text);
	draft.value = "";
	nextTick(() => editor.commands.focus());
}

function focusInput() {
	editorRef.value?.editor?.commands.focus("end");
}

async function scrollToBottom() {
	await nextTick();
	const el = listEl.value;
	el.scrollTop = el.scrollHeight;
}

watch([chatItems], scrollToBottom, { deep: true });
</script>

<style scoped>
:deep(.chat-composer-editor) {
	min-height: 20px;
	max-height: 48px;
	overflow-y: auto;
	background: transparent;
	caret-color: var(--ink-gray-8);
}

:deep(.chat-composer-editor p) {
	margin: 0;
}

:deep(.chat-composer-editor p.is-editor-empty::before) {
	color: var(--ink-gray-5);
}

:deep(.chat-composer-editor.ProseMirror-focused) {
	outline: none;
}
</style>
