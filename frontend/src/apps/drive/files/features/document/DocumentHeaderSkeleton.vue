<template>
  <!-- The document header's shape while the document opens: same height, gutters and slots.
       Plain elements, not frappe-ui's Skeleton: this ships with the Drive package root,
       which stays out of frappe-ui's chunk. -->
  <header
    class="flex h-12 shrink-0 items-center gap-2 border-b border-outline-gray-1 bg-surface-base px-3 sm:px-5"
    role="status"
    :aria-label="title ? `Opening ${title}` : 'Opening document'"
  >
    <div class="flex min-w-0 flex-1 items-center gap-1">
      <span class="size-4 shrink-0 animate-pulse rounded-3 bg-surface-gray-3" />
      <span v-if="title" class="min-w-0 truncate px-2 text-base font-medium text-ink-gray-8">{{
        title
      }}</span>
      <span v-else class="ml-2 h-4 w-40 animate-pulse rounded-4 bg-surface-gray-3" />
    </div>
    <div class="flex shrink-0 items-center gap-1" aria-hidden="true">
      <span class="size-7 animate-pulse rounded-4 bg-surface-gray-3" />
      <span class="size-7 animate-pulse rounded-4 bg-surface-gray-3" />
      <span class="ml-1 h-7 w-20 animate-pulse rounded-4 bg-surface-gray-3 max-md:w-7" />
    </div>
  </header>
</template>

<script setup lang="ts">
defineProps<{ title?: string }>()
</script>
