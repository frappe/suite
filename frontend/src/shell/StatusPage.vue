<!--
  A whole page that says why there is nothing to show, and where to go from there: the load-error
  and not-found pages. Kept quiet: a title, a line, and the ways on.
-->
<template>
  <section
    class="flex h-full flex-col items-center justify-center px-6 py-16 text-center"
    :aria-labelledby="titleId"
  >
    <h1 :id="titleId" class="text-lg-semibold text-ink-gray-8">{{ title }}</h1>
    <p class="mt-1 max-w-sm text-balance text-p-base text-ink-gray-5">{{ description }}</p>
    <div class="mt-5 flex flex-wrap items-center justify-center gap-2">
      <slot />
    </div>
  </section>
</template>

<script setup lang="ts">
import { useId } from 'vue'

defineProps<{
  title: string
  description: string
}>()

const titleId = useId()
</script>
