<!--
  What a Settings list or section shows when it has nothing in it. Put it in
  the `SettingsSection` in place of the rows.

  - `title` says what is missing ("No folders yet"); `description` says, in
    one line, what the thing is for.
  - The default slot takes one action, such as the button that makes the
    first item, when the section header has none.
-->
<template>
  <div class="flex flex-col items-center rounded-6 bg-surface-gray-1 px-6 py-8 text-center">
    <span v-if="icon" :class="[icon, 'mb-3 size-5 text-ink-gray-5']" aria-hidden="true" />
    <p class="text-base-medium text-ink-gray-8">{{ title }}</p>
    <p v-if="description" class="mt-1 max-w-sm text-p-base text-ink-gray-6">{{ description }}</p>
    <div v-if="$slots.default" class="mt-4">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  title: string
  description?: string
  /** A lucide class, for example `'lucide-folder'`. */
  icon?: string
}>()
defineSlots<{ default?: () => unknown }>()
</script>
