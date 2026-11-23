<template>
  <!-- The document header's shape while the document opens: same height, gutters and slots.
       Plain elements, not frappe-ui's Skeleton: this ships with the Drive package root,
       which stays out of frappe-ui's chunk. -->
  <header
    class="flex h-12 shrink-0 items-center gap-2 border-b border-outline-gray-1 bg-surface-base px-3 pt-px"
    role="status"
    :aria-label="title ? `Opening ${title}` : 'Opening document'"
  >
    <div class="flex min-w-0 flex-1 items-center gap-1">
      <!-- The way back and the icon take DocumentHeader's sizes, so the title stays put when it loads. -->
      <span v-if="location" class="size-7 shrink-0" aria-hidden="true" />
      <span class="size-4.5 shrink-0 animate-pulse rounded-3 bg-surface-gray-3" />
      <span v-if="title" class="min-w-0 truncate px-2 text-base font-medium text-ink-gray-8">{{
        title
      }}</span>
      <span v-else class="ml-2 h-4 w-40 animate-pulse rounded-4 bg-surface-gray-3" />
    </div>
    <div class="flex shrink-0 items-center gap-1" aria-hidden="true">
      <!-- A file in a folder keeps its pager's width, empty as the pager is while it loads. -->
      <span v-if="location" class="h-7 w-30 max-md:w-15" />
      <span v-else class="me-1 h-3 w-20 animate-pulse rounded-3 bg-surface-gray-3 max-md:hidden" />
      <!-- Share, then the menu. -->
      <span class="h-7 w-20 animate-pulse rounded-4 bg-surface-gray-3 max-md:w-7" />
      <span class="size-7 animate-pulse rounded-4 bg-surface-gray-3" />
    </div>
  </header>
</template>

<script setup lang="ts">
defineProps<{
  title?: string
  /** The folder the file's header leads back to, when the opener knew it. */
  location?: string
}>()
</script>
