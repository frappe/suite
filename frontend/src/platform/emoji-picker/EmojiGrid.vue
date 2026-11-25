<template>
  <div class="emoji-grid">
    <div ref="pickerHost" />
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
<script setup lang="ts">
import { ref, watch } from 'vue'

import { translate as __ } from '@/platform/translation'

const emit = defineEmits<{ select: [emoji: string] }>()
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
      import('@emoji-mart/data/sets/15/native.json'),
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
        if (!native) return
        emit('select', native)
      },
    })

    if (!(picker instanceof HTMLElement)) throw new Error('Emoji picker element unavailable')
    host.appendChild(picker)
    status.value = 'ready'
  } catch (error) {
    if (closed) return
    console.error('Failed to load the emoji picker', error)
    status.value = 'error'
  }
})
</script>

<style scoped>
.emoji-grid {
  width: min(21rem, calc(100vw - 1.5rem));
}

.emoji-grid :deep(em-emoji-picker) {
  width: 100%;
  height: min(24rem, 65dvh);
}
</style>
