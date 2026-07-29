<template>
	<!-- Appears in place, no slide: searching and results are one page, so motion would read
	     as a different surface. Stops above the tab bar (border + h-15 + safe area, so the
	     bar's top hairline stays visible) — the bar's tabs dismiss the overlay; back gesture
	     works via the history entry. Teleported to body: one host instance lives inside
	     MailboxView's CSS-hidden desktop header (via HeaderActions), where a fixed child
	     would never paint on mobile — and the layout's isolate stacking context would trap
	     its z-index anyway. -->
	<Teleport to="body">
		<div
			v-show="show"
			class="bg-surface-base fixed inset-x-0 bottom-[calc(3.75rem+1px+env(safe-area-inset-bottom))] top-0 z-10 overflow-y-auto pt-[env(safe-area-inset-top)]"
		>
			<slot name="body" />
		</div>
	</Teleport>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue'

const show = defineModel<boolean>()

const close = () => {
	if (show.value) show.value = false
}

watch(show, (val) => {
	if (val) history.pushState(null, '')
})

onMounted(() => window.addEventListener('popstate', close))
onUnmounted(() => window.removeEventListener('popstate', close))
</script>
