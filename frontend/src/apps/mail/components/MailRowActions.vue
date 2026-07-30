<template>
	<template v-if="isHovered && !isMobile">
		<Tooltip v-for="action in actions" :key="action.label" :text="action.label">
			<button class="action-btn" @click.stop.prevent="action.onClick">
				<component :is="action.icon" class="icon text-ink-gray-5" />
			</button>
		</Tooltip>
	</template>
	<Tooltip v-if="showStar && !isMobile" :text="flagged ? __('Unstar Mail') : __('Star Mail')">
		<button class="action-btn" @click.stop.prevent="emit('setFlagged', !flagged)">
			<Star
				class="icon text-ink-gray-5"
				:class="{ flagged }"
				:style="flagged ? 'fill: var(--ink-amber-6); color: var(--ink-amber-6)' : ''"
			/>
		</button>
	</Tooltip>
	<!-- Touch: no Tooltip wrapper (it can eat the first tap and never shows anyway),
	     and a larger glyph. -->
	<button
		v-else-if="showStar"
		class="action-btn"
		:aria-label="flagged ? __('Unstar Mail') : __('Star Mail')"
		@click.stop.prevent="emit('setFlagged', !flagged)"
	>
		<Star
			class="text-ink-gray-5 h-5 w-5"
			:class="{ flagged }"
			:style="flagged ? 'fill: var(--ink-amber-6); color: var(--ink-amber-6)' : ''"
		/>
	</button>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Archive, Mail, MailOpen, Star, Trash2 } from 'lucide-vue-next'
import { Tooltip } from 'frappe-ui'

import { useScreenSize } from '@/apps/mail/utils/composables'
import { userStore } from '@/apps/mail/stores/user'

import type { Thread } from '@/apps/mail/types'

// The hover actions on a row, for one thread or for a whole collapsed run of them.
//
// The conditions read "any member": offer Archive while any thread is still outside it, Delete only
// once every thread is already in Trash. For a single thread each rule collapses to the obvious thing,
// which is why one component can serve both. Labels name the count when there is more than one, since
// a stack row deliberately hides its members and a click is about to move all of them.
const {
	isHovered,
	threads,
	showStar = true,
} = defineProps<{
	isHovered: boolean
	// One thread for a mail row; the whole run for a stack row.
	threads: Thread[]
	// Off for stacks, where the chevron occupies the star's slot.
	showStar?: boolean
}>()

const emit = defineEmits(['setSeen', 'archive', 'trash', 'delete', 'setFlagged'])

const { isMobile } = useScreenSize()
const { mailboxIds } = userStore()

const many = computed(() => threads.length > 1)
const count = computed(() => String(threads.length))

const flagged = computed(() => !!threads[0]?.flagged)

// Members of a stack always share an account (it is part of the stack key), so the first row's own
// Archive/Trash ids speak for the run. Falling back to the active account covers a plain row whose
// mailbox ids are not carried on the thread.
const archiveId = computed(() => threads[0]?.archive ?? mailboxIds.archive)
const trashId = computed(() => threads[0]?.trash ?? mailboxIds.trash)

const someIn = (mailboxId: string) =>
	threads.some((t) => t.mailboxes.some((m) => m.mailbox_id === mailboxId))
const everyIn = (mailboxId: string) =>
	threads.every((t) => t.mailboxes.some((m) => m.mailbox_id === mailboxId))

const someUnread = computed(() => threads.some((t) => !t.seen))

const actions = computed(() =>
	[
		{
			label: many.value ? __('Mark {0} threads as Unread', [count.value]) : __('Mark as Unread'),
			onClick: () => emit('setSeen', false),
			icon: Mail,
			condition: !someUnread.value,
		},
		{
			label: many.value ? __('Mark {0} threads as Read', [count.value]) : __('Mark as Read'),
			onClick: () => emit('setSeen', true),
			icon: MailOpen,
			condition: someUnread.value,
		},
		{
			label: many.value ? __('Archive {0} threads', [count.value]) : __('Archive Thread'),
			onClick: () => emit('archive'),
			icon: Archive,
			condition: !everyIn(archiveId.value),
		},
		{
			label: many.value ? __('Move {0} threads to Trash', [count.value]) : __('Move to Trash'),
			onClick: () => emit('trash'),
			icon: Trash2,
			condition: !someIn(trashId.value),
		},
		{
			label: many.value ? __('Delete {0} threads', [count.value]) : __('Delete Thread'),
			onClick: () => emit('delete'),
			icon: Trash2,
			condition: everyIn(trashId.value),
		},
	].filter((action) => action.condition),
)
</script>

<style scoped>
.action-btn {
	/* Mobile: uneven halo — generous left/right/top, but bottom capped at 10px (the
	   star's clearance to the row border) so taps meant for the next row's first
	   line are never captured. ~68×54px effective target on a 20px glyph. */
	@apply relative after:absolute after:content-[''] max-sm:after:-bottom-2.5 max-sm:after:-left-6 max-sm:after:-right-6 max-sm:after:-top-6 sm:after:-inset-1.5;
}

/* Hover-capable pointers only: on touch, :hover sticks after a tap and the
   star would stay dark until something else is touched. A flagged star is
   exempt, or its amber wouldn't show until the pointer left the button. */
@media (hover: hover) {
	.action-btn:hover > :not(.flagged) {
		color: var(--ink-gray-8) !important;
		stroke-width: 2 !important;
	}
}
</style>
