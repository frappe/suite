<!--
  What stands for an account wherever one is named: its avatar, or for every account at once a
  round mark of the avatar's size and fill. The switcher's button and its rows both draw this, so
  the row picked and the button above it show the same thing, and every label starts at the same
  place.
-->
<template>
  <Avatar v-if="name" :label="name" size="sm" />
  <span
    v-else
    class="flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-gray-2 text-ink-gray-5"
  >
    <span class="lucide-users size-3" aria-hidden="true" />
  </span>
</template>

<script setup lang="ts">
import { Avatar } from 'frappe-ui'

defineProps<{
  /** The account's name. Null stands for every account at once. */
  name: string | null
}>()
</script>
