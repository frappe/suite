<!--
  One setting: what it is on the left, the control on the right.
-->
<template>
  <div class="flex items-start justify-between gap-6">
    <div class="min-w-0">
      <div class="text-base font-medium text-ink-gray-8">{{ title }}</div>
      <p v-if="description" class="mt-0.5 text-p-sm text-ink-gray-6">{{ description }}</p>
    </div>
    <div class="flex shrink-0 items-center">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{ title: string; description?: string }>()
</script>
