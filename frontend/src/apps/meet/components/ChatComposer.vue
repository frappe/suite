<template>
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
          :aria-label="__('Cancel reply')"
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
            :class="index === emojiSelectedIndex ? 'bg-surface-gray-3' : 'hover:bg-surface-gray-2'"
            :aria-selected="index === emojiSelectedIndex"
            @mousedown.prevent="selectEmoji(item)"
            @mouseenter="emojiSelectedIndex = index"
          >
            <span class="text-base leading-none">{{ item.emoji }}</span>
            <span class="truncate text-ink-gray-4">{{ item.name }}</span>
          </button>
          <div v-if="emojiSuggestions.length === 0" class="px-2 py-1.5 text-sm text-ink-gray-4">
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
</template>

<script setup lang="ts">
import { Button } from 'frappe-ui'
import { computed, nextTick, ref, watch } from 'vue'

import { translate as __ } from '@/platform/translation'

import type { ChatMessage } from '../composables/useChatStore'
import {
  findColonQuery,
  insertEmojiAtQuery,
  rememberEmoji,
  suggestEmojis,
  type EmojiSuggestion,
} from '../utils/emojiSuggest'

const props = defineProps<{
  open?: boolean
  canSendMessages: boolean
  sendMessage: (text: string, replyToId?: string) => Promise<boolean>
}>()

const replyTarget = defineModel<ChatMessage | null>('replyTarget', { required: true })
const inputEl = ref<HTMLTextAreaElement | null>(null)
const draft = ref('')
const sending = ref(false)
const emojiSuggestions = ref<EmojiSuggestion[]>([])
const emojiSelectedIndex = ref(0)
const emojiQueryStart = ref<number | null>(null)
const emojiMenuActive = computed(() => emojiQueryStart.value !== null)

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
  if (!props.canSendMessages || !text || sending.value) return

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

watch(
  () => props.open,
  async (open) => {
    if (!open) return
    await nextTick()
    if (props.open) focusInput()
  },
  { immediate: true },
)

defineExpose({ focusInput })
</script>

<style scoped>
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
