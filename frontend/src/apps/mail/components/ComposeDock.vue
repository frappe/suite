<template>
	<!-- The composer's two non-modal presentations: docked to the bottom-right, and minimised to
	     its own title bar. The modal state is frappe-ui's Dialog, unchanged — see SendMail, which
	     owns the state and moves the editor between the two containers.

	     Deliberately not a Dialog: docking exists so the mail you want to quote stays reachable
	     (#407), and a Dialog is `fixed inset-0` with a backdrop over exactly that. Nothing here
	     traps focus, locks scrolling or answers to Esc — the page behind is simply live.

	     Teleported to body for the reason SendMailMobileLayout is: the layout's `isolate` paints
	     its subtree as one unit, so a composer opened from inside a thread would lose to the
	     thread pane, which teleports out itself.

	     surface-elevation-1, not surface-base: that is what the Dialog paints itself and its body
	     with, and the two states are the same window. They match in light mode either way; in dark
	     the base is the page's own colour, so a docked composer sank into the list behind it.

	     right-5, because that is where the app's right edge already is: the reading pane's messages
	     and the list's rows both sit on `sm:px-5`. Any other offset leaves the panel a few pixels
	     off a line that is on screen next to it.

	     The width is the toolbar's, not a taste: it is `flex-wrap justify-between`, so anything
	     narrower than its two groups drops Discard and Send onto a second line. 42rem fits because
	     the composer's toolbar has no alignment group (see useTextEditorButtons); put those three
	     back and this has to grow to about 48rem. -->
	<Teleport to="body">
		<div
			v-if="show"
			class="bg-surface-elevation-1 border-outline-gray-2 fixed bottom-0 right-5 z-30 flex max-h-[calc(100vh-3rem)] w-[42rem] max-w-[calc(100vw-2.5rem)] flex-col rounded-t-lg border border-b-0 shadow-2xl"
		>
			<!-- The whole bar toggles: a bar carrying one small target invites the miss that
			     closes the draft instead. The buttons stop propagation so they keep their own job.

			     No colour of its own, so it takes the default (outline-gray-1) — the same line the
			     editor draws under the fields and over the toolbar, and the same one every list
			     row and thread divider in mail uses. Only the panel's outer edge is gray-2, which
			     is a different job: holding the window off the page behind it. -->
			<div
				class="flex shrink-0 cursor-pointer select-none items-center gap-2 rounded-t-lg px-6 py-2.5"
				:class="minimised ? '' : 'border-b'"
				:role="minimised ? 'button' : undefined"
				:tabindex="minimised ? 0 : undefined"
				:aria-label="minimised ? __('Restore') : undefined"
				@click="emit('toggleMinimised')"
				@keydown.enter.prevent="minimised && emit('toggleMinimised')"
				@keydown.space.prevent="minimised && emit('toggleMinimised')"
			>
				<h2 class="text-ink-gray-8 min-w-0 flex-1 truncate text-base font-medium">
					{{ title || __('Compose Mail') }}
				</h2>
				<!-- No restore button: folded, the bar is one wide target that already does it, and a
				     second control saying the same thing beside a Close that does not is the arrangement
				     most likely to lose someone their draft. The bar carries the button role instead, so
				     it is reachable without a pointer. -->
				<Button
					v-if="!minimised"
					variant="ghost"
					:aria-label="__('Minimise')"
					:tooltip="__('Minimise')"
					@click.stop="emit('toggleMinimised')"
				>
					<template #icon><ChevronDown class="icon" /></template>
				</Button>
				<Button
					v-if="!minimised"
					variant="ghost"
					:aria-label="__('Expand')"
					:tooltip="__('Expand')"
					@click.stop="emit('expand')"
				>
					<template #icon><Maximize2 class="icon" /></template>
				</Button>
				<Button
					variant="ghost"
					:aria-label="__('Close')"
					:tooltip="__('Close')"
					@click.stop="show = false"
				>
					<template #icon><X class="icon" /></template>
				</Button>
			</div>

			<!-- The editor carries no horizontal padding of its own on desktop (`max-sm:px-3`) — in
			     the modal it sits inside the Dialog's `px-4 sm:px-6` body wrapper. Docked there is
			     no wrapper, so the same inset is supplied here, or the fields and their rules run
			     into the panel's edges.

			     v-show, never v-if: minimising must not take the editor's DOM with it. -->
			<div
				v-show="!minimised"
				class="flex min-h-0 flex-1 flex-col overflow-hidden px-6 pb-6 pt-4"
			>
				<slot />
			</div>
		</div>
	</Teleport>
</template>

<script setup lang="ts">
import { ChevronDown, Maximize2, X } from 'lucide-vue-next'
import { Button } from 'frappe-ui'

const { title, minimised = false } = defineProps<{ title?: string; minimised?: boolean }>()

const emit = defineEmits<{ expand: []; toggleMinimised: [] }>()

const show = defineModel<boolean>()
</script>
