<template>
  <!-- One titled part of a settings page that holds several. The title sits right on what it
       names: a settings row brings its own space above, and anything else adds its own. -->
  <section>
    <div class="flex items-center justify-between gap-3">
      <h2 class="text-base-semibold text-ink-gray-8">{{ title }}</h2>
      <div v-if="$slots.actions" class="flex shrink-0 items-center gap-2">
        <slot name="actions" />
      </div>
    </div>
    <slot />
  </section>
</template>

<script setup lang="ts">
defineProps<{ title: string }>()
defineSlots<{ default?: () => unknown; actions?: () => unknown }>()
</script>
