<template>
  <Popover v-model:open="open" bare side="top" align="end" :auto-focus="false">
    <template #trigger>
      <Button
        variant="ghost"
        size="xs"
        icon="lucide-smile-plus"
        :label="__('Add reaction')"
        :tooltip="__('Add reaction')"
      />
    </template>
    <template #default>
      <div class="chat-reaction-picker">
        <div v-if="open" ref="pickerHost" />
        <p
          v-if="status !== 'ready'"
          class="rounded-6 border border-outline-gray-2 bg-surface-elevation-2 p-3 text-sm"
          role="status"
        >
          {{
            status === 'loading'
              ? __('Loading emoji…')
              : __('Couldn’t load emoji. Close and reopen to try again.')
          }}
        </p>
      </div>
    </template>
  </Popover>
</template>

<script setup lang="ts">
import { Button, Popover } from 'frappe-ui'
import { ref, watch } from 'vue'

import { translate as __ } from '@/platform/translation'

import { isChatReaction } from '../../../../../suite/meet/types/chatReactions'

const emit = defineEmits<{ select: [emoji: string] }>()
const open = ref(false)
const pickerHost = ref<HTMLElement | null>(null)
const status = ref<'loading' | 'ready' | 'error'>('loading')

watch(pickerHost, async (host, _, onCleanup) => {
  if (!host) return
  let closed = false
  onCleanup(() => {
    closed = true
    host.replaceChildren()
  })

  status.value = 'loading'
  try {
    const [{ Picker }, { default: data }] = await Promise.all([
      import('emoji-mart'),
      import('@emoji-mart/data'),
    ])
    if (closed) return

    const picker = new Picker({
      data,
      set: 'native',
      emojiVersion: 15,
      theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
      dynamicWidth: true,
      emojiButtonSize: 32,
      emojiSize: 22,
      autoFocus: true,
      previewPosition: 'none',
      skinTonePosition: 'search',
      onEmojiSelect: ({ native }: { native?: string }) => {
        if (!isChatReaction(native)) return
        emit('select', native)
        open.value = false
      },
    })

    if (!(picker instanceof HTMLElement)) throw new Error('Emoji picker element unavailable')
    host.appendChild(picker)
    status.value = 'ready'
  } catch (error) {
    if (closed) return
    console.error('Failed to load the chat reaction picker', error)
    status.value = 'error'
  }
})
</script>

<style scoped>
.chat-reaction-picker {
  width: min(21rem, calc(100vw - 1.5rem));
}

.chat-reaction-picker :deep(em-emoji-picker) {
  width: 100%;
  height: min(24rem, 65dvh);
}
</style>
