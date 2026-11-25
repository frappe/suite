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
            {{ __('Chat') }}
          </div>
          <div class="flex shrink-0 items-center gap-1">
            <Dropdown v-if="isHost || isCohost" :options="pollMenuOptions">
              <Button variant="ghost" icon="lucide-more-horizontal" />
            </Dropdown>

            <Button variant="ghost" icon="lucide-x" @click="$emit('close')" />
          </div>
        </div>

        <div
          v-if="pinnedMessage"
          class="group mx-3 mb-2 flex shrink-0 items-center gap-2 rounded-[18px] bg-surface-gray-2 px-3 py-2.5"
          role="button"
          tabindex="0"
          data-testid="pinned-message-banner"
          @click="scrollToMessage(pinnedMessage.messageId)"
          @keydown.enter.prevent="scrollToMessage(pinnedMessage.messageId)"
          @keydown.space.prevent="scrollToMessage(pinnedMessage.messageId)"
        >
          <span class="lucide-pin size-3.5 shrink-0 text-ink-gray-5" aria-hidden="true" />
          <div class="min-w-0 flex-1">
            <div class="truncate text-[11px] tracking-[0.11px] text-ink-gray-5">
              {{ pinnedMessage.user_name }}
            </div>
            <div class="mt-0.5 truncate text-sm tracking-[0.21px] text-ink-gray-8">
              {{ pinnedMessage.message }}
            </div>
          </div>
          <Button
            v-if="canPin"
            variant="ghost"
            size="xs"
            icon="lucide-pin-off"
            class="!bg-surface-gray-1 !text-ink-gray-5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 hover:!bg-surface-gray-3 hover:!text-ink-gray-8"
            :label="__('Unpin')"
            :tooltip="__('Unpin message')"
            @click.stop="emit('unpin')"
          />
        </div>

        <div ref="listEl" class="flex-1 overflow-y-auto px-3 py-7">
          <p
            v-if="hasUnavailableEncryptedHistory"
            role="status"
            class="mb-4 px-2 text-center text-sm text-ink-gray-6"
          >
            {{ __('Some earlier messages are unavailable after rejoining this encrypted call.') }}
          </p>
          <div class="flex flex-col gap-5">
            <template v-for="item in chatItems" :key="item.key">
              <div
                v-if="item.type === 'poll'"
                class="flex min-w-0 gap-2"
                :class="item.poll.createdBy === userId ? 'justify-end' : 'justify-start'"
              >
                <MeetAvatar
                  v-if="item.poll.createdBy !== userId"
                  size="lg"
                  :image="avatarByUser[item.poll.createdBy]"
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
                <MeetAvatar
                  v-if="!item.group.isOwn"
                  size="lg"
                  :image="avatarByUser[item.group.user_id]"
                  :label="item.group.user_name"
                  class="mt-6 shrink-0"
                />

                <div
                  class="flex min-w-0 max-w-[314px] flex-1 flex-col gap-1.5"
                  :class="item.group.isOwn ? 'items-end' : 'items-start'"
                >
                  <div
                    v-if="!item.group.isOwn"
                    class="flex max-w-full items-center gap-1 text-[11px] tracking-[0.11px]"
                  >
                    <span class="truncate text-ink-gray-7">{{ item.group.user_name }}</span>
                    <span class="shrink-0 text-ink-gray-5">· {{ time(item.group.timestamp) }}</span>
                  </div>
                  <span v-else class="text-[11px] tracking-[0.11px] text-ink-gray-5">{{
                    time(item.group.timestamp)
                  }}</span>

                  <div class="flex w-full min-w-0 flex-col gap-3">
                    <div
                      v-for="message in item.group.messages"
                      :key="message.id"
                      class="chat-message relative flex w-full min-w-0 flex-col rounded-5"
                      :class="item.group.isOwn ? 'items-end' : 'items-start'"
                      :data-message-id="message.messageId"
                      tabindex="-1"
                    >
                      <div
                        v-if="message.messageId && (canSendMessages || canPin)"
                        :class="item.group.isOwn ? 'self-end end-1' : 'self-start start-1'"
                        class="chat-message-actions z-10 flex items-center gap-0.5 rounded-4 border border-outline-gray-2 bg-surface-elevation-2 px-0.5 shadow-sm"
                        role="group"
                        :aria-label="__('Message actions')"
                      >
                        <template v-if="canSendMessages">
                          <Button
                            v-for="emoji in message.messageId === expiredPinnedMessageId
                              ? []
                              : quickReactions"
                            :key="emoji"
                            variant="ghost"
                            size="xs"
                            :label="emojiLabel(emoji)"
                            :tooltip="emojiLabel(emoji)"
                            :aria-pressed="hasReaction(message, emoji)"
                            class="chat-quick-reaction"
                            :class="{
                              '!bg-surface-gray-5 !text-ink-gray-9 hover:!bg-surface-gray-6':
                                hasReaction(message, emoji),
                            }"
                            @click="toggleReaction(message, emoji)"
                            >{{ emoji }}</Button
                          >
                          <ChatReactionPicker
                            v-if="message.messageId !== expiredPinnedMessageId"
                            @select="toggleReaction(message, $event)"
                          />
                          <Button
                            variant="ghost"
                            size="xs"
                            icon="lucide-reply"
                            :label="__('Reply')"
                            :tooltip="__('Reply')"
                            @click="startReply(message)"
                          />
                        </template>
                        <Button
                          v-if="canPin"
                          variant="ghost"
                          size="xs"
                          :icon="isPinned(message) ? 'lucide-pin-off' : 'lucide-pin'"
                          :label="isPinned(message) ? __('Unpin message') : __('Pin message')"
                          :tooltip="isPinned(message) ? __('Unpin message') : __('Pin message')"
                          @click="togglePin(message)"
                        />
                      </div>
                      <Button
                        v-if="message.replyTo"
                        variant="ghost"
                        :disabled="!messagesById.has(message.replyTo.messageId)"
                        class="chat-quote mb-2 flex !h-auto min-w-0 max-w-full !justify-start overflow-hidden !rounded-4 border border-outline-gray-2 !bg-surface-gray-1 !px-2.5 !py-1.5 text-left hover:!bg-surface-gray-2"
                        @click="scrollToMessage(message.replyTo.messageId)"
                      >
                        <span class="flex min-w-0 items-start gap-2">
                          <span
                            class="lucide-reply mt-0.5 size-3.5 shrink-0 text-ink-gray-6"
                            aria-hidden="true"
                          />
                          <span class="min-w-0 flex-1">
                            <span class="block truncate text-xs font-medium">{{
                              message.replyTo.fromName
                            }}</span>
                            <span class="block truncate text-xs text-ink-gray-6">{{
                              message.replyTo.message
                            }}</span>
                          </span>
                        </span>
                      </Button>
                      <div
                        class="chat-message-bubble max-w-full whitespace-pre-wrap rounded-[18px] px-3 py-2.5 text-left text-p-sm tracking-[0.28px] text-ink-gray-8 [overflow-wrap:anywhere]"
                        :class="
                          highlightedMessageId && highlightedMessageId === message.messageId
                            ? 'chat-message-highlighted bg-surface-gray-4'
                            : 'bg-surface-gray-2'
                        "
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
                            class="break-all text-ink-blue-5 underline"
                            >{{ token.text }}</a
                          >
                          <span v-else>{{ token.text }}</span>
                        </template>
                      </div>
                      <div
                        v-if="messageReactions(message).length"
                        class="mt-1.5 flex flex-wrap gap-1"
                        :class="{ 'justify-end': item.group.isOwn }"
                        role="group"
                        :aria-label="__('Message reactions')"
                      >
                        <Button
                          v-for="reaction in messageReactions(message)"
                          :key="reaction.emoji"
                          variant="ghost"
                          :aria-pressed="reaction.userIds.includes(userId || '')"
                          :aria-label="`${emojiLabel(reaction.emoji)}, ${reaction.userIds.length} reactions`"
                          :disabled="!canSendMessages && !reaction.userIds.includes(userId || '')"
                          :tooltip="reactionNames(reaction.userIds)"
                          class="chat-reaction !rounded-full"
                          :class="
                            reaction.userIds.includes(userId || '')
                              ? '!bg-surface-gray-5 !text-ink-gray-9 hover:!bg-surface-gray-6'
                              : '!bg-surface-gray-2 !text-ink-gray-6 hover:!bg-surface-gray-3'
                          "
                          size="xs"
                          @click="toggleReaction(message, reaction.emoji)"
                        >
                          {{ reaction.emoji }} {{ reaction.userIds.length }}
                        </Button>
                        <ChatReactionPicker
                          v-if="canSendMessages"
                          @select="toggleReaction(message, $event)"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </template>
          </div>

          <div
            v-if="chatItems.length === 0 && !hasUnavailableEncryptedHistory"
            class="mt-8 text-center text-sm text-ink-gray-6"
          >
            {{ __('No messages yet') }}
          </div>
        </div>

        <form class="relative shrink-0 p-3" @submit.prevent="handleSend">
          <template v-if="canSendMessages">
            <div
              v-if="replyTarget"
              class="mb-2 flex items-center gap-2 rounded-5 bg-surface-gray-2 px-3 py-2"
            >
              <div class="min-w-0 flex-1">
                <p class="truncate text-xs font-medium text-ink-gray-8">
                  {{ __('Replying to {0}', [replyTarget.user_name]) }}
                </p>
                <p class="truncate text-xs text-ink-gray-6">{{ replyTarget.message }}</p>
              </div>
              <Button
                variant="ghost"
                size="xs"
                icon="lucide-x"
                aria-:label="__('Cancel reply')"
                @click="cancelReply"
              />
            </div>
            <div
              class="chat-composer relative flex cursor-text items-center gap-2 rounded-5 border border-outline-gray-2 bg-surface-base py-1.5 pe-2 transition-colors hover:border-outline-gray-3 hover:shadow-sm focus-within:border-outline-gray-4 focus-within:shadow-sm"
              @click="focusInput"
            >
              <div
                v-if="emojiMenuActive"
                class="absolute bottom-full left-0 z-50 mb-1 max-h-[220px] min-w-[12rem] overflow-y-auto rounded-6 border border-outline-gray-2 bg-surface-elevation-2 p-1 shadow-lg"
                role="listbox"
                :aria-label="__('Emoji suggestions')"
                data-testid="chat-emoji-suggestions"
              >
                <button
                  v-for="(item, index) in emojiSuggestions"
                  :key="item.name"
                  type="button"
                  role="option"
                  class="flex w-full items-center gap-2 rounded-4 px-2 py-1.5 text-left text-sm"
                  :class="
                    index === emojiSelectedIndex ? 'bg-surface-gray-3' : 'hover:bg-surface-gray-2'
                  "
                  :aria-selected="index === emojiSelectedIndex"
                  @mousedown.prevent="selectEmoji(item)"
                  @mouseenter="emojiSelectedIndex = index"
                >
                  <span class="text-base leading-none">{{ item.emoji }}</span>
                  <span class="truncate text-ink-gray-4">{{ item.name }}</span>
                </button>
                <div
                  v-if="emojiSuggestions.length === 0"
                  class="px-2 py-1.5 text-sm text-ink-gray-4"
                >
                  {{ __('No results') }}
                </div>
              </div>
              <textarea
                ref="inputEl"
                v-model="draft"
                rows="1"
                :placeholder="__('Type a message')"
                class="chat-composer-input min-h-7 min-w-0 flex-1 resize-none border-0 bg-transparent py-1.5 text-base text-ink-gray-8 shadow-none outline-none ring-0 placeholder-ink-gray-4 focus:border-0 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0"
                @input="onInput"
                @keydown="onKeydown"
              />
              <Button
                type="submit"
                variant="subtle"
                theme="gray"
                size="sm"
                :label="__('Send message')"
                :loading="sending"
              >
                <template #icon>
                  <lucide-send class="h-4 w-4" />
                </template>
              </Button>
            </div>
          </template>
          <div
            v-else
            class="m-2 rounded-6 border border-outline-gray-2 bg-surface-gray-2 py-3 text-center text-sm text-ink-gray-5"
          >
            {{ __('The host has restricted chat to hosts and co-hosts only.') }}
          </div>
        </form>
        <CreatePollModal v-model="showPollModal" @submit="handlePollSubmit" />
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import LucideChartColumn from '~icons/lucide/chart-column'
import { Button, Dropdown } from 'frappe-ui'
import { computed, inject, markRaw, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { translate as __ } from '@/platform/translation'

import {
  QUICK_CHAT_REACTIONS,
  type ChatReactionRequest,
  type ChatReactionsUpdated,
} from '../../../../../suite/meet/types/chatReactions'
import type { ChatMessage } from '../composables/useChatStore'
import { pollKey } from '../composables/usePoll'
import { usePollStore } from '../composables/usePollStore'
import type { PollPayloadFE } from '../types'
import { tokenizeChatMessage } from '../utils/chatMessageTokens'
import { buildChatTimeline } from '../utils/chatTimeline'
import {
  emojiLabel,
  findColonQuery,
  insertEmojiAtQuery,
  rememberEmoji,
  suggestEmojis,
  type EmojiSuggestion,
} from '../utils/emojiSuggest'
import ChatReactionPicker from './ChatReactionPicker.vue'
import CreatePollModal from './CreatePollModal.vue'
import MeetAvatar from './MeetAvatar.vue'
import PollMessageCard from './PollMessageCard.vue'

const props = defineProps<{
  open?: boolean
  userId?: string
  userName?: string
  avatarByUser?: Record<string, string | null | undefined>
  nameByUser?: Record<string, string>
  messages?: ChatMessage[]
  sendMessage: (text: string, replyToId?: string) => Promise<boolean>
  reactionsByMessage: Record<string, ChatReactionsUpdated['reactions']>
  expiredPinnedMessageId?: string | null
  hasUnavailableEncryptedHistory?: boolean
  setReaction: (data: ChatReactionRequest) => Promise<void>
  isHost?: boolean
  isCohost?: boolean
  isGuest?: boolean
  hostOnlyChat?: boolean
  pinnedMessage?: ChatMessage | null
}>()

const avatarByUser = computed(() => props.avatarByUser || {})
const quickReactions = QUICK_CHAT_REACTIONS.slice(0, 3)

const pollStore = usePollStore()
const pollService = inject(pollKey)
const showPollModal = ref(false)

const activePolls = computed(() => pollStore.activePolls)
const pollMenuOptions = [
  {
    label: __('Create poll'),
    icon: markRaw(LucideChartColumn),
    onClick: () => {
      showPollModal.value = true
    },
  },
]

const handlePollSubmit = async (payload: { question: string; options: { text: string }[] }) => {
  if (pollService) {
    await pollService.createPoll(payload.question, payload.options)
    showPollModal.value = false
  } else {
    console.error('ERROR: pollService is undefined! The inject failed.')
  }
}

const emit = defineEmits<{
  close: []
  pin: [messageId: string]
  unpin: []
}>()
const listEl = ref<HTMLElement | null>(null)
const inputEl = ref<HTMLTextAreaElement | null>(null)
const draft = ref('')
const replyTarget = ref<ChatMessage | null>(null)
const messagesById = computed(() => new Set(props.messages?.map((message) => message.messageId)))
const sending = ref(false)

const emojiSuggestions = ref<EmojiSuggestion[]>([])
const emojiSelectedIndex = ref(0)
const emojiQueryStart = ref<number | null>(null)
/** True while a trailing `:query` is active at the caret (incl. empty query after `:`). */
const emojiMenuActive = computed(() => emojiQueryStart.value !== null)

const canSendMessages = computed(() => {
  if (!props.hostOnlyChat) return true
  return props.isHost || props.isCohost
})

const canPin = computed(() => props.isHost || props.isCohost)

function isPinned(message: ChatMessage): boolean {
  return Boolean(props.pinnedMessage && props.pinnedMessage.messageId === message.messageId)
}

function togglePin(message: ChatMessage) {
  if (!message.messageId) return
  if (isPinned(message)) emit('unpin')
  else emit('pin', message.messageId)
}

function messageReactions(message: ChatMessage) {
  return message.messageId ? (props.reactionsByMessage[message.messageId] ?? []) : []
}

function hasReaction(message: ChatMessage, emoji: string) {
  return messageReactions(message).some(
    (reaction) => reaction.emoji === emoji && reaction.userIds.includes(props.userId || ''),
  )
}

function toggleReaction(message: ChatMessage, emoji: string) {
  if (!message.messageId) return
  const active = !hasReaction(message, emoji)
  if (active && !canSendMessages.value) return
  void props.setReaction({ messageId: message.messageId, emoji, active })
}

function startReply(message: ChatMessage) {
  replyTarget.value = message
  nextTick(focusInput)
}

const chatNames = computed(
  () => new Map(props.messages?.map(({ user_id, user_name }) => [user_id, user_name])),
)

const reactionNameList = new Intl.ListFormat('en', { type: 'conjunction' })

function reactionNames(userIds: string[]) {
  const names = userIds
    .slice(0, 10)
    .map((id) =>
      id === props.userId
        ? 'You'
        : props.nameByUser?.[id] || chatNames.value.get(id) || 'Participant',
    )
  if (userIds.length > names.length) names.push(`${userIds.length - names.length} more`)
  return reactionNameList.format(names)
}

const MESSAGE_HIGHLIGHT_DURATION_MS = 4000
const highlightedMessageId = ref<string>()
let highlightTimeout: ReturnType<typeof setTimeout> | undefined

function scrollToMessage(messageId?: string) {
  if (!messageId) return
  const messageEl = listEl.value?.querySelector<HTMLElement>(
    `[data-message-id="${CSS.escape(messageId)}"]`,
  )
  if (!messageEl) return

  messageEl.focus({ preventScroll: true })
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  messageEl.scrollIntoView({ behavior: reducedMotion ? 'instant' : 'smooth', block: 'center' })
  highlightedMessageId.value = messageId
  clearTimeout(highlightTimeout)
  highlightTimeout = setTimeout(() => {
    highlightedMessageId.value = undefined
  }, MESSAGE_HIGHLIGHT_DURATION_MS)
}

onBeforeUnmount(() => clearTimeout(highlightTimeout))

onMounted(async () => {
  await scrollToBottom()
})

const chatItems = computed(() =>
  buildChatTimeline(props.messages || [], activePolls.value, props.userId),
)

function time(ts: string) {
  try {
    return new Date(ts).toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
  } catch {
    return ''
  }
}

function pollCreatorName(poll: PollPayloadFE) {
  if (poll.createdBy === props.userId) return props.userName || __('You')
  return poll.createdByName || poll.createdBy
}

function syncEmojiMenu() {
  const el = inputEl.value
  if (!el) {
    closeEmojiMenu()
    return
  }
  const caret = el.selectionStart ?? draft.value.length
  const found = findColonQuery(draft.value, caret)
  if (!found) {
    closeEmojiMenu()
    return
  }
  emojiQueryStart.value = found.start
  emojiSuggestions.value = suggestEmojis(found.query)
  emojiSelectedIndex.value = 0
}

function closeEmojiMenu() {
  emojiQueryStart.value = null
  emojiSuggestions.value = []
  emojiSelectedIndex.value = 0
}

function selectEmoji(item: EmojiSuggestion) {
  const el = inputEl.value
  if (!el || emojiQueryStart.value === null) return
  const caret = el.selectionStart ?? draft.value.length
  const { text, caret: nextCaret } = insertEmojiAtQuery(
    draft.value,
    caret,
    emojiQueryStart.value,
    item.emoji,
  )
  draft.value = text
  rememberEmoji(item)
  closeEmojiMenu()
  nextTick(() => {
    el.focus()
    el.setSelectionRange(nextCaret, nextCaret)
    autosize()
  })
}

function onInput() {
  autosize()
  syncEmojiMenu()
}

function onKeydown(event: KeyboardEvent) {
  if (emojiMenuActive.value) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (emojiSuggestions.value.length === 0) return
      emojiSelectedIndex.value = (emojiSelectedIndex.value + 1) % emojiSuggestions.value.length
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (emojiSuggestions.value.length === 0) return
      emojiSelectedIndex.value =
        (emojiSelectedIndex.value - 1 + emojiSuggestions.value.length) %
        emojiSuggestions.value.length
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      closeEmojiMenu()
      return
    }
    if (
      (event.key === 'Enter' || event.key === 'Tab') &&
      !event.shiftKey &&
      emojiSuggestions.value.length > 0
    ) {
      event.preventDefault()
      selectEmoji(emojiSuggestions.value[emojiSelectedIndex.value])
      return
    }
  }

  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    handleSend()
  }
}

