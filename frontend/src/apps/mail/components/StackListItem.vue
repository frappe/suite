<template>
	<MailRow
		:is-selected
		:selectable
		:hide-avatar
		:account-label="accountLabel"
		:unread="!!unreadCount"
		:avatar-label="avatarLabel"
		:avatar-image="latest.user_image"
		:datetime="latest.received_at"
		:subject-italic="!latest.subject"
		:preview-italic="!latest.preview"
		role="button"
		:aria-expanded="expanded"
		@click="emit('toggle')"
		@set-selected="(selected: boolean) => emit('setSelected', selected)"
	>
		<template #sender>{{ sender }}</template>

		<!-- The glyph is what separates a pile of threads from the plain number a single thread wears to
		     say how many messages it holds — at a glance the two counts were the same small grey digit. -->
		<template #badges>
			<Badge size="sm" :aria-label="__('{0} conversations', [threads.length])">
				<span class="flex items-center gap-1">
					<!-- Badge's own prefix slot boxes an icon at 10px, where the glyph's strokes close up.
					     The default slot leaves room for the 12px the design system's icons are drawn at. -->
					<Layers2 class="h-3 w-3 stroke-[1.5]" />
					{{ threads.length }}
				</span>
			</Badge>
		</template>

		<template #subject>{{ latest.subject || __('[No subject]') }}</template>
		<template #preview>{{ latest.preview || __('— No message body —') }}</template>

		<!-- The chevron takes the star's place rather than claiming a column of its own, so a stack row's
		     sender and date line up with every thread row around it. -->
		<template #trailing="{ isHovered }">
			<MailRowActions
				:is-hovered
				:threads
				:show-star="false"
				@set-seen="(seen: boolean) => emit('setSeen', seen)"
				@archive="emit('archiveThreads')"
				@trash="emit('trashThreads')"
				@delete="emit('deleteThreads')"
			/>
			<component :is="expanded ? ChevronDown : ChevronRight" class="icon text-ink-gray-5" />
		</template>
	</MailRow>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { ChevronDown, ChevronRight, Layers2 } from 'lucide-vue-next'
import { Badge } from 'frappe-ui'

import {
	threadAvatarLabel,
	threadDisplayName,
	threadParticipants,
} from '@/apps/mail/utils/participants'
import { useOwnEmails } from '@/apps/mail/utils/composables'
import MailRow from '@/apps/mail/components/MailRow.vue'
import MailRowActions from '@/apps/mail/components/MailRowActions.vue'

import type { Thread } from '@/apps/mail/types'

// A collapsed run of adjacent threads from one sender on one day (see utils/threadStacks). Purely
// presentational: it owns neither its expansion nor its selection state.
//
// Its hover actions apply to every member at once, so each one names the count and every move it makes
// is undoable.
const {
	threads,
	expanded,
	isSelected,
	selectable = true,
	hideAvatar,
	accountLabel,
} = defineProps<{
	threads: Thread[]
	expanded: boolean
	isSelected: boolean
	// Forwarded to MailRow, for lists without bulk selection / with the leading
	// column reclaimed (the merged All Inboxes list) — see MailRow's props.
	selectable?: boolean
	hideAvatar?: boolean
	// Which account received the run (merged lists) — a stack never mixes accounts.
	accountLabel?: string
}>()

const emit = defineEmits<{
	toggle: []
	setSelected: [selected: boolean]
	setSeen: [seen: boolean]
	archiveThreads: []
	trashThreads: []
	deleteThreads: []
}>()

// The list is newest-first, so the run's first member is its latest — the row this stack stands in for.
const latest = computed(() => threads[0])

const ownEmails = useOwnEmails()
const participants = computed(() => threadParticipants(latest.value.messages, ownEmails.value))

// Only threads with a lone sending address stack (see stackKeyOf), and every member shares it, so the
// stack is named exactly the way each of its members is — collapsed or expanded, the name holds.
const sender = computed(() => threadDisplayName(participants.value, latest.value))

const avatarLabel = computed(() => threadAvatarLabel(participants.value, latest.value))

const unreadCount = computed(() => threads.filter((t) => !t.seen).length)
</script>
