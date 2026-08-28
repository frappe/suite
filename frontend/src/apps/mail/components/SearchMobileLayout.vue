<template>
	<!-- Appears in place, no slide: searching and results are one page, so motion would read
	     as a different surface. Stops above the tab bar (border + h-15 + safe area, so the
	     bar's top hairline stays visible) — the bar's tabs dismiss the overlay; back gesture
	     works via the history entry. That strip goes away with the bar itself once the
	     keyboard is up, so the results run to the bottom edge rather than leaving a gap
	     where the bar was. Teleported to body: one host instance lives inside
	     MailboxView's CSS-hidden desktop header (via HeaderActions), where a fixed child
	     would never paint on mobile — and the layout's isolate stacking context would trap
	     its z-index anyway. -->
	<Teleport to="body">
		<div
			v-show="show"
			class="bg-surface-base fixed inset-x-0 top-0 z-10 overflow-y-auto pt-[env(safe-area-inset-top)]"
			:class="
				keyboardOpen ? 'bottom-0' : 'bottom-[calc(3.75rem+1px+env(safe-area-inset-bottom))]'
			"
		>
			<slot />
		</div>
	</Teleport>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue'

import { useKeyboardOpen } from '@/apps/mail/utils/composables'

const show = defineModel<boolean>()

const keyboardOpen = useKeyboardOpen()

const close = () => {
	if (show.value) show.value = false
}

watch(show, (val) => {
	if (val) history.pushState(null, '')
})

onMounted(() => window.addEventListener('popstate', close))
onUnmounted(() => window.removeEventListener('popstate', close))
</script>
