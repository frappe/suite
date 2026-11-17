<template>
  <!-- A filter on the search as a chip: set, it reads what it is set to and has its own ×; unset, it
       names the filter and looks like a menu. Set or not, pressing it opens what sets it, where
       there is anything to open. The one root is what a popup anchors to. -->
  <span
    v-if="value"
    class="bg-surface-gray-3 text-ink-gray-8 inline-flex shrink-0 items-center gap-0.5 rounded-4 pl-2 pr-1 text-sm"
    :class="isMobile ? 'h-8' : 'h-7'"
  >
    <button class="max-w-44 truncate" @click="emit('open')">{{ value }}</button>
    <button
      class="text-ink-gray-5 hover:text-ink-gray-8 rounded-4 p-1"
      :aria-label="__('Remove filter {0}', [label])"
      @click="emit('clear')"
    >
      <span class="lucide-x size-3" aria-hidden="true" />
    </button>
  </span>
  <button
    v-else
    class="border-outline-gray-2 text-ink-gray-8 hover:bg-surface-gray-1 inline-flex shrink-0 items-center gap-1 rounded-4 border pl-2 pr-1.5 text-sm"
    :class="isMobile ? 'h-8' : 'h-7'"
    @click="emit('open')"
  >
    {{ label }}
    <span class="lucide-chevron-down text-ink-gray-5 size-3.5" aria-hidden="true" />
  </button>
</template>

<script setup lang="ts">
import { useScreenSize } from '@/apps/mail/utils/composables'

defineProps<{ label: string; value?: string }>()
const emit = defineEmits<{ open: []; clear: [] }>()

const { isMobile } = useScreenSize()
</script>
