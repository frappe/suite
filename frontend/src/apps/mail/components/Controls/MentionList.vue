<template>
  <!-- Bare root: the popup is positioned around whatever this renders, so an empty
	     query (or a search that came back with nothing) must render nothing at all
	     rather than an empty panel hanging off the caret. -->
  <div>
    <!-- Capped at the viewport, less the 8px the popup keeps from either edge: nothing else bounds
	       it, so a long address would push it off a phone's screen instead of truncating. -->
    <div
      v-if="items.length"
      class="bg-surface-base max-h-64 max-w-[calc(100vw-1rem)] min-w-56 overflow-y-auto rounded-6 p-1 shadow-lg"
    >
      <!-- Picks on mousedown, default prevented: letting the press land would pull
			     focus out of the editor, and the suggester drops the popup the moment the
			     selection leaves the `@` it is tracking — so the row is gone before any
			     click can arrive. -->
      <ItemListRow
        v-for="(item, index) in items"
        :key="item.email"
        :ref="(el) => setItemRef(el, index)"
        as="button"
        class="text-left"
        :selected="index === selectedIndex"
        @mousedown.prevent="selectItem(index)"
        @mouseover="selectedIndex = index"
      >
        <template #prefix>
          <Avatar :image="item.image" :label="item.display_name || item.email" size="lg" />
        </template>
        <template #label>
          <ContactOption :contact="item" />
        </template>
      </ItemListRow>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Avatar, ItemListRow } from 'frappe-ui'
import { nextTick, onBeforeUpdate, ref, watch, type ComponentPublicInstance } from 'vue'

import ContactOption from '@/apps/mail/components/Controls/ContactOption.vue'
import type { MentionCandidate } from '@/apps/mail/utils/mentionSuggestion'

// The suggestion renderer drives this list by keyboard through the exposed handler —
// the caret stays in the editor, so the list never holds focus itself.
const props = defineProps<{
  items: MentionCandidate[]
  command: (item: MentionCandidate) => void
}>()

const selectedIndex = ref(0)
const itemRefs = ref<(HTMLElement | null)[]>([])

onBeforeUpdate(() => (itemRefs.value = []))

// The rows are components, so what comes back is an instance — scrolling wants its
// element.
const setItemRef = (el: Element | ComponentPublicInstance | null, index: number) => {
  const element = el instanceof Element ? el : el?.$el
  itemRefs.value[index] = element instanceof HTMLElement ? element : null
}

const selectItem = (index: number) => {
  const item = props.items[index]
  if (item) props.command(item)
}

const move = (by: number) => {
  const count = props.items.length
  selectedIndex.value = (selectedIndex.value + by + count) % count
  nextTick(() => itemRefs.value[selectedIndex.value]?.scrollIntoView({ block: 'nearest' }))
}

const onKeyDown = ({ event }: { event: KeyboardEvent }) => {
  if (!props.items.length) return false

  if (event.key === 'ArrowUp') return (move(-1), true)
  if (event.key === 'ArrowDown') return (move(1), true)
  if (event.key === 'Enter') return (selectItem(selectedIndex.value), true)

  return false
}

// A fresh result set is a fresh list: keeping the old index would arm Enter on
// whichever row happened to land in that slot.
watch(
  () => props.items,
  () => (selectedIndex.value = 0),
)

defineExpose({ onKeyDown })
</script>
