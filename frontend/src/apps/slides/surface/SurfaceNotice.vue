<script setup lang="ts">
defineProps<{
  icon: string
  iconClass?: string
  message: string
}>()
</script>

<template>
  <div
    role="alert"
    class="absolute bottom-10 left-1/2 z-10 flex w-max max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-1 rounded-4 bg-surface-elevation-1 p-0.5 shadow-md"
  >
    <div class="flex min-w-0 items-center gap-2 p-2">
      <span
        :class="[icon, iconClass ?? 'text-ink-gray-7']"
        class="size-4 shrink-0"
        aria-hidden="true"
      />
      <span class="text-base text-ink-gray-7">{{ message }}</span>
    </div>
    <div class="h-5 w-px shrink-0 bg-surface-gray-4" />
    <div class="flex shrink-0 items-center gap-1">
      <slot />
    </div>
  </div>
</template>
