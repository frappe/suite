<template>
  <!-- The Home and Meet card idiom: an icon leading, the figure and label
       anchored to the bottom edge, on the bordered elevation surface. -->
  <div
    class="flex aspect-[1.7] w-full min-w-0 flex-col items-start justify-between gap-3 overflow-hidden rounded-5 border border-outline-gray-1 bg-surface-elevation-1 p-3"
  >
    <span :class="icon" class="size-4.5 shrink-0 text-ink-gray-8" aria-hidden="true" />
    <span class="flex w-full min-w-0 flex-col gap-0.5">
      <span class="truncate text-2xl font-semibold tabular-nums text-ink-gray-9">{{ value }}</span>
      <span class="truncate text-xs text-ink-gray-5" :title="label">{{ label }}</span>
      <span v-if="meta" class="truncate text-xs text-ink-gray-5" :title="meta">{{ meta }}</span>
    </span>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  /** Leading icon, a lucide class name. */
  icon: string
  /** The figure itself; already formatted by the caller. */
  value: string | number
  /** What the figure counts. */
  label: string
  /** One secondary line under the label. */
  meta?: string
}>()
</script>
