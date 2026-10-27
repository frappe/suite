<script setup lang="ts">
import { computed } from 'vue'

/** A line across the document under its header, with its actions at the right edge. */
const props = withDefaults(defineProps<{ tone?: 'gray' | 'blue' | 'amber' }>(), { tone: 'gray' })

const TONES = {
  gray: 'border-outline-elevation-2 text-ink-gray-7',
  blue: 'border-outline-gray-1 bg-surface-blue-2 text-ink-blue-7',
  amber: 'border-outline-gray-1 bg-surface-amber-2 text-ink-amber-7',
}
const toneClass = computed(() => TONES[props.tone])
</script>

<template>
  <!-- As tall as the editor toolbar it can stand in for: a 36px row above its border -->
  <div
    class="box-content flex min-h-9 shrink-0 items-center justify-between gap-3 border-b px-5 text-sm"
    :class="toneClass"
    role="status"
  >
    <slot />
  </div>
</template>
