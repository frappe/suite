<template>
	<!-- Controlled from outside and hung on an element it does not own: the pill
	     a click landed on, which the calendar renders and this cannot wrap in a
	     trigger. reka's anchor takes a reference of its own, so the trigger goes
	     unused and the open state is the host's — the route's, in the calendar. -->
	<PopoverRoot :open="open" @update:open="(value) => !value && emit('close')">
		<!-- Hidden: with a reference given, reka positions against that and the
		     element the anchor renders is only the place it is registered from. -->
		<PopoverAnchor :reference="anchor ?? undefined" class="hidden" />
		<PopoverPortal>
			<!-- z-50, the layer frappe-ui's dialogs sit on, not the 100 its own
			     popover takes. The library pins dialogs at 50 and its floating
			     family — menus, popovers — at 100 so they can open above a dialog.
			     This card is on the other side of that: it raises dialogs (delete's
			     confirmation, an RSVP's scope), and a dialog portaled after it on
			     the same layer is on top, where at 100 the card stood over the
			     question it had just asked. Its own menu still clears it at 100. -->
			<PopoverContent
				class="z-50"
				:side="side"
				align="center"
				:side-offset="4"
				:collision-padding="10"
				@interact-outside="onInteractOutside"
				@focus-outside="onFocusOutside"
			>
				<!-- frappe-ui's floating-panel shell, to the class: the library keeps it
				     behind its own Popover, which needs a trigger, so the surface is
				     drawn here and this card reads as one of the family. -->
				<div
					class="overflow-hidden rounded-6 bg-surface-elevation-2 shadow-2xl ring-1 ring-black ring-opacity-5"
				>
					<slot />
				</div>
			</PopoverContent>
		</PopoverPortal>
	</PopoverRoot>
</template>

<script setup lang="ts">
import { useEventListener } from '@vueuse/core'
import { PopoverAnchor, PopoverContent, PopoverPortal, PopoverRoot } from 'reka-ui'

const { open, anchor, side, anchorMoves = false } = defineProps<{
	open: boolean
	/** The element the card hangs off. reka follows it when it changes. */
	anchor: Element | null
	side: 'top' | 'right' | 'bottom' | 'left'
	/** Whether the anchor can be dragged — a pill in the grid can, a row in the rail cannot. */
	anchorMoves?: boolean
}>()

const emit = defineEmits<{ close: [] }>()

// Focus leaving is not a dismissal. This card's open state belongs to the route, and
// focus moves for reasons that have nothing to do with it — above all the command palette
// closing, which hands focus back to whatever it took it from (the header's Next arrow,
// say) and would otherwise shut the card the search had just opened.
//
// reka emits `focusOutside` and `interactOutside` on the same event and dismisses unless it
// is default-prevented, so preventing here settles both. A press outside still closes the
// card: that is `pointerDownOutside`, which reaches `onInteractOutside` below.
const onFocusOutside = (event: Event) => event.preventDefault()

// A press on the anchor is not a press outside: the host toggles on that press,
// and a dismiss racing the toggle would close and reopen in one click — the
// guard frappe-ui's Popover puts on its own trigger.
const onInteractOutside = (event: Event) => {
	const target = event.target as Element | null
	if (target && anchor?.contains(target)) event.preventDefault()
}

// A drag of the anchor closes the card: the pill is about to move out from under
// it. Read the way the calendar reads it for its own popover — a press on the
// pill followed by a move, which is where a press stops being a click, so a
// click that does not move still toggles. A resize starts with the same press
// on the pill's handle and goes the same way. The month's pills move by the
// browser's own drag and drop, which announces itself. Only where the anchor
// can move at all: a press that slides on a row of the rail is nothing.
const onAnchorMouseDown = () => {
	if (!open || !anchorMoves) return
	const onMove = () => {
		window.removeEventListener('mouseup', onUp)
		emit('close')
	}
	const onUp = () => window.removeEventListener('mousemove', onMove)
	window.addEventListener('mousemove', onMove, { once: true })
	window.addEventListener('mouseup', onUp, { once: true })
}

useEventListener(() => anchor, 'mousedown', onAnchorMouseDown)
useEventListener(() => anchor, 'dragstart', () => open && anchorMoves && emit('close'))
</script>
