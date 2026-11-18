<!--
  What a Settings list or section shows when it has nothing in it. Put it in
  the `SettingsSection` in place of the rows.

  It stays quiet, at the size of a row, so it never outweighs the section
  heading or the real content around it. The section header keeps the action
  that makes the first item ("New").

  - `title` says what is missing ("No folders yet").
  - `description` says, in one line, what the thing is for.
-->
<template>
  <div class="flex flex-col gap-1 py-3.5">
    <p class="text-base text-ink-gray-6">{{ title }}</p>
    <p v-if="description" class="text-p-sm text-ink-gray-5">{{ description }}</p>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  title: string
  description?: string
}>()
</script>
