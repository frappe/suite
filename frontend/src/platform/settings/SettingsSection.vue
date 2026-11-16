<template>
  <!-- One titled part of a settings page that holds several. -->
  <section>
    <div class="flex min-h-7 items-center justify-between gap-3">
      <h2 class="text-base-semibold text-ink-gray-8">{{ title }}</h2>
      <div v-if="$slots.actions" class="flex shrink-0 items-center gap-2">
        <slot name="actions" />
      </div>
    </div>
    <div class="mt-2">
      <slot />
    </div>
  </section>
</template>

<script setup lang="ts">
defineProps<{ title: string }>()
defineSlots<{ default?: () => unknown; actions?: () => unknown }>()
</script>
