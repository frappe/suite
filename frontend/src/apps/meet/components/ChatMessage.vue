<template>
  <div
    class="chat-message relative flex w-full min-w-0 flex-col rounded-5"
    :class="isOwn ? 'items-end' : 'items-start'"
    :data-message-id="message.messageId"
    tabindex="-1"
  >
    <div
      v-if="message.messageId && (canSendMessages || canPin)"
      :class="isOwn ? 'self-end end-1' : 'self-start start-1'"
      class="chat-message-actions z-10 flex items-center gap-0.5 rounded-4 border border-outline-gray-2 bg-surface-elevation-2 px-0.5 shadow-sm"
      role="group"
      :aria-label="__('Message actions')"
    >
      <template v-if="canSendMessages">
        <Button
          v-for="emoji in expired ? [] : quickReactions"
          :key="emoji"
          variant="ghost"
          size="xs"
          :label="emojiLabel(emoji)"
          :tooltip="emojiLabel(emoji)"
          :aria-pressed="hasReaction(emoji)"
          class="chat-quick-reaction"
          :class="{
            '!bg-surface-gray-5 !text-ink-gray-9 hover:!bg-surface-gray-6': hasReaction(emoji),
          }"
          @click="toggleReaction(emoji)"
          >{{ emoji }}</Button
        >
        <ChatReactionPicker v-if="!expired" @select="toggleReaction($event)" />
        <Button
          variant="ghost"
          size="xs"
          icon="lucide-reply"
          :label="__('Reply')"
          :tooltip="__('Reply')"
          @click="emit('reply')"
        />
      </template>
      <Button
        v-if="canPin"
        variant="ghost"
        size="xs"
        :icon="pinned ? 'lucide-pin-off' : 'lucide-pin'"
        :label="pinned ? __('Unpin message') : __('Pin message')"
        :tooltip="pinned ? __('Unpin message') : __('Pin message')"
        @click="emit('togglePin')"
      />
    </div>
    <Button
      v-if="message.replyTo"
      variant="ghost"
      :disabled="!canJumpToQuote"
      class="chat-quote mb-2 flex !h-auto min-w-0 max-w-full !justify-start overflow-hidden !rounded-4 border border-outline-gray-2 !bg-surface-gray-1 !px-2.5 !py-1.5 text-left hover:!bg-surface-gray-2"
      @click="emit('jumpToQuote', message.replyTo.messageId)"
    >
      <span class="flex min-w-0 items-start gap-2">
        <span class="lucide-reply mt-0.5 size-3.5 shrink-0 text-ink-gray-6" aria-hidden="true" />
        <span class="min-w-0 flex-1">
          <span class="block truncate text-xs font-medium">{{ message.replyTo.fromName }}</span>
          <span class="block truncate text-xs text-ink-gray-6">{{ message.replyTo.message }}</span>
        </span>
      </span>
    </Button>
    <div
      class="chat-message-bubble max-w-full whitespace-pre-wrap rounded-[18px] px-3 py-2.5 text-left text-p-sm tracking-[0.28px] text-ink-gray-8 [overflow-wrap:anywhere]"
      :class="highlighted ? 'chat-message-highlighted bg-surface-gray-4' : 'bg-surface-gray-2'"
    >
      <template v-for="(token, i) in tokenizeChatMessage(message.message)" :key="i">
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
      v-if="reactions.length"
      class="mt-1.5 flex flex-wrap gap-1"
      :class="{ 'justify-end': isOwn }"
      role="group"
      :aria-label="__('Message reactions')"
    >
      <Button
        v-for="reaction in reactions"
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
        @click="toggleReaction(reaction.emoji)"
      >
        {{ reaction.emoji }} {{ reaction.userIds.length }}
      </Button>
      <ChatReactionPicker v-if="canSendMessages" @select="toggleReaction($event)" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { Button } from 'frappe-ui'
import { watch } from 'vue'

import { translate as __ } from '@/platform/translation'

import {
  QUICK_CHAT_REACTIONS,
  type ChatReactionRequest,
  type ChatReactionsUpdated,
} from '../../../../../suite/meet/types/chatReactions'
import type { ChatMessage } from '../composables/useChatStore'
import { tokenizeChatMessage } from '../utils/chatMessageTokens'
import { emojiLabel, loadEmojiCatalog } from '../utils/emojiSuggest'
import ChatReactionPicker from './ChatReactionPicker.vue'

const props = defineProps<{
  message: ChatMessage
  isOwn: boolean
  userId?: string
  canSendMessages: boolean
  canPin: boolean
  pinned: boolean
  expired: boolean
  canJumpToQuote: boolean
  highlighted: boolean
  reactions: ChatReactionsUpdated['reactions']
  participantName: (id: string) => string
}>()

const emit = defineEmits<{
  reply: []
  jumpToQuote: [messageId: string]
  togglePin: []
  react: [request: ChatReactionRequest]
}>()

const quickReactions: readonly string[] = QUICK_CHAT_REACTIONS.slice(0, 3)
watch(
  () => props.reactions.some(({ emoji }) => !quickReactions.includes(emoji)),
  (hasOtherReactions) => {
    if (hasOtherReactions) void loadEmojiCatalog()
  },
  { immediate: true },
)
const reactionNameList = new Intl.ListFormat('en', { type: 'conjunction' })

function hasReaction(emoji: string) {
  return props.reactions.some(
    (reaction) => reaction.emoji === emoji && reaction.userIds.includes(props.userId || ''),
  )
}

function toggleReaction(emoji: string) {
  const messageId = props.message.messageId
  if (!messageId) return
  const active = !hasReaction(emoji)
  if (active && !props.canSendMessages) return
  emit('react', { messageId, emoji, active })
}

function reactionNames(userIds: string[]) {
  const names = userIds.slice(0, 10).map(props.participantName)
  if (userIds.length > names.length) names.push(`${userIds.length - names.length} more`)
  return reactionNameList.format(names)
}
</script>

<style scoped>
.chat-message:focus')) void scrollToBottom()
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
</style>
