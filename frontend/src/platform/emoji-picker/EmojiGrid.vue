<template>
  <div class="emoji-grid">
    <div ref="pickerHost" />
    <p
      v-if="failed"
      class="rounded-6 border border-outline-gray-2 bg-surface-elevation-2 p-3 text-sm"
      role="status"
    >
      {{ __('Couldn’t load emoji. Close and reopen to try again.') }}
    </p>
  </div>
</template>
<script setup lang="ts">
import type { Picker } from 'emoji-mart'
import { ref, watch } from 'vue'

import { translate as __ } from '@/platform/translation'

const props = defineProps<{ picker?: typeof Picker }>()
const emit = defineEmits<{ select: [emoji: string] }>()
const pickerHost = ref<HTMLElement | null>(null)
const failed = ref(!props.picker)

watch(pickerHost, (host, _, onCleanup) => {
  if (!host || !props.picker) return
  onCleanup(() => host.replaceChildren())

  try {
    const picker = new props.picker({
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
  } catch (error) {
    console.error('Failed to load the emoji picker', error)
    failed.value = true
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
