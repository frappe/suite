<!--
  One onboarding step in a narrow centred column: the Suite mark and the
  progress track, the step's title and subtitle, its body and its buttons.
  The body is keyed by `step`, so each step enters on its own.
-->
<script setup lang="ts">
import { nextTick, useTemplateRef, watch } from 'vue'

import SetupProgressTrack from '@/shell/SetupProgressTrack.vue'
import SuiteMark from '@/shell/SuiteMark.vue'

const {
  step,
  title,
  total,
  current,
  complete = false,
} = defineProps<{
  step: string
  title: string
  subtitle: string
  /** Steps on the track, and the index of this one; the track hides when `total` is 0. */
  total: number
  current: number
  complete?: boolean
}>()

const body = useTemplateRef<HTMLElement>('body')

// Move focus into each new step, so the keyboard carries on from where the last step ended.
watch(
  () => step,
  async () => {
    await nextTick()
    const root = body.value
    const field = root?.querySelector<HTMLElement>(
      'input:not([type="file"]):not([disabled]), textarea',
    )
    const button = root?.querySelector<HTMLElement>('[data-primary] button, button[data-primary]')
    ;(field ?? button)?.focus({ preventScroll: true })
  },
  { immediate: true },
)
</script>

<template>
  <div class="flex h-full justify-center overflow-auto bg-surface-base px-4 pt-16 pb-14 sm:pt-24">
    <div class="flex w-full max-w-sm flex-col gap-7">
      <div class="sr-only" aria-live="polite">{{ title }}</div>
      <div class="flex items-center justify-between">
        <slot name="mark"><SuiteMark :size="32" /></slot>
        <SetupProgressTrack
          v-if="total"
          :total-steps="total"
          :current-step="current"
          :is-complete="complete"
        />
      </div>

      <div :key="step" ref="body" class="enter flex flex-col gap-8">
        <div class="flex flex-col gap-2">
          <h1 class="text-3xl-semibold text-ink-gray-9">{{ title }}</h1>
          <p class="text-p-base text-ink-gray-6">{{ subtitle }}</p>
        </div>
        <div class="min-h-38">
          <slot />
        </div>
        <slot name="actions" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.enter {
  animation: enter 0.5s cubic-bezier(0.16, 1, 0.3, 1) both;
}
@keyframes enter {
  from {
    opacity: 0;
    transform: translateY(6px);
    filter: blur(2px);
  }
}
@media (prefers-reduced-motion: reduce) {
  .enter {
    animation: none;
  }
}
</style>
