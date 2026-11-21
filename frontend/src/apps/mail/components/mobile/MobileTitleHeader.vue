<template>
  <!-- Shared mobile title row (mailbox / all inboxes / screener / profile): a semibold
	     title, an optional back button, and the actions slot on the right. In a folder
	     (`withMenu`) the folder's name and a chevron are one button that opens the folders, as
	     the folder tab in Mail's bottom bar (MailTabBar) does; the name starts 16px in, over the
	     filter chips. Without a leading button the title gets pl-4 (4px row + 16px = 20px) to
	     sit on the px-5 axis of the list content below it; with one, the button's own inset
	     provides the offset. -->
  <!-- A flat h-14 (56px), not a min-height and no vertical padding: the row is the same
	     height in every view and `items-center` centres against the whole of it. Anything
	     taller than 56px in the actions slot would overflow rather than grow the row —
	     which is the trade that keeps the four views level. -->
  <div class="flex h-14 items-center gap-1 px-1">
    <template v-if="withMenu">
      <button
        type="button"
        aria-haspopup="dialog"
        class="touch-target ml-3 flex h-10 min-w-0 items-center gap-1 pr-2"
        @click="openAreaSidebar('mail')"
      >
        <span :class="[TITLE, 'text-3xl']">{{ title }}</span>
        <!-- Sized by class: lucide-vue-next's `lucide-<name>` class collides with frappe-ui's
             mask rule, which overrides the size prop. -->
        <ChevronDown class="text-ink-gray-5 size-5 shrink-0" />
      </button>
      <div class="flex-1" />
    </template>
    <!-- The back arrow stands where the ☰ does, at its size, and the title starts where the
         folder's name does: a category and its Inbox read as the same row. -->
    <div v-else class="flex min-w-0 flex-1 items-center" :class="{ 'pl-4': !withBack }">
      <button v-if="withBack" :aria-label="__('Back')" :class="ICON_SLOT" @click="emit('back')">
        <ChevronLeft class="size-5" />
      </button>
      <span :class="[TITLE, 'text-xl']">{{ title }}</span>
    </div>
    <slot name="actions" />
  </div>
</template>

<script setup lang="ts">
import { ChevronDown, ChevronLeft } from 'lucide-vue-next'

import { openAreaSidebar } from '@/platform/area-sidebar'

defineProps<{
  title: string
  withMenu?: boolean
  withBack?: boolean
}>()

const emit = defineEmits<{ back: [] }>()

/** The round 40px hit area of the row's leading icon. */
const ICON_SLOT =
  'touch-target text-ink-gray-6 flex h-10 w-10 shrink-0 items-center justify-center rounded-full'
const TITLE = 'text-ink-gray-8 truncate !font-semibold tracking-[-0.01em]'
</script>
