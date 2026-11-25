<!--
  A whole page that says why there is nothing to show, and where to go from there: the load-error
  and not-found pages. Drawn as the shell's unavailable area is, so the three read as one family.
-->
<template>
  <section
    class="flex h-full flex-col items-center justify-center px-6 py-16 text-center"
    :aria-labelledby="titleId"
  >
    <div class="grid size-12 place-items-center rounded-full bg-surface-gray-2 text-ink-gray-5">
      <span :class="[icon, 'size-6']" aria-hidden="true" />
    </div>
    <h1 :id="titleId" class="mt-4 text-2xl-semibold text-ink-gray-9">{{ title }}</h1>
    <p class="mt-2 max-w-sm text-balance text-p-base text-ink-gray-6">{{ description }}</p>
    <div class="mt-6 flex flex-wrap items-center justify-center gap-2">
      <slot />
    </div>
  </section>
</template>

<script setup lang="ts">
import { useId } from 'vue'

defineProps<{
  /** A `lucide-*` icon class. */
  icon: string
  title: string
  description: string
}>()

const titleId = useId()
</script>
