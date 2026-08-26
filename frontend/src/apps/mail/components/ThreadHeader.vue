<template>
	<!-- px-3.5 matches the body/subject axis; the max-sm negative margins cancel the
	     ghost buttons' own padding so the edge glyphs land on that axis too.

	     Mobile targets are 44px (the HIG minimum) rather than the 32px they were:
	     this is the toolbar a reader hits most, and a ghost button paints nothing
	     until it is pressed, so the box can grow without the row looking any
	     heavier. Six of them at 44px still leave ~90px spare at 393px. -->
	<div class="bg-surface-base border-b sticky top-0 flex items-center px-3.5 py-2.5 max-sm:min-h-14 max-sm:border-b-0 max-sm:py-0">
		<Button
			variant="ghost"
			class="mr-2 shrink-0 max-sm:-ml-2 max-sm:!h-11 max-sm:!w-11"
			@click="$router.push(backRoute)"
		>
			<template #icon>
				<ChevronLeft class="icon max-sm:!size-4.5" />
			</template>
		</Button>
		<template v-if="thread?.length">
			<Tooltip v-if="!isMobile" :text="thread?.[0]?.subject">
				<h2 class="mr-2 truncate font-semibold leading-5">
					{{ thread?.[0]?.subject || __('[No subject]') }}
				</h2>
			</Tooltip>
			<div class="ml-auto shrink-0 space-x-2 max-sm:-mr-2">
				<Button
					variant="ghost"
					class="max-sm:!h-11 max-sm:!w-11"
					:tooltip="isFlagged ? __('Unstar') : __('Star')"
					@click="
						emit(
							'setFlagged',
							thread.map((m) => m.id),
							!isFlagged,
						)
					"
				>
					<template #icon>
						<Star
							:style="isFlagged ? FLAGGED_STAR_STYLE : undefined"
							class="icon max-sm:!size-4.5"
						/>
					</template>
				</Button>

				<AdaptiveDropdown :options="moveToOptions" :title="__('Move To')">
					<Button variant="ghost" class="max-sm:!h-11 max-sm:!w-11" :tooltip="__('Move To')">
						<template #icon>
							<FolderInput class="icon max-sm:!size-4.5" />
						</template>
					</Button>
				</AdaptiveDropdown>
				<AdaptiveDropdown v-if="showAddTo" :options="addToOptions" :title="__('Add To')">
					<Button variant="ghost" class="max-sm:!h-11 max-sm:!w-11" :tooltip="__('Add To')">
						<template #icon>
							<FolderPlus class="icon max-sm:!size-4.5" />
						</template>
					</Button>
				</AdaptiveDropdown>
				<AdaptiveDropdown v-if="canRemoveFrom" :options="removeFromOptions" :title="__('Remove From')">
					<Button variant="ghost" class="max-sm:!h-11 max-sm:!w-11" :tooltip="__('Remove From')">
						<template #icon>
							<FolderMinus class="icon max-sm:!size-4.5" />
						</template>
					</Button>
				</AdaptiveDropdown>
				<AdaptiveDropdown :options="moreActions">
					<Button variant="ghost" class="max-sm:!h-11 max-sm:!w-11" :tooltip="__('More')">
						<template #icon>
							<Ellipsis class="icon max-sm:!size-4.5" />
						</template>
					</Button>
				</AdaptiveDropdown>

				<!-- Prev/next thread arrows are a desktop affordance (↑/K, ↓/J). -->
				<template v-if="threads.includes(threadID) && !isMobile">
					<Button
						variant="ghost"
						:tooltip="__('Previous Thread (↑/K)')"
						:disabled="threadID === threads[0]"
						@click="emit('prevThread')"
					>
						<template #icon>
							<ArrowLeft class="icon" />
						</template>
					</Button>

					<Button
						variant="ghost"
						:tooltip="__('Next Thread (↓/J)')"
						:disabled="threadID === threads.at(-1) && !canGoNext"
						@click="emit('nextThread')"
					>
						<template #icon>
							<ArrowRight class="icon" />
						</template>
					</Button>
				</template>
			</div>
		</template>
	</div>
</template>

<script setup lang="ts">
import { type Component, computed, h } from 'vue'
import { useRoute } from 'vue-router'
import { Icon } from 'frappe-ui/icons'
import {
	Archive,
	ArrowLeft,
	ArrowRight,
	ChevronLeft,
	CircleAlert,
	CircleCheck,
	Ellipsis,
	FolderInput,
	FolderMinus,
	FolderPlus,
	Mail as MailIcon,
	Star,
	Trash2,
} from 'lucide-vue-next'
import { Button, Tooltip } from 'frappe-ui'

import { FLAGGED_STAR_STYLE, FOLDER_ICON_COLOR_MAP } from '@/apps/mail/constants'
import AdaptiveDropdown from '@/apps/mail/components/AdaptiveDropdown.vue'
import { getIcon, getMailboxName } from '@/apps/mail/utils'
import { useScreenSize } from '@/apps/mail/utils/composables'
import { injectAccountScope } from '@/apps/mail/utils/accountScope'

import type { Mail, MailboxData } from '@/apps/mail/types'

const { thread, threads, canGoNext } = defineProps<{
	thread: Mail[]
	threads: string[]
	canGoNext?: boolean
}>()
const emit = defineEmits([
	'setFlagged',
	'setSeen',
	'moveThread',
	'addThreadToMailbox',
	'removeThreadFromMailbox',
	'setSpamStatus',
	'deleteThread',
	'prevThread',
	'nextThread',
])

