<template>
  <div class="flex items-baseline gap-4 py-1.5">
    <div class="text-ink-gray-5 w-20 shrink-0 text-sm sm:w-36">{{ label }}</div>
    <div class="text-ink-gray-9 min-w-0 flex-1 text-base leading-[18px] break-words">
      <slot>{{ value || '—' }}</slot>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{ label: string; value?: string }>()
</script>
