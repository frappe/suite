<template>
  <!-- Mobile: the filter selector alone, in a row the caller places and borders. The
	     mailbox's row sits inside a header block (title, auto-delete banner, selection
	     variant) whose border spans all of it; All Inboxes has no such block. So the row
	     owns no border of its own. -->
  <div v-if="isMobile" class="relative flex h-12 items-center px-4">
    <!-- The selector label carries the active filters ("Unread", "Unread +1");
		     unticking them in the sheet clears them, so no dismissal chip needed. -->
    <AdaptiveDropdown :options="filterOptions" :title="__('Filter')">
      <button class="flex min-w-0 items-center gap-1.5 text-base !font-medium">
        <ListFilter class="text-ink-gray-6 h-4 w-4 shrink-0" />
        <span class="truncate">{{ title }}</span>
        <ChevronDown class="text-ink-gray-5 h-4 w-4 shrink-0" />
      </button>
    </AdaptiveDropdown>
    <!-- Actions on the list as a whole, such as clearing an Inbox tab. -->
    <div class="-mr-1.5 ml-auto flex items-center"><slot name="mobile-actions" /></div>
  </div>

  <!-- Desktop -->
  <div v-else class="relative flex items-center border-b px-3.5 py-2.5 sm:px-5">
    <!-- Select-all checkbox in the mailbox list; All Inboxes has no selection. -->
    <slot name="lead" />

    <!-- The filter chips stand where the filter selector goes, as long as every chip fits beside
         the buttons at the row's end. A list column too narrow for them (a split view on a
         laptop, say) gets the selector instead: the same filters, as checkboxes in its menu, and
         its title says which are on. Which one shows follows the room, not the layout. -->
    <div v-if="$slots.filter" ref="area" class="flex min-w-0 flex-1 items-center">
      <div v-if="chipsFit" ref="chips" class="-my-1 flex w-max shrink-0 items-center py-1">
        <slot name="filter" />
      </div>
      <Dropdown v-else :options="filterOptions">
        <button
          class="text-ink-gray-8 hover:bg-surface-gray-2 -ml-2 flex min-w-0 items-center gap-1 rounded-4 px-2 py-1"
        >
          <ListFilter class="text-ink-gray-6 icon shrink-0" />
          <span class="truncate">{{ title }}</span>
          <ChevronDown class="text-ink-gray-5 icon shrink-0" />
        </button>
      </Dropdown>
    </div>
    <template v-else>
      <Dropdown v-if="showFilter" :options="filterOptions">
        <button
          class="text-ink-gray-8 hover:bg-surface-gray-2 -ml-2 flex min-w-0 items-center gap-1 rounded-4 px-2 py-1"
        >
          <ListFilter class="text-ink-gray-6 icon shrink-0" />
          <span class="truncate">{{ title }}</span>
          <ChevronDown class="text-ink-gray-5 icon shrink-0" />
        </button>
      </Dropdown>
      <!-- Not every title is the filter's: a selection count and a search result count
		     both land here, and neither opens a menu. -->
      <p v-else class="pb-0.5">{{ title }}</p>
    </template>

    <div class="-mr-1.5 ml-auto flex shrink-0 items-center space-x-2 pl-2">
      <!-- The caller's actions come first, so Refresh keeps the far end whatever they are and
			     nothing shifts as they come and go (an Inbox tab's own menu, say). -->
      <slot name="actions" />
      <!-- Hides while rows are selected, where the slot's bulk actions take the
			     cluster over: refreshing mid-selection would drop the selection. -->
      <template v-if="showActions">
        <Button
          variant="ghost"
          :tooltip="__('Refresh')"
          :disabled="fetching"
          @click="emit('refresh')"
        >
          <template #icon>
            <RefreshCw class="icon" />
          </template>
        </Button>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useResizeObserver } from '@vueuse/core'
import { Button, Dropdown } from 'frappe-ui'
import { ChevronDown, ListFilter, RefreshCw } from 'lucide-vue-next'
import { computed, ref } from 'vue'

import { useScreenSize } from '@/apps/mail/utils/composables'
import type { FilterOption } from '@/apps/mail/utils/listFilter'
import AdaptiveDropdown from '@/components/AdaptiveDropdown.vue'

// The row above the list, shared by the mailbox list and the merged All Inboxes list:
// filter selector on the left, Split View and Refresh on the right. The two lists differ
// only in what they add — a select-all checkbox and bulk actions — so those arrive
// through slots rather than as another copy of the row.

const {
  title,
  filterOptions,
  showFilter = true,
  showActions = true,
  fetching = false,
} = defineProps<{
  /** What the selector reads: usually the filter's name, sometimes a count. */
  title: string
  filterOptions: FilterOption[]
  /** False renders the title as plain text — no menu to open. */
  showFilter?: boolean
  /** False hands the right-hand cluster entirely to the `actions` slot. */
  showActions?: boolean
  fetching?: boolean
}>()

const emit = defineEmits<{ refresh: [] }>()

const { isMobile } = useScreenSize()
// Chips while they fit, else the selector. Their natural width is measured while they show and
// kept once they give way, so they come back as soon as the row has room for them again.
const area = ref<HTMLElement>()
const chips = ref<HTMLElement>()
const areaWidth = ref(0)
const chipsWidth = ref(0)
useResizeObserver(area, ([entry]) => (areaWidth.value = entry.contentRect.width))
useResizeObserver(chips, () => (chipsWidth.value = chips.value?.scrollWidth ?? 0))
const chipsFit = computed(() => !chipsWidth.value || chipsWidth.value <= areaWidth.value)
</script>