const { isMobile } = useScreenSize()
const route = useRoute()
// Folder menus come from the pane's account scope — the thread's owning account
// when All Inboxes opened it, the active account otherwise.
const { mailboxes, mailboxIds } = injectAccountScope()

const mailbox = computed(() => route.params.mailbox as string)
const threadID = computed(() => route.params.threadID as string)

// Back returns to the list the thread was opened from: the merged All Inboxes
// list on its thread route (whose mailbox param is the thread's real folder —
// usually an account's Inbox, which is where back used to land), the mailbox
// list otherwise.
const backRoute = computed(() =>
	route.name === 'mail-all-inboxes-mail'
		? { name: 'mail-all-inboxes', query: route.query }
		: { name: 'mail-mailbox', params: { mailbox: mailbox.value }, query: route.query },
)

const threadMailboxes = computed(() => {
	if (!thread?.length) return []
	return thread
		.filter((mail: Mail) => mail.id)
		.map((mail: Mail) => mail.mailboxes.map((m) => m.mailbox_id))
		.reduce((common, ids: string[]) => common.filter((id) => ids.includes(id)))
})

// Every mailbox the thread's mails touch (union), and whether any mail is in more than one — used by
// Remove From, which is only offered when removing won't orphan a mail.
const threadMailboxesUnion = computed(() => [
	...new Set(
		(thread ?? [])
			.filter((mail: Mail) => mail.id)
			.flatMap((mail: Mail) => mail.mailboxes.map((m) => m.mailbox_id)),
	),
])
const canRemoveFrom = computed(() =>
	(thread ?? []).some((mail: Mail) => mail.id && mail.mailboxes.length > 1),
)

const isFlagged = computed(() => thread.every((m) => m.flagged))

const moreActions = computed((): Action[] => [
	{
		label: __('Archive (E)'),
		onClick: () =>
			emit(
				mailbox.value === mailboxIds.value.sent ? 'addThreadToMailbox' : 'moveThread',
				mailboxIds.value.archive,
			),
		icon: Archive,
		condition: () => !threadMailboxes.value.includes(mailboxIds.value.archive),
	},
	{
		label: __('Mark as Junk (!)'),
		onClick: () => emit('setSpamStatus', true),
		icon: CircleAlert,
		condition: () =>
			!threadMailboxes.value.some((m: string) =>
				[mailboxIds.value.junk, mailboxIds.value.drafts].includes(m),
			),
	},
	{
		label: __('Mark as Not Junk'),
		onClick: () => emit('setSpamStatus', false),
		icon: CircleCheck,
		condition: () => threadMailboxes.value.includes(mailboxIds.value.junk),
	},
	{
		label: __('Move to Trash (Delete)'),
		onClick: () => emit('moveThread', mailboxIds.value.trash),
		icon: Trash2,
		condition: () => !threadMailboxes.value.includes(mailboxIds.value.trash),
	},
	{
		label: __('Delete Thread (Shift+Delete)'),
		onClick: () => emit('deleteThread'),
		icon: Trash2,
		condition: () => threadMailboxes.value.includes(mailboxIds.value.trash),
	},
	{
		label: __('Mark as Unread (U)'),
		onClick: () => emit('setSeen', false),
		icon: MailIcon,
		condition: () => true,
	},
])

const showAddTo = computed(() =>
	threadMailboxes.value.every((m) => ![mailboxIds.value.junk, mailboxIds.value.trash].includes(m)),
)

// Default to [] rather than undefined: in All Inboxes the pane's mailbox resource belongs to the
// row's account and is still loading on first paint, and AdaptiveDropdown requires an array.
const addToOptions = computed(() =>
	(mailboxes.value.data ?? [])
		.filter(
			(m) =>
				(!m.role || ['inbox', 'archive'].includes(m.role)) &&
				m.id !== mailboxIds.value.screener &&
				!threadMailboxes.value.includes(m.id),
		)
		.map((m) => getMailboxOption(m, 'addThreadToMailbox')),
)

const removeFromOptions = computed(() =>
	(mailboxes.value.data ?? [])
		.filter(
			(m) =>
				threadMailboxesUnion.value.includes(m.id) &&
				![mailboxIds.value.sent, mailboxIds.value.drafts].includes(m.id),
		)
		.map((m) => getMailboxOption(m, 'removeThreadFromMailbox')),
)

const moveToOptions = computed(() => {
	const excludedMailboxes = new Set([
		mailboxIds.value.sent,
		mailboxIds.value.drafts,
		mailboxIds.value.screener,
		...threadMailboxes.value,
	])
	return (mailboxes.value.data ?? [])
		.filter((m) => !excludedMailboxes.has(m.id))
		.map((m) => getMailboxOption(m, 'moveThread'))
})

const getMailboxOption = (
	mailbox: MailboxData,
	emitName: 'moveThread' | 'addThreadToMailbox' | 'removeThreadFromMailbox',
) => ({
	label: getMailboxName(mailbox),
	icon: h(Icon, { name: getIcon(mailbox), class: FOLDER_ICON_COLOR_MAP[mailbox.color!] }),
	onClick: () => emit(emitName, mailbox.id),
})

interface Action {
	label: string
	onClick: () => void
	icon: typeof ArrowLeft | Component
	condition: () => boolean
}
</script>
