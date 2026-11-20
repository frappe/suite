<template>
  <!-- Under the subject: what it says is about the conversation, not one message in it. -->
  <div
    class="bg-surface-gray-1 text-ink-gray-8 text-p-sm flex items-center gap-2 rounded-5 px-3 py-1.5 max-sm:mx-3.5 max-sm:mb-2"
  >
    <span :class="icon" class="text-ink-gray-5 size-4 shrink-0" aria-hidden="true" />
    <span class="min-w-0 flex-1"><slot /></span>
    <slot name="actions" />
  </div>
</template>

<script setup lang="ts">
defineProps<{ icon: string }>()
</script>
