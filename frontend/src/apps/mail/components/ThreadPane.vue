<template>
  <!-- The list column. With Split View on it's a share of the viewport and the pane
	     takes the rest (see constants.ts, shared with the screener); otherwise it
	     fills the width and the pane overlays it (or, on mobile, slides in over it). -->
  <!-- border-r only in Split View: full-width mode has nothing of its own to
	     the right to rule off from. -->
  <div
    ref="listColumn"
    class="sticky top-16 flex flex-col"
    :class="[
      split ? SPLIT_LIST_CLASS : 'w-full',
      // A width saved on a wider window still leaves the pane what a drag would.
      { 'max-w-[calc(100%-25rem)] lg:max-w-[calc(100%-30rem)]': split && listWidth },
    ]"
    :style="split && listWidth ? { width: `${listWidth}px` } : undefined"
  >
    <slot name="list" />
    <!-- The divide between list and pane, dragged to share the width differently. It straddles
	     the column's border; the line it shows on hover and while dragging is the border made
	     heavier. Double-click hands the column back to its default share; the arrow keys move it
	     from the keyboard. -->
    <div
      v-if="split"
      role="separator"
      aria-orientation="vertical"
      :aria-label="__('Resize list')"
      :aria-valuenow="listColumn?.offsetWidth"
      tabindex="0"
      class="group/resize absolute -right-1.5 top-0 z-10 flex h-full w-3 cursor-col-resize justify-center focus:outline-none"
      @pointerdown="startResize"
      @dblclick="resetWidth"
      @keydown.left.prevent="nudge(-16)"
      @keydown.right.prevent="nudge(16)"
    >
      <span
        class="h-full w-0.5 transition-colors group-hover/resize:bg-outline-gray-3 group-focus-visible/resize:bg-outline-gray-3"
        :class="{ 'bg-outline-gray-3': resizing }"
      />
    </div>
  </div>

  <!-- The open thread, in place: beside the list on desktop with Split View on, a
	     full-bleed overlay otherwise.
	     Mobile opens as a page push (iOS-style slide from the right): the pane stays mounted and
	     slides via transform, so close animates too. visibility rides the same transition — it
	     flips only after the slide-out ends, keeping the offscreen pane out of the focus order.
	     Teleported to Mail's overlay layer on mobile (like the selection bar): inside the layout's isolate
	     stacking context the remounting bottom nav paints over the pane during the slide-out,
	     whatever the pane's own z-index says. -->
  <Teleport :to="overlayLayer ?? 'body'" :disabled="!isMobile">
    <div
      class="bg-surface-base"
      :class="{
        'overflow-hidden': isMobile,
        [SPLIT_PANE_CLASS]: split,
        'absolute bottom-0 left-0 right-0 top-0': !isMobile && !showReadingPane,
        'fixed inset-0 z-20 pt-[env(safe-area-inset-top)] transition-[transform,visibility] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]':
          isMobile,
        'invisible translate-x-full': isMobile && !threadOpen,
        hidden: !isMobile && !showReadingPane && !threadOpen,
      }"
      @touchstart.passive="emit('touchStart', $event)"
      @touchmove.passive="emit('touchMove', $event)"
      @touchend.passive="emit('touchEnd', $event)"
    >
      <!-- The swipe slide lives inside MailThread (its toolbar must not move), armed via
			     `slide` per swipe and cleared on slide-done. The scroll wrapper must be h-full on
			     desktop too, or the empty state's h-full collapses. -->
      <div class="h-full overflow-y-auto">
        <slot />
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { usePortalTarget } from 'frappe-ui'
import { computed, onBeforeUnmount, ref, useTemplateRef } from 'vue'

import { SPLIT_LIST_CLASS, SPLIT_PANE_CLASS } from '@/apps/mail/constants'
import { useReadingPane, useScreenSize } from '@/apps/mail/utils/composables'
import { clampListWidth, readListWidth, writeListWidth } from '@/apps/mail/utils/splitWidth'

/**
 * The two halves of a thread list view: the list column, and the reading pane beside/over it.
 *
 * Both halves are sized from one setting and one "is a thread open" flag, which is exactly why they
 * live in one component: every geometry rule here (column against pane, overlay against split,
 * the mobile slide) is a statement about the pair. Kept apart, the mailbox list and the merged All
 * Inboxes list each grew their own copy and the copies drifted — the merged one shipped without the
 * Teleport, so the phone's bottom bar painted over its pane.
 *
 * The list content goes in `#list`, the thread in the default slot. Both are the caller's — this
 * owns nothing but the frame.
 */

const { threadOpen } = defineProps<{
  /** Whether a thread is open. Drives the mobile slide-in and the desktop hidden/overlay state. */
  threadOpen: boolean
}>()

// Swipe-to-page on the open thread is per-view (what "next thread" means differs), so the pane only
// forwards the touches. `.passive` stays on the listener here, where the native event is bound.
const emit = defineEmits<{
  touchStart: [TouchEvent]
  touchMove: [TouchEvent]
  touchEnd: [TouchEvent]
}>()

const { isMobile } = useScreenSize()
// MailLayout's overlay layer; see the Teleport above.
const overlayLayer = usePortalTarget()
const showReadingPane = useReadingPane()
const split = computed(() => !isMobile.value && showReadingPane.value)

// The list column's dragged width, or none for its default share of the screen.
const listColumn = useTemplateRef('listColumn')
const listWidth = ref(readListWidth())
const resizing = ref(false)

const clampTo = (width: number) => {
  const row = listColumn.value?.parentElement?.clientWidth ?? window.innerWidth
  return clampListWidth(width, row, window.innerWidth >= 1024)
}

// Ends the drag under way, if one is. Held here rather than in the handler so leaving the view
// mid-drag ends it too: the handle that would hear the pointer go up goes with the view, and the
// page was left with text selection off and the resize cursor over everything.
let stopResize: (() => void) | undefined

const startResize = (event: PointerEvent) => {
  if (event.button !== 0 || !listColumn.value) return
  event.preventDefault()
  const handle = event.currentTarget as HTMLElement
  handle.setPointerCapture(event.pointerId)
  const startX = event.clientX
  const startWidth = listColumn.value.offsetWidth
  resizing.value = true
  // Text under a fast pointer would be selected along the way, and the cursor would flicker
  // back to an arrow wherever the pointer outran the handle.
  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'col-resize'

  const move = (e: PointerEvent) => (listWidth.value = clampTo(startWidth + e.clientX - startX))
  const end = () => {
    stopResize = undefined
    resizing.value = false
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
    handle.removeEventListener('pointermove', move)
    handle.removeEventListener('pointerup', end)
    handle.removeEventListener('pointercancel', end)
    handle.removeEventListener('lostpointercapture', end)
    writeListWidth(listWidth.value)
  }
  stopResize = end
  handle.addEventListener('pointermove', move)
  handle.addEventListener('pointerup', end)
  handle.addEventListener('pointercancel', end)
  handle.addEventListener('lostpointercapture', end)
}
onBeforeUnmount(() => stopResize?.())

const nudge = (by: number) => {
  if (!listColumn.value) return
  listWidth.value = clampTo(listColumn.value.offsetWidth + by)
  writeListWidth(listWidth.value)
}

const resetWidth = () => {
  listWidth.value = undefined
  writeListWidth()
}
</script>
