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
                    <ChatMessageRow
                      v-for="message in item.group.messages"
                      :key="message.id"
                      :message
                      :is-own="item.group.isOwn"
                      :user-id
                      :can-send-messages="canSendMessages"
                      :can-pin="canPin"
                      :pinned="isPinned(message)"
                      :expired="message.messageId === expiredPinnedMessageId"
                      :can-jump-to-quote="canJumpToQuote(message)"
                      :highlighted="
                        !!highlightedMessageId && highlightedMessageId === message.messageId
                      "
                      :reactions="
                        message.messageId ? (reactionsByMessage[message.messageId] ?? []) : []
                      "
                      :participant-name="participantName"
                      @reply="startReply(message)"
                      @jump-to-quote="scrollToMessage"
                      @toggle-pin="togglePin(message)"
                      @react="setReaction"
                    />
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

        <ChatComposer
          ref="composer"
          v-model:reply-target="replyTarget"
          :open
          :can-send-messages="canSendMessages"
          :send-message="sendMessage"
        />
        <CreatePollModal v-model="showPollModal" @submit="handlePollSubmit" />
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import LucideChartColumn from '~icons/lucide/chart-column'
import { Button, Dropdown } from 'frappe-ui'
import { computed, inject, markRaw, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { prepareEmojiPicker } from '@/platform/emoji-picker/prepareEmojiPicker'
import { translate as __ } from '@/platform/translation'

import {
  type ChatReactionRequest,
  type ChatReactionsUpdated,
} from '../../../../../suite/meet/types/chatReactions'
import type { ChatMessage } from '../composables/useChatStore'
import { pollKey } from '../composables/usePoll'
import { usePollStore } from '../composables/usePollStore'
import type { PollPayloadFE } from '../types'
import { buildChatTimeline } from '../utils/chatTimeline'
import ChatComposer from './ChatComposer.vue'
import ChatMessageRow from './ChatMessage.vue'
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
const composer = ref<InstanceType<typeof ChatComposer> | null>(null)
const replyTarget = ref<ChatMessage | null>(null)
const messagesById = computed(() => new Set(props.messages?.map((message) => message.messageId)))

const canPin = computed(() => Boolean(props.isHost || props.isCohost))
const canSendMessages = computed(() => !props.hostOnlyChat || canPin.value)

function canJumpToQuote(message: ChatMessage) {
  return Boolean(message.replyTo && messagesById.value.has(message.replyTo.messageId))
}

function isPinned(message: ChatMessage): boolean {
  return Boolean(props.pinnedMessage && props.pinnedMessage.messageId === message.messageId)
}

function togglePin(message: ChatMessage) {
  if (!message.messageId) return
  if (isPinned(message)) emit('unpin')
  else emit('pin', message.messageId)
}

function startReply(message: ChatMessage) {
  replyTarget.value = message
  nextTick(() => composer.value?.focusInput())
}

const chatNames = computed(
  () => new Map(props.messages?.map(({ user_id, user_name }) => [user_id, user_name])),
)

function participantName(id: string) {
  if (id === props.userId) return 'You'
  return props.nameByUser?.[id] || chatNames.value.get(id) || 'Participant'
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

async function scrollToBottom() {
  await nextTick()
  const el = listEl.value
  if (!el) return
  el.scrollTop = el.scrollHeight
}

watch(
  () => props.open && canSendMessages.value,
  (canUsePicker) => {
    if (canUsePicker) void prepareEmojiPicker()
  },
  { immediate: true },
)

watch(chatItems, () => {
  if (!listEl.value?.querySelector('.chat-message:focus')) void scrollToBottom()
})
</script>
