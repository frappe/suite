<template>
  <!-- Absolute over the pane, so nothing below moves while a drag passes. -->
  <div
    v-if="zone"
    data-slot="upload-drop-overlay"
    class="pointer-events-none absolute inset-0 z-10 rounded-6 border-2 border-dashed border-outline-blue-3"
  >
    <p
      class="absolute bottom-4 left-1/2 flex h-8 max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2 rounded-full bg-surface-blue-2 px-3 text-base-medium text-ink-blue-7 shadow-lg"
    >
      <span class="lucide-upload size-4 shrink-0" aria-hidden="true" />
      <span class="truncate">Drop to upload to {{ zone.label }}</span>
    </p>
  </div>
</template>

<script setup lang="ts">
import type { DropZone } from './drop'

defineProps<{ zone: DropZone | null }>()
</script>
