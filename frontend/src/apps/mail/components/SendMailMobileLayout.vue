<template>
	<!-- Presents as a slide-up sheet (modal task), unlike the thread's lateral push.
	     Stays mounted and slides via transform so dismissal animates too; visibility
	     flips after the slide-out, keeping the closed sheet out of the focus order.
	     z-30: above the thread's reply bar (z-20), which stays mounted underneath
	     and is revealed as the sheet slides out. -->
	<div
		class="bg-surface-base fixed inset-0 z-30 flex flex-col pt-[env(safe-area-inset-top)] transition-[transform,visibility] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]"
		:class="{ 'invisible translate-y-full': !show || !painted }"
	>
		<div class="sticky top-0 flex items-center border-b px-3 py-2.5">
			<Button variant="ghost" class="mr-2" @click="close">
				<template #icon>
					<X class="text-ink-gray-5 h-4 w-4" />
				</template>
			</Button>
			<h2 class="flex-1">{{ __('Compose Mail') }}</h2>
			<!-- AdaptiveDropdown (bottom sheet, z-50): a plain Dropdown's popup portals
			     to body with no z-index, so this sheet would paint over it. -->
			<AdaptiveDropdown :options="ACTIONS">
				<Button variant="ghost" class="mr-2">
					<template #icon>
						<EllipsisVertical class="text-ink-gray-5 h-4 w-4" />
					</template>
				</Button>
			</AdaptiveDropdown>
			<Button variant="ghost" @click="emit('sendMail')">
				<template #icon>
					<SendHorizontal class="text-ink-gray-5 h-4 w-4" />
				</template>
			</Button>
		</div>
		<slot name="body-content" />
	</div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { EllipsisVertical, SendHorizontal, Trash2, X } from 'lucide-vue-next'
import { Button } from 'frappe-ui'

import AdaptiveDropdown from '@/apps/mail/components/AdaptiveDropdown.vue'

const show = defineModel<boolean>()

const emit = defineEmits(['reloadMails', 'sendMail', 'discardMail'])

const close = () => {
	if (show.value) {
		show.value = false
		emit('reloadMails')
	}
}

// Reply/forward mounts this sheet on demand with `show` already true, so the open
// state must be gated on a first painted frame in the closed position — otherwise
// the first open renders in place instead of sliding up. Double rAF: the closed
// frame is committed before the class flips, which a single rAF doesn't guarantee.
const painted = ref(false)

// `immediate` covers that same mounted-already-open case for the history entry,
// so the back gesture closes the sheet on first open too.
watch(
	show,
	(val) => {
		if (val) history.pushState(null, '')
	},
	{ immediate: true },
)

onMounted(() => {
	requestAnimationFrame(() => requestAnimationFrame(() => (painted.value = true)))
	window.addEventListener('popstate', close)
})
onUnmounted(() => window.removeEventListener('popstate', close))

const ACTIONS = [
	{
		label: __('Discard'),
		onClick: () => emit('discardMail'),
		icon: Trash2,
		theme: 'red',
	},
]
</script>
