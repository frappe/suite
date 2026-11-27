<template>
  <!-- A quiet line across the thread that stands for mail not shown, with an icon that says the
       count opens. A phone keeps it inside the cards' margin, its whole row tall enough to tap. -->
  <button
    class="text-ink-gray-5 hover:text-ink-gray-8 active:text-ink-gray-8 flex w-full cursor-pointer items-center transition-colors max-sm:px-3 max-sm:py-1.5"
    :disabled="loading"
  >
    <span class="flex-1 border-t" />
    <span class="flex items-center gap-1.5 px-2 py-1 text-xs">
      <LoadingIndicator v-if="loading" class="size-3.5" />
      <span v-else class="lucide-chevrons-up-down size-3.5" aria-hidden="true" />
      {{ message }}
    </span>
    <span class="flex-1 border-t" />
  </button>
</template>

<script setup lang="ts">
import { LoadingIndicator } from 'frappe-ui'

defineProps<{ message: string; loading?: boolean }>()
</script>
