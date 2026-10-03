<template>
  <!-- Absolute over the item's icon, so the item never changes size. -->
  <span class="pointer-events-none absolute inset-0">
    <!-- The item's link carries its own aria-label, so the state is a live
         region: screen readers hear it when it changes. Always rendered, as a
         live region must exist before its text changes. -->
    <span data-slot="area-progress-status" role="status" class="sr-only">{{ status }}</span>
    <!-- One dot at the icon's top-right corner: red when the work needs
         attention, else orange while it runs or is paused. It fades out when
         the work is done. -->
    <Transition leave-active-class="transition-opacity duration-500" leave-to-class="opacity-0">
      <span
        v-if="progress && shown"
        data-slot="area-progress-dot"
        :data-tone="progress.tone"
        :data-attention="progress.attention"
        aria-hidden="true"
        class="absolute -right-0.5 -top-0.5 block size-2 rounded-full border border-[var(--surface-base)]"
        :class="progress.attention ? 'bg-surface-red-6' : 'bg-surface-orange-6'"
      />
    </Transition>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { progressState, type AreaProgress } from '@/shell/areaProgress'

const props = defineProps<{
  progress: AreaProgress | null
  /** The area's name, spoken before the state: "Files: Paused". */
  label: string
}>()

const status = computed(() => {
  const state = progressState(props.progress)
  return state ? `${props.label}: ${state}` : ''
})
const shown = computed(() => {
  const progress = props.progress
  if (!progress) return false
  return progress.attention || (progress.fraction != null && progress.tone !== 'done')
})
</script>
