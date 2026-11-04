<template>
  <!-- Shared mobile title row (mailbox / all inboxes / screener / profile): 2xl
	     semibold title, an optional back button, and the actions slot on the right. In a
	     folder (`withMenu`) the ☰, the folder's name and a chevron are one button that opens
	     the folders, as the folder tab in Mail's bottom bar (MailTabBar) does. Without a
	     leading button the title gets pl-4 (4px row + 16px = 20px) to sit on the px-5 axis of
	     the list content below it; with one, the button's own inset provides the offset. -->
  <!-- A flat h-14 (56px), not a min-height and no vertical padding: the row is the same
	     height in every view and `items-center` centres against the whole of it. Anything
	     taller than 56px in the actions slot would overflow rather than grow the row —
	     which is the trade that keeps the four views level. -->
  <div class="flex h-14 items-center gap-1 px-1">
    <template v-if="withMenu">
      <button
        type="button"
        aria-haspopup="dialog"
        class="flex h-10 min-w-0 items-center rounded-full pr-2"
        @click="openAreaSidebar('mail')"
      >
        <!-- 20px at the 1.5 the app draws its icons at: the title's own size. Sized by
				     class: lucide-vue-next's `lucide-<name>` class collides with frappe-ui's mask
				     rule, which overrides the size prop. -->
        <span :class="ICON_SLOT"><Menu class="size-5" /></span>
        <span :class="TITLE">{{ title }}</span>
        <ChevronDown class="text-ink-gray-5 ml-1 size-4 shrink-0" />
      </button>
      <div class="flex-1" />
    </template>
    <!-- The back arrow stands where the ☰ does, at its size, and the title starts where the
         folder's name does: a category and its Inbox read as the same row. -->
    <div v-else class="flex min-w-0 flex-1 items-center" :class="{ 'pl-4': !withBack }">
      <button v-if="withBack" :aria-label="__('Back')" :class="ICON_SLOT" @click="emit('back')">
        <ChevronLeft class="size-5" />
      </button>
      <span :class="TITLE">{{ title }}</span>
    </div>
    <slot name="actions" />
  </div>
</template>

<script setup lang="ts">
import { ChevronDown, ChevronLeft, Menu } from 'lucide-vue-next'

import { openAreaSidebar } from '@/platform/area-sidebar'

defineProps<{
  title: string
  withMenu?: boolean
  withBack?: boolean
}>()

const emit = defineEmits<{ back: [] }>()

/** The round 40px hit area of the row's leading icon. */
const ICON_SLOT = 'text-ink-gray-6 flex h-10 w-10 shrink-0 items-center justify-center rounded-full'
const TITLE = 'text-ink-gray-8 truncate text-xl !font-semibold tracking-[-0.01em]'
</script>
