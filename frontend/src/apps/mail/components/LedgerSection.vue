<template>
  <section class="flex flex-col gap-2">
    <div class="flex items-center justify-between gap-3">
      <!-- !text-xs: the mail layout's h2 rule sizes every h2 to 16/15px. -->
      <h2 class="text-ink-gray-5 !text-xs font-medium tracking-wider uppercase">{{ title }}</h2>
      <slot name="action" />
    </div>
    <p v-if="note" class="text-ink-gray-5 text-sm">{{ note }}</p>
    <slot />
  </section>
</template>

<script setup lang="ts">
defineProps<{ title: string; note?: string }>()
</script>