async function handleSend() {
  const submittedDraft = draft.value
  const submittedReply = replyTarget.value
  const text = submittedDraft.trim()
  if (!canSendMessages.value || !text || sending.value) return

  sending.value = true
  closeEmojiMenu()
  try {
    const sent = await props.sendMessage(text, submittedReply?.messageId)
    if (sent && replyTarget.value === submittedReply) replyTarget.value = null
    if (sent && draft.value === submittedDraft) draft.value = ''
  } finally {
    sending.value = false
  }
  await nextTick()
  autosize()
  focusInput()
}

function cancelReply() {
  replyTarget.value = null
  focusInput()
}

function focusInput() {
  inputEl.value?.focus({ preventScroll: true })
}

function autosize() {
  const el = inputEl.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 88)}px`
}

async function scrollToBottom() {
  await nextTick()
  const el = listEl.value
  if (!el) return
  el.scrollTop = el.scrollHeight
}

watch(
  () => props.open,
  async (open) => {
    if (!open) return
    await nextTick()
    if (props.open) focusInput()
  },
  { immediate: true },
)

watch(chatItems, () => {
  if (!listEl.value?.querySelector('.chat-message:focus')) void scrollToBottom()
})
</script>

<style scoped>
.chat-message:focus {
  outline: none;
}

.chat-quote > :deep(span) {
  flex: 1;
  min-width: 0;
}

.chat-reaction,
.chat-quick-reaction {
  -webkit-tap-highlight-color: transparent;
}

.chat-reaction[aria-pressed='true'],
.chat-quick-reaction[aria-pressed='true'] {
  --chat-reaction-inset: inset 0 0 0 1px color-mix(in srgb, currentColor 36%, transparent);
  box-shadow: var(--chat-reaction-inset);
}

.chat-reaction:focus-visible,
.chat-quick-reaction:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 2px;
  box-shadow: var(--chat-reaction-inset, none);
}

.chat-message-bubble {
  transition: background-color 650ms ease-out;
}

.chat-message-highlighted {
  transition-duration: 0s;
}

@media (prefers-reduced-motion: reduce) {
  .chat-message-bubble {
    transition: none;
  }
}

.chat-message-actions {
  margin-bottom: 0.25rem;
}

@media (hover: hover) and (pointer: fine) {
  .chat-message-actions {
    position: absolute;
    top: -0.75rem;
    margin-bottom: 0;
    opacity: 0;
    pointer-events: none;
  }

  .chat-message:hover > .chat-message-actions,
  .chat-message-actions:has(:focus-visible),
  .chat-message-actions:has([aria-expanded='true']) {
    opacity: 1;
    pointer-events: auto;
  }
}

.chat-composer-input {
  max-height: 88px;
  margin: 0;
  overflow-y: auto;
  caret-color: var(--ink-gray-8);
  /* Kill UA / form focus chrome; the wrapper owns focus affordance. */
  outline: none !important;
  box-shadow: none !important;
  -webkit-appearance: none;
  appearance: none;
}

.chat-composer-input:focus,
.chat-composer-input:focus-visible {
  outline: none !important;
  box-shadow: none !important;
}
</style>
