<template>
  <template v-if="isHovered && !isMobile">
    <Tooltip v-for="action in actions" :key="action.label" :text="action.label">
      <button class="action-btn" :aria-label="action.label" @click.stop.prevent="action.onClick">
        <component :is="action.icon" class="icon text-ink-gray-5" />
      </button>
    </Tooltip>
  </template>
  <!-- A pinned row keeps its pin beside the star at rest, as a starred row keeps its star: filled, in
       blue, the one mark that says it's pinned, and a click unpins. The same on hover, so nothing
       moves. -->
  <Tooltip
    v-if="pinnable && (isHovered || pinned) && !isMobile"
    :text="pinned ? __('Unpin') : __('Pin to Top')"
  >
    <button
      class="action-btn"
      :aria-label="pinned ? __('Unpin') : __('Pin to Top')"
      @click.stop.prevent="emit('setPinned', !pinned)"
    >
      <Pin v-if="pinned" class="icon pinned" :style="PINNED_PIN_STYLE" />
      <Pin v-else class="icon text-ink-gray-5" />
    </button>
  </Tooltip>
  <!-- Touch: no hover actions, so only a pinned row's, a tap that unpins; sized as the star is. -->
  <button
    v-else-if="pinnable && pinned && isMobile"
    class="action-btn"
    :class="{ 'before-star': starrable }"
    :aria-label="__('Unpin')"
    @click.stop.prevent="emit('setPinned', false)"
  >
    <Pin class="h-5 w-5" :style="PINNED_PIN_STYLE" />
  </button>
  <Tooltip v-if="starrable && !isMobile" :text="flagged ? __('Unstar') : __('Star')">
    <button
      class="action-btn"
      :aria-label="flagged ? __('Unstar') : __('Star')"
      @click.stop.prevent="emit('setFlagged', !flagged)"
    >
      <Star
        class="icon text-ink-gray-5"
        :class="{ flagged }"
        :style="flagged ? FLAGGED_STAR_STYLE : ''"
      />
    </button>
  </Tooltip>
  <!-- Touch: no Tooltip wrapper (it can eat the first tap and never shows anyway),
	     and a larger glyph. -->
  <button
    v-else-if="starrable"
    class="action-btn"
    :class="{ 'after-pin': pinnable && pinned }"
    :aria-label="flagged ? __('Unstar') : __('Star')"
    @click.stop.prevent="emit('setFlagged', !flagged)"
  >
    <Star
      class="text-ink-gray-5 h-5 w-5"
      :class="{ flagged }"
      :style="flagged ? FLAGGED_STAR_STYLE : ''"
    />
  </button>
</template>

<script setup lang="ts">
import { Tooltip } from 'frappe-ui'
import { Pin, Star } from 'lucide-vue-next'
import { computed } from 'vue'

import { useRowActions, type RowActionKey } from '@/apps/mail/composables/useRowActions'
import { FLAGGED_STAR_STYLE, PINNED_PIN_STYLE } from '@/apps/mail/constants'
import type { Thread } from '@/apps/mail/types'
import { useScreenSize } from '@/apps/mail/utils/composables'

// The hover actions on a row, for one thread or for a whole collapsed run of them (see
// useRowActions for which it offers), and the star and pin beside them.
const {
  isHovered,
  threads,
  showStar = true,
  unarchive = false,
  drafts = false,
  pinnable = false,
} = defineProps<{
  isHovered: boolean
  // One thread for a mail row; the whole run for a stack row.
  threads: Thread[]
  // Off for stacks, where the chevron occupies the star's slot.
  showStar?: boolean
  // The list files by the filing rules, so it can take an archived thread back to the Inbox.
  unarchive?: boolean
  // The list is Drafts, whose bin discards (see useRowActions).
  drafts?: boolean
  // The list's folder takes pins. Not on a stack, whose members are never pinned.
  pinnable?: boolean
}>()

const emit = defineEmits([
  'setSeen',
  'archive',
  'unarchive',
  'trash',
  'delete',
  'setFlagged',
  'setPinned',
])

const { isMobile } = useScreenSize()

const flagged = computed(() => !!threads[0]?.flagged)
const pinned = computed(() => !!threads[0]?.pinned)

// A draft is never starred: each save replaced it with one that dropped the star. Drafts' rows, and a
// search result that is a draft, have none to offer.
const starrable = computed(
  () => showStar && !drafts && !threads.every((t) => t.draft && !t.messages?.length),
)

const run: Record<RowActionKey, () => void> = {
  unread: () => emit('setSeen', false),
  read: () => emit('setSeen', true),
  archive: () => emit('archive'),
  unarchive: () => emit('unarchive'),
  trash: () => emit('trash'),
  delete: () => emit('delete'),
}

const rowActions = useRowActions(() => ({ threads, unarchive, drafts }))
const actions = computed(() =>
  rowActions.value.map((action) => ({ ...action, onClick: run[action.key] })),
)
</script>

<style scoped>
.action-btn {
  /* One square box per action, the size of its glyph and centred on it, whatever wraps the glyph
     (a tooltip's span, or nothing): a bare inline svg sat on the button's text baseline instead,
     taller than its glyph and lower than the wrapped ones beside it. */
  @apply inline-flex size-4 shrink-0 items-center justify-center max-sm:size-5;
  /* Mobile: uneven halo — generous left/right/top, but bottom capped at 10px (the
	   star's clearance to the row border) so taps meant for the next row's first
	   line are never captured. ~68×54px effective target on a 20px glyph. */
  @apply relative after:absolute after:content-[''] max-sm:after:-bottom-2.5 max-sm:after:-left-6 max-sm:after:-right-6 max-sm:after:-top-6 sm:after:-inset-1.5;
}

/* A pinned row's pin beside its star on a phone: each halo stops halfway across the gap between
   them, or the star's, drawn over the pin's, takes the taps meant for the pin. */
.action-btn.before-star {
  @apply max-sm:after:-right-1.5;
}
.action-btn.after-pin {
  @apply max-sm:after:-left-1.5;
}

/* Hover-capable pointers only: on touch, :hover sticks after a tap and the
   star would stay dark until something else is touched. A flagged star and a
   pinned row's pin are exempt, or their colour wouldn't show until the pointer
   left the button. */
@media (hover: hover) {
  .action-btn:hover > :not(.flagged, .pinned) {
    color: var(--ink-gray-8) !important;
    stroke-width: 2 !important;
  }
}
</style>
