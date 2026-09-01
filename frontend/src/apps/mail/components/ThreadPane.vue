<template>
	<!-- The list column. With Split View on it's a share of the viewport and the pane
	     takes the rest (see constants.ts, shared with the screener); otherwise it
	     fills the width and the pane overlays it (or, on mobile, slides in over it). -->
	<!-- border-r only in Split View: full-width mode has nothing of its own to
	     the right, and anything that does sit there (the event detail sidebar)
	     brings its own border-l — keeping both would double the hairline. -->
	<div
		class="sticky top-16 flex flex-col"
		:class="!isMobile && showReadingPane ? SPLIT_LIST_CLASS : 'w-full'"
	>
		<slot name="list" />
	</div>

	<!-- The open thread, in place: beside the list on desktop with Split View on, a
	     full-bleed overlay otherwise.
	     Mobile opens as a page push (iOS-style slide from the right): the pane stays mounted and
	     slides via transform, so close animates too. visibility rides the same transition — it
	     flips only after the slide-out ends, keeping the offscreen pane out of the focus order.
	     Teleported to body on mobile (like the selection bar): inside the layout's isolate
	     stacking context the remounting tab bar paints over the pane during the slide-out,
	     whatever the pane's own z-index says. -->
	<Teleport to="body" :disabled="!isMobile">
		<div
			class="bg-surface-base"
			:class="{
				'overflow-hidden': isMobile,
				[SPLIT_PANE_CLASS]: !isMobile && showReadingPane,
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
import { useReadingPane, useScreenSize } from '@/apps/mail/utils/composables'
import { SPLIT_LIST_CLASS, SPLIT_PANE_CLASS } from '@/apps/mail/constants'

/**
 * The two halves of a thread list view: the list column, and the reading pane beside/over it.
 *
 * Both halves are sized from one setting and one "is a thread open" flag, which is exactly why they
 * live in one component: every geometry rule here (column against pane, overlay against split,
 * the mobile slide) is a statement about the pair. Kept apart, the mailbox list and the merged All
 * Inboxes list each grew their own copy and the copies drifted — the merged one shipped without the
 * Teleport, so the mobile tab bar painted over its pane.
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
const showReadingPane = useReadingPane()
</script>
