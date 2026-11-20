<!--
  What a list in a settings dialog shows while it holds nothing: that it is empty, then what the
  list is for. A link or a button the list adds comes after the two lines.
-->
<template>
  <div class="flex flex-col items-start gap-1.5">
    <p class="text-base-medium text-ink-gray-8">{{ title }}</p>
    <p class="text-p-base text-ink-gray-6">{{ description }}</p>
    <slot />
  </div>
</template>

<script setup lang="ts">
defineProps<{
  /** That the list is empty, such as "No signatures yet". */
  title: string
  /** What the list is for. */
  description: string
}>()
</script>
