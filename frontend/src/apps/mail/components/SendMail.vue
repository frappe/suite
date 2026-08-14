<template>
	<SendMailMobileLayout
		v-if="isMobile"
		v-model="show"
		@reload-mails="() => emit('reloadMails')"
		@send-mail="editor?.sendMail()"
		@discard-mail="editor?.discardMail()"
		@schedule-send="editor?.openScheduleModal()"
	>
		<template #body-content>
			<div ref="host" class="flex min-h-0 flex-1 flex-col" />
		</template>
	</SendMailMobileLayout>

	<!-- Modal is the default, and is the Dialog it always was; docked and minimised are the other
	     two states (#407).

	     All three controls live in the header's `title` slot, with the Dialog's own close button
	     turned off. Left on, it sits outside the slot as the other half of a `justify-between`
	     row whose first half is `flex-1` — so it lands flush against ours, and the three read as
	     8px, 8px, nothing. One row, one gap.

	     `show-close-button` is a prop, not an option: Dialog resolves every other key as
	     `props.x ?? options.x` but this one only reads the prop, so in `:options` it is dropped
	     and the built-in close comes back. -->
	<Dialog
		v-else-if="state === 'modal'"
		v-model="show"
		:show-close-button="false"
		:dismissible="false"
		:options="{ title: __('Compose Mail'), size: '5xl' }"
	>
		<template #title="{ close }">
			<div class="flex items-center gap-2">
				<h3 class="text-ink-gray-8 text-2xl-semibold min-w-0 flex-1 truncate leading-6">
					{{ __('Compose Mail') }}
				</h3>
				<Button
					variant="ghost"
					:aria-label="__('Minimise')"
					:tooltip="__('Minimise')"
					@click="minimise()"
				>
					<template #icon><ChevronDown class="icon" /></template>
				</Button>
				<Button
					variant="ghost"
					:aria-label="__('Dock to corner')"
					:tooltip="__('Dock to corner')"
					@click="state = 'dock'"
				>
					<template #icon><Minimize2 class="icon" /></template>
				</Button>
				<Button
					variant="ghost"
					:aria-label="__('Close')"
					:tooltip="__('Close')"
					@click="close()"
				>
					<template #icon><X class="icon" /></template>
				</Button>
			</div>
		</template>
		<template #body-content>
			<div ref="host" class="flex min-h-0 flex-1 flex-col" />
		</template>
	</Dialog>

	<ComposeDock
		v-else
		v-model="show"
		:title="minimisedTitle"
		:minimised="state === 'minimised'"
		@expand="state = 'modal'"
		@toggle-minimised="minimise()"
	>
		<div ref="host" class="flex min-h-0 flex-1 flex-col" />
	</ComposeDock>

	<!-- The editor is rendered once and teleported into whichever container is showing, rather
	     than sitting in each one's slot: those are different components, so a state change would
	     remount TipTap and take the draft with it. Moving DOM keeps the instance.

	     `disabled` covers the tick between one container unmounting and the next mounting, when
	     there is no target — the children render in place, and `hidden` keeps that off screen.

	     Held while a target exists, not merely while `show` is true: the Dialog animates out, and
	     dropping the editor the moment it was closed emptied the modal mid-flight — you saw it
	     shrink to its own header on the way out. The target outlives `show` by exactly the length
	     of that transition, then goes with it. -->
	<Teleport v-if="show || target" :to="target" :disabled="!target">
		<div :class="target ? 'contents' : 'hidden'">
			<ComposeMailEditor
				ref="composeMailEditor"
				v-model="show"
				:mail-details
				:docked="state === 'dock'"
				:reload-mails="() => emit('reloadMails')"
				@discard-mail="emit('discardMail')"
				@discard-started="emit('discardStarted')"
			/>
		</div>
	</Teleport>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue'
import { ChevronDown, Minimize2, X } from 'lucide-vue-next'
import { Button, Dialog } from 'frappe-ui'

import { useScreenSize } from '@/apps/mail/utils/composables'
import { claimComposeWindow } from '@/apps/mail/composables/useComposeWindow'
import ComposeDock from '@/apps/mail/components/ComposeDock.vue'
import ComposeMailEditor from '@/apps/mail/components/ComposeMailEditor.vue'
import SendMailMobileLayout from '@/apps/mail/components/SendMailMobileLayout.vue'

import type { ComposeMailData } from '@/apps/mail/types'

const show = defineModel<boolean>()

const { mailDetails } = defineProps<{ mailDetails?: ComposeMailData }>()

const emit = defineEmits(['reloadMails', 'discardMail', 'discardStarted'])

const { isMobile } = useScreenSize()

// Desktop only: mobile composes on a full page, so there is no window to contend for. The
// callback is how Compose reaches a composer that is already open — see restoreComposeWindow.
if (!isMobile.value)
	claimComposeWindow(
		show,
		() => state.value === 'minimised' && minimise(),
		() => editor.value?.mail?.id,
	)

const editor = useTemplateRef('composeMailEditor')

// --- Window state (desktop) ---

type ComposeState = 'modal' | 'dock' | 'minimised'

const state = ref<ComposeState>('modal')

// Minimising remembers where it came from, so restoring puts the composer back rather than
// picking a presentation of its own.
const restoreTo = ref<ComposeState>('dock')
const minimise = () => {
	if (state.value === 'minimised') return (state.value = restoreTo.value)
	restoreTo.value = state.value
	state.value = 'minimised'
}

// Each compose starts modal: a request to write is not a request to resume whatever the last
// draft's window happened to be doing.
watch(show, (open) => {
	if (open) state.value = 'modal'
})

// Folded away, the bar is all there is to tell one draft from another, so it takes the subject
// once there is one. Expanded there is a Subject field on screen saying the same thing, and the
// generic title is the better label for the window itself.
const minimisedTitle = computed(() =>
	state.value === 'minimised' ? editor.value?.mail?.subject?.trim() || undefined : undefined,
)

// The container currently holding the editor. Post-flush, so it is read once the DOM has settled
// on the new container rather than the one being torn down.
const host = useTemplateRef<HTMLElement>('host')
const target = ref<HTMLElement | null>(null)
watch(host, (el) => (target.value = el ?? null), { flush: 'post', immediate: true })

// Clicking away from a draft means "let me look at that", not "throw this out" — so the modal
// minimises rather than closing. `dismissible: false` is what stops the Dialog closing itself; the
// gesture then has to be recognised here, since it swallows reka's outside-interaction events
// without re-emitting them.
//
// Anything outside the panel counts, because while the modal is up there is nothing else to hit:
// reka takes pointer events off the body, so a press on the backdrop lands on whichever of its
// two full-screen layers is on top — the overlay or the scroll container, and they are siblings.
// Testing for one of them missed the other, which is why this reads as "not the content".
//
// The exception is the composer's own dropdowns — the From identity list, Send later — which are
// portalled to the body and so are outside the panel too. Picking an identity must not fold the
// window away.
const onPointerDown = (e: PointerEvent) => {
	if (!show.value || state.value !== 'modal') return
	const el = e.target as HTMLElement | null
	if (!el?.closest) return
	if (el.closest('.dialog-content') || el.closest('[data-reka-popper-content-wrapper]')) return
	minimise()
}

// Esc closed the modal before `dismissible: false` took that over, so it is reinstated here.
// Ignored while a popover is open: it belongs to whatever is layered above, which reka closes on
// the same key.
const onEscape = (e: KeyboardEvent) => {
	if (e.key !== 'Escape' || e.defaultPrevented) return
	if (!show.value || state.value !== 'modal') return
	if (document.querySelector('[data-reka-popper-content-wrapper]')) return
	show.value = false
}

// `c` is Compose, and a composer is already open — so it is swallowed here rather than reaching
// the list and opening a second one. Minimised, that left the key doing nothing at all while the
// draft it would have opened sat folded in the corner, so there it restores instead.
const handleKeydown = (e: KeyboardEvent) => {
	if (!show.value || e.key !== 'c' || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return

	const el = e.target as HTMLElement
	if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) return

	e.preventDefault()
	e.stopPropagation()
	if (state.value === 'minimised') minimise()
}

onMounted(() => {
	window.addEventListener('keydown', handleKeydown, true)
	window.addEventListener('keydown', onEscape)
	window.addEventListener('pointerdown', onPointerDown, true)
})
onUnmounted(() => {
	window.removeEventListener('keydown', handleKeydown, true)
	window.removeEventListener('keydown', onEscape)
	window.removeEventListener('pointerdown', onPointerDown, true)
})
</script>
