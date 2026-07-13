<template>
	<!-- Header -->
	<header class="flex items-center justify-between border-b px-3 py-2.5 sm:px-5">
		<div class="flex items-center space-x-2">
			<Button v-if="isMobile" icon="menu" variant="ghost" @click="openSidebar" />
			<Breadcrumbs
				:items="[
					{
						label: mailboxName,
						route: { name: 'mail-mailbox', params: { accountId, mailbox } },
					},
				]"
			/>
		</div>
		<HeaderActions @reload-mails="resetThreads(true, ['drafts', 'sent'])" />
	</header>

	<!-- Unscreened-thread nudge on the inbox, mirroring the trash/junk info bar: shown while Hey-style
	     screening is on and threads are waiting to be screened. -->
	<div v-if="showScreenerBanner" class="space-x-1 border-b py-2.5 px-5">
		<span class="text-ink-gray-5">{{ screenerBannerLabel }}</span>
		<Button :label="__('Review Now')" variant="ghost" @click="goToScreener" />
	</div>

	<div
		v-if="
			[mailboxIds.trash, mailboxIds.junk].includes(mailbox) &&
			!threadsResource.data?.loading &&
			threadsResource.data?.length &&
			(showReadingPane || !threadID)
		"
		class="space-x-1 border-b px-3 py-2.5 sm:px-5"
	>
		<span class="text-ink-gray-5">
			{{ __('Items in this mailbox will be automatically deleted after 30 days.') }}
		</span>
		<Button :label="__('Delete Now')" variant="ghost" @click="showEmptyMailbox = true" />
	</div>

	<div
		class="relative flex"
		:class="
			[mailboxIds.trash, mailboxIds.junk].includes(mailbox) || showScreenerBanner
				? 'h-[calc(100dvh-6.1rem)]'
				: 'h-[calc(100dvh-3.05rem)]'
		"
	>
		<!-- Loading -->
		<div v-if="isLoading" class="flex w-full flex-col items-center justify-center">
			<div class="text-ink-gray-5 flex items-center space-x-2">
				<LoaderCircle class="h-5 w-5 animate-spin" />
				<span>{{ __('Loading...') }}</span>
			</div>
		</div>

		<template v-else-if="threadsResource?.data?.length || filter">
			<div
				ref="mailSidebar"
				class="sticky top-16 flex flex-col border-r"
				:class="!isMobile && showReadingPane ? 'w-1/3' : 'w-full'"
			>
				<!-- Toolbar/Actions -->
				<div
					class="relative flex items-center border-b border-l-transparent px-3.5 py-2.5 sm:border-l sm:px-5"
				>
					<div class="mr-5 max-sm:ml-3">
						<Tooltip
							:text="
								isAllSelected
									? __('Clear All (Esc)')
									: __('Select All ({0}+A)', [modifier])
							"
						>
							<div
								class="checkbox-hitbox -m-3 cursor-pointer p-3"
								@click.stop.prevent="toggleSelectAll(!isAllSelected)"
							>
								<Checkbox
									:model-value="isAllSelected"
									size="md"
									class="pointer-events-none"
								/>
							</div>
						</Tooltip>
					</div>
					<Dropdown
						v-if="!selections.length && mailbox !== 'search'"
						:options="FILTER_OPTIONS"
					>
						<button
							class="text-ink-gray-8 hover:bg-surface-gray-2 -ml-2 flex min-w-0 items-center gap-1 rounded px-2 py-1"
						>
							<span class="truncate">{{ title }}</span>
							<ChevronDown class="text-ink-gray-5 icon shrink-0" />
						</button>
					</Dropdown>
					<p v-else class="pb-[2px]">{{ title }}</p>
					<div class="-mr-1.5 ml-auto flex items-center space-x-1.5 sm:space-x-3">
						<Button
							v-if="!selections.length"
							variant="ghost"
							:tooltip="__('Refresh')"
							:disabled="threadsResource?.loading || loadingMore"
							@click="refreshThreads()"
						>
							<template #icon>
								<RefreshCw class="icon" />
							</template>
						</Button>
						<template v-if="selections.length">
							<Dropdown v-if="showReadingPane" :options="selectActions">
								<Button variant="ghost" :tooltip="__('Actions')">
									<template #icon>
										<Ellipsis class="icon" />
									</template>
								</Button>
							</Dropdown>
							<template v-else>
								<Button
									v-for="action in selectActions.filter((a) => a.condition())"
									:key="action.label"
									:tooltip="action.label"
									variant="ghost"
									@click="action.onClick"
								>
									<template #icon>
										<component :is="action.icon" class="icon" />
									</template>
								</Button>
							</template>
						</template>

						<Dropdown
							v-if="!!selections.length && !['search', 'starred'].includes(mailbox)"
							:options="moveToOptions"
						>
							<Button variant="ghost" :tooltip="__('Move To')">
								<template #icon>
									<component :is="FolderInput" class="icon" />
								</template>
							</Button>
						</Dropdown>
						<Dropdown v-if="showAddTo" :options="addToOptions">
							<Button variant="ghost" :tooltip="__('Add To')">
								<template #icon>
									<component :is="FolderPlus" class="icon" />
								</template>
							</Button>
						</Dropdown>
						<Dropdown v-if="showRemoveFrom" :options="removeFromOptions">
							<Button variant="ghost" :tooltip="__('Remove From')">
								<template #icon>
									<component :is="FolderMinus" class="icon" />
								</template>
							</Button>
						</Dropdown>
					</div>
					<!-- Subtle loading bar: a segment sliding across the bottom outline (no layout shift) -->
					<div
						v-if="threadsResource?.loading"
						class="loading-bar pointer-events-none absolute bottom-[-1px] left-[-1px] right-0 h-0.5 overflow-hidden"
						role="progressbar"
						aria-busy="true"
					>
						<div
							class="loading-bar__fill via-ink-gray-3 absolute inset-y-0 left-0 w-[30%] bg-gradient-to-r from-transparent to-transparent"
						/>
					</div>
				</div>

				<!-- Mail list -->
				<div
					v-if="threadsResource?.data?.length"
					ref="mailList"
					class="h-full overflow-y-auto overscroll-contain"
				>
					<div v-for="(group, key) in groupedThreads" :key="key">
						<Tooltip
							v-if="groupMessagesBy !== 'None'"
							:text="
								isLastGroup(key)
									? ''
									: __(collapsedGroups.includes(key) ? 'Expand' : 'Collapse')
							"
						>
							<div
								class="text-ink-gray-6 group flex items-center border-b border-l-transparent p-3.5 text-xs-semibold sm:border-l sm:px-5"
								@click="toggleGroupCollapse(key)"
							>
								<div
									class="pr-7.5 checkbox-hitbox -m-3 cursor-pointer py-3 pl-6 sm:pl-3"
									@click.stop.prevent="
										toggleSelect(getGroupThreads(key), !isGroupSelected(key))
									"
								>
									<Checkbox
										:model-value="isGroupSelected(key)"
										size="md"
										class="pointer-events-none"
									/>
								</div>

								<span class="select-none pt-[2px]">
									{{
										getFormattedDate(
											key,
											groupMessagesBy === 'Month',
										).toUpperCase()
									}}
								</span>

								<component
									:is="
										collapsedGroups.includes(key) ? ChevronRight : ChevronDown
									"
									v-if="!isLastGroup(key)"
									class="icon ml-auto"
								/>
							</div>
						</Tooltip>
						<template v-if="!collapsedGroups.includes(key)">
							<MailListItem
								v-for="mail in group"
								ref="mailItems"
								:key="mail.name"
								:mailbox
								:mail
								:is-selected="selections.includes(mail.thread_id)"
								class="border-l-transparent sm:border-l"
								:class="{
									'!bg-surface-blue-1': mail.thread_id === threadID && !isMobile,
									'!border-l-blue-500': mail.thread_id === threadInFocus,
								}"
								@set-seen="
									(seen: boolean) =>
										handleSetSeen({ [Number(seen)]: [mail.thread_id] })
								"
								@archive-thread="
									mailbox === mailboxIds.sent
										? handleAddThreadsToMailbox(mailboxIds.archive, [
												mail.thread_id,
											])
										: handleMoveThreads({
												[mailboxIds.archive]: [mail.thread_id],
											})
								"
								@trash-thread="
									handleMoveThreads({ [mailboxIds.trash]: [mail.thread_id] })
								"
								@delete-thread="junkOrDeleteThreads([mail.thread_id], false)"
								@set-flagged="
									(flagged: boolean) =>
										setFlaggedByThreadIDs([mail.thread_id], flagged)
								"
								@set-selected="
									(selected: boolean) => toggleSelect([mail.thread_id], selected)
								"
							/>
						</template>
					</div>
					<!-- Infinite-scroll sentinel: entering the viewport near the list bottom loads the next
					     batch (appended, never refetching loaded rows). Sits after all groups so collapsing
					     a group can't disable it. -->
					<div ref="loadMoreSentinel" class="h-px" />
					<div v-if="loadingMore" class="flex justify-center py-3">
						<LoaderCircle class="text-ink-gray-5 h-4 w-4 animate-spin" />
					</div>
				</div>
				<div v-else class="flex h-full items-center justify-center">
					<p class="text-ink-gray-5">
						{{ __('No mails found for the selected filter.') }}
					</p>
				</div>
			</div>
			<div class="flex cursor-col-resize justify-center" @mousedown="startResizing">
				<div
					ref="resizer"
					class="group-hover:bg-surface-gray-8 h-full rounded-full transition-all duration-300 ease-in-out"
				/>
			</div>

			<!-- Mail thread -->
			<div
				class="bg-surface-base overflow-y-auto"
				:class="{
					'w-2/3': !isMobile && showReadingPane,
					'absolute bottom-0 left-0 right-0 top-0': !isMobile && !showReadingPane,
					'fixed inset-0': isMobile,
					hidden: (isMobile || !showReadingPane) && !threadID,
				}"
			>
				<MailThread
					ref="mailThread"
					:mailbox
					:thread-i-d
					:threads="threadIDs"
					:messages="currentThread?.messages"
					:can-go-next="canGoNext"
					@reload-mails="resetThreads"
					@set-seen="
						(seen: boolean, ids: string[]) =>
							handleSetSeen({ [Number(seen)]: [threadID!] }, seen, ids)
					"
					@sync-unseen="handleSyncUnseen"
					@set-flagged="
						(ids: string[], flagged: boolean) => setFlagged.submit({ ids, flagged })
					"
					@move-thread="
						(moveToMailbox: string) =>
							handleMoveThreads({ [moveToMailbox]: [threadID!] })
					"
					@add-thread-to-mailbox="
						(mailboxId: string) => handleAddThreadsToMailbox(mailboxId, [threadID!])
					"
					@remove-thread-from-mailbox="
						(mailboxId: string) =>
							handleRemoveThreadsFromMailbox(mailboxId, [threadID!])
					"
					@set-spam-status="
						(spam: boolean) =>
							spam
								? junkOrDeleteThreads([threadID!], true)
								: handleSetSpamStatus({ 0: [threadID!] })
					"
					@delete-thread="junkOrDeleteThreads([threadID!], false)"
					@prev-thread="goToThreadByOffset(-1)"
					@next-thread="goToThreadByOffset(1)"
				/>
			</div>
		</template>

		<!-- No mails -->
		<div v-else class="text-ink-gray-5 flex w-full flex-col items-center justify-center">
			<NoMails class="text-ink-gray-2 mb-2 h-16 w-16" />
			<p>
				{{
					mailbox === 'search'
						? __('No results found for the given query.')
						: __('You have no mails in this folder.')
				}}
			</p>
		</div>
	</div>

	<Dialog v-model="showEmptyMailbox" :options="emptyMailboxOptions" />
	<Dialog v-model="showJunkOrDeleteThreads" :options="junkOrDeleteThreadsOptions" />
	<ScreenedEmailAddressModal />
	<ShortcutsModal v-model="showShortcuts" />
</template>
<script setup lang="ts">
import { computed, inject, nextTick, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useIntersectionObserver } from '@vueuse/core'
import {
	Archive,
	ChevronDown,
	ChevronRight,
	CircleAlert,
	CircleCheck,
	Ellipsis,
	FolderInput,
	FolderMinus,
	FolderPlus,
	LoaderCircle,
	Mail as MailIcon,
	MailOpen,
	Mails,
	Paperclip,
	RefreshCw,
	Star,
	StarOff,
	Trash2,
} from 'lucide-vue-next'
import {
	Breadcrumbs,
	Button,
	Checkbox,
	Dialog,
	Dropdown,
	Tooltip,
	createResource,
	usePageMeta,
} from 'frappe-ui'

import { getFormattedDate, isMac, raiseToast, shouldIgnoreKeypress, startResizing } from '@/apps/mail/utils'
import { useScreenSize, useSidebar, useUndo } from '@/apps/mail/utils/composables'
import { useThreadActions } from '@/apps/mail/utils/useThreadActions'
import { type MailboxRole, userStore } from '@/apps/mail/stores/user'
import HeaderActions from '@/apps/mail/components/HeaderActions.vue'
import NoMails from '@/apps/mail/components/Icons/NoMails.vue'
import MailListItem from '@/apps/mail/components/MailListItem.vue'
import MailThread from '@/apps/mail/components/MailThread.vue'
import ScreenedEmailAddressModal from '@/apps/mail/components/Modals/ScreenedEmailAddressModal.vue'
import ShortcutsModal from '@/apps/mail/components/Modals/ShortcutsModal.vue'

import type { MailboxData, Thread, UserResource } from '@/apps/mail/types'

const { accountId, mailbox, threadID } = defineProps<{
	accountId: string
	mailbox: string
	threadID?: string
}>()

const route = useRoute()
const router = useRouter()
const { isMobile } = useScreenSize()
const { openSidebar } = useSidebar()
const { undo, setUndoAction } = useUndo()

const socket = inject('$socket')
const user = inject('$user') as UserResource
const dayjs = inject('$dayjs')

const store = userStore()
const { mailboxes, mailboxIds } = store

// Appearance

const showReadingPane = computed(() => !!user.data?.show_reading_pane)
const groupMessagesBy = computed(() => user.data.group_messages_by)

// Thread Groups

const groupedThreads = computed<Record<string, Thread[]>>(() =>
	threadsResource.value?.data?.reduce((groups: Record<string, Thread[]>, thread: Thread) => {
		const date = dayjs(thread.received_at).format(
			groupMessagesBy.value === 'Day' ? 'YYYY-MM-DD' : 'YYYY-MM',
		)
		if (!groups[date]) groups[date] = []
		groups[date].push(thread)
		return groups
	}, {}),
)

const isLastGroup = (key: string) => Object.keys(groupedThreads.value).at(-1) === key

const collapsedGroups = ref<string[]>([])

const toggleGroupCollapse = (key: string) => {
	if (isLastGroup(key)) return

	if (collapsedGroups.value.includes(key))
		return (collapsedGroups.value = collapsedGroups.value.filter((d) => d !== key))

	collapsedGroups.value.push(key)
	if (groupedThreads.value[key]?.some((thread) => thread.thread_id === threadID)) goToMailbox()
	toggleSelect(getGroupThreads(key), false)
}

const getGroupThreads = (group: string) => groupedThreads.value[group]?.map((t) => t.thread_id)

watch(groupMessagesBy, () => (collapsedGroups.value = []))

const threadInFocus = ref<string>()

watch(
	() => threadID,
	(val) => {
		if (!val) return

		setTimeout(() => focusOnThread(val))
		for (const group of collapsedGroups.value) {
			if (getGroupThreads(group).includes(val))
				return (collapsedGroups.value = collapsedGroups.value.filter((d) => d !== group))
		}
	},
	{ immediate: true },
)

// Selection

const mailItemsRef = useTemplateRef('mailItems')
const mailThreadRef = useTemplateRef('mailThread')
const mailListRef = useTemplateRef('mailList')

const selections = ref<string[]>([])
const lastSelected = ref<string[]>()

const isAllSelected = computed(
	() => threadIDs.value.length && selections.value.length === threadIDs.value.length,
)

watch(selections, (val) => {
	collapsedGroups.value = collapsedGroups.value.filter(
		(group) => !getGroupThreads(group).some((thread) => val.includes(thread)),
	)
})

const toggleSelect = (
	threadIDs: string[],
	selected: boolean,
	isKeyboardSelect: boolean = false,
) => {
	const allIDs = new Set([
		...threadIDs,
		...(isKeyboardSelect ? [] : getShiftSelectedIDs(threadIDs[0])),
	])
	if (selected) selections.value = [...new Set([...selections.value, ...allIDs])]
	else selections.value = selections.value.filter((id) => !allIDs.has(id))
	lastSelected.value = threadIDs
}

const getShiftSelectedIDs = (thread: string) => {
	if (!(isShiftPressed.value && lastSelected.value?.length)) return []

	const currentIndex = threadIDs.value.indexOf(thread)
	const firstIndex = threadIDs.value.indexOf(lastSelected.value[0])
	const lastIndex = threadIDs.value.indexOf(lastSelected.value.at(-1))

	const farthestIndex =
		Math.abs(currentIndex - firstIndex) > Math.abs(currentIndex - lastIndex)
			? firstIndex
			: lastIndex

	const [lower, higher] = [farthestIndex, currentIndex].sort((a, b) => a - b)
	return threadIDs.value.slice(lower, higher + 1)
}

const toggleSelectAll = (selected: boolean) => {
	if (selected) selections.value = [...threadIDs.value]
	else selections.value = []
	lastSelected.value = undefined
}

const resetSelections = () => {
	selections.value = []
	lastSelected.value = undefined
}

const isGroupSelected = (key: string) =>
	getGroupThreads(key).every((id) => selections.value.includes(id))

// Shortcuts

const showShortcuts = ref(false)

const modifier = computed(() => (isMac ? '⌘' : 'Ctrl'))

const isShiftPressed = ref(false)
const isGPressed = ref(false)
const gPressTimeout = ref<ReturnType<typeof setTimeout>>()
const reloadInterval = ref<ReturnType<typeof setInterval>>()

const handleKeyDown = (e: KeyboardEvent) => {
	isShiftPressed.value = e.shiftKey
	const key = e.key.toLowerCase()

	// Handle Ctrl/Cmd+A (Select All)
	if ((e.metaKey || e.ctrlKey) && key === 'a' && !shouldIgnoreKeypress(e, true)) {
		e.preventDefault()
		isGPressed.value = false
		return toggleSelectAll(true)
	}

	// Handle Ctrl/Cmd+Z (Undo)
	if ((e.metaKey || e.ctrlKey) && key === 'z' && !shouldIgnoreKeypress(e, true)) {
		e.preventDefault()
		isGPressed.value = false
		return undo()
	}

	if (shouldIgnoreKeypress(e)) return

	if (key === 'g') return handleGKeyPress(e)
	if (isGPressed.value) return handleGMenuNavigation(e, key)
	if (key === 'enter') return handleEnter(e)
	if (key === 'escape') return handleEscape(e)
	if (key === '?') return handleShowShortcuts(e)

	const hasSelection = selections.value.length > 0 || threadID
	if (hasSelection) handleThreadActions(e, key)
	handleArrowNavigation(e, key)
}

const handleGKeyPress = (e: KeyboardEvent) => {
	clearTimeout(gPressTimeout.value)

	if (e.shiftKey) {
		const lastThread = threadIDs.value.at(-1)
		if (threadID) return goToThread(lastThread)
		return focusOnThread(lastThread)
	}

	if (isGPressed.value) {
		isGPressed.value = false
		const firstThread = threadIDs.value[0]
		if (threadID) return goToThread(firstThread)
		return focusOnThread(firstThread)
	}

	isGPressed.value = true
	gPressTimeout.value = setTimeout(() => (isGPressed.value = false), 750)
}

const handleGMenuNavigation = (e: KeyboardEvent, key: string) => {
	isGPressed.value = false

	const navigationMap: Record<string, string> = {
		i: mailboxIds.inbox,
		f: 'starred',
		s: mailboxIds.sent,
		d: mailboxIds.drafts,
		j: mailboxIds.junk,
		t: mailboxIds.trash,
	}

	const mailboxId = navigationMap[key]
	if (mailboxId) {
		e.preventDefault()
		router.push({ name: 'mail-mailbox', params: { accountId, mailbox: mailboxId } })
	}
}

const handleShowShortcuts = (e: KeyboardEvent) => {
	e.preventDefault()
	showShortcuts.value = true
}

const handleEnter = (e: KeyboardEvent) => {
	e.preventDefault()
	if (threadInFocus.value) goToThread(threadInFocus.value)
	else focusOnThread(threadIDs.value[0])
}

const handleEscape = (e: KeyboardEvent) => {
	e.preventDefault()
	if (threadID) goToMailbox()
	else if (selections.value.length) resetSelections()
	else threadInFocus.value = undefined
}

const handleThreadActions = (e: KeyboardEvent, key: string) => {
	const thread_ids = selections.value.length ? selections.value : [threadID!]

	// Delete/Trash (Backspace on Mac, Delete on Windows)
	if (key === (isMac ? 'backspace' : 'delete')) {
		e.preventDefault()
		if (e.shiftKey || mailbox === mailboxIds.trash)
			return junkOrDeleteThreads(thread_ids, false)
		return handleMoveThreads({ [mailboxIds.trash]: thread_ids })
	}

	// Mark as read/unread (u)
	if (key === 'u') {
		e.preventDefault()
		return handleSetSeen({ [Number(e.shiftKey)]: thread_ids })
	}

	// Archive (e)
	if (key === 'e') {
		e.preventDefault()
		return mailbox === mailboxIds.sent
			? handleAddThreadsToMailbox(mailboxIds.archive, thread_ids)
			: handleMoveThreads({ [mailboxIds.archive]: thread_ids })
	}

	// Mark as junk (!)
	if (key === '!') {
		e.preventDefault()
		return junkOrDeleteThreads(thread_ids, true)
	}
}

const handleArrowNavigation = (e: KeyboardEvent, key: string) => {
	const navigationKeys = ['arrowup', 'arrowdown', 'j', 'k']
	if (!navigationKeys.includes(key)) return

	e.preventDefault()

	const prevThread = threadInFocus.value
	const offset = ['arrowup', 'k'].includes(key) ? -1 : 1

	let newThread = undefined

	// At the last loaded thread, stepping further loads the next window (like the ThreadHeader arrows).
	// newThread stays the in-list target (undefined at the edge), so shift-select skips the crossing —
	// the appended thread resolves asynchronously and a reset would clear selections anyway.
	if (threadID) {
		newThread = getThreadByOffset(offset)
		goToThreadByOffset(offset)
	} else if (!threadIDs.value.includes(threadInFocus.value)) {
		focusOnThread(threadIDs.value[0])
		newThread = threadIDs.value[0]
	} else {
		newThread = getThreadByOffset(offset, threadInFocus.value)
		focusOnThreadByOffset(offset)
	}

	// Handle shift+arrow selection
	if (!(isShiftPressed.value && newThread)) return

	const threadsToToggle = prevThread ? [prevThread, newThread] : [newThread]
	const shouldSelect = !selections.value.includes(newThread)
	toggleSelect(threadsToToggle, shouldSelect, true)
}

const handleKeyUp = (e: KeyboardEvent) => {
	if (e.key === 'Shift') isShiftPressed.value = false
}

interface SelectAction {
	label: string
	onClick: () => void
	icon: typeof RefreshCw
	condition: () => boolean
}

const selectActions = computed((): SelectAction[] => [
	{
		label: __('Star Mails'),
		onClick: () => setFlaggedByThreadIDs(selections.value, true),
		icon: Star,
		condition: () =>
			selections.value.some(
				(threadID) =>
					threadsResource.value?.data?.find((t: Thread) => t.thread_id === threadID)
						?.flagged === 0,
			),
	},
	{
		label: __('Unstar Mails'),
		onClick: () => setFlaggedByThreadIDs(selections.value, false),
		icon: StarOff,
		condition: () =>
			selections.value.some(
				(threadID) =>
					threadsResource.value?.data?.find((t: Thread) => t.thread_id === threadID)
						?.flagged === 1,
			),
	},
	{
		label: __('Archive Threads (E)'),
		onClick: () =>
			mailbox === mailboxIds.sent
				? handleAddThreadsToMailbox(mailboxIds.archive, selections.value)
				: handleMoveThreads({ [mailboxIds.archive]: selections.value }),
		icon: Archive,
		condition: () => mailbox !== mailboxIds.archive,
	},
	{
		label: __('Mark as Junk (!)'),
		onClick: () => junkOrDeleteThreads(selections.value, true),
		icon: CircleAlert,
		condition: () =>
			mailbox !== mailboxIds.drafts &&
			selections.value.some(
				(threadID) =>
					threadsResource.value?.data?.find((t: Thread) => t.thread_id === threadID)
						?.junk === 0,
			),
	},
	{
		label: __('Mark as Not Junk'),
		onClick: () => handleSetSpamStatus({ 0: selections.value }),
		icon: CircleCheck,
		condition: () =>
			selections.value.some(
				(threadID) =>
					threadsResource.value?.data?.find((t: Thread) => t.thread_id === threadID)
						?.junk === 1,
			),
	},
	{
		label: __('Move to Trash (Delete)'),
		onClick: () => handleMoveThreads({ [mailboxIds.trash]: selections.value }),
		icon: Trash2,
		condition: () => mailbox !== mailboxIds.trash,
	},
	{
		label: __('Delete Threads (Shift+Delete)'),
		onClick: () => junkOrDeleteThreads(selections.value, false),
		icon: Trash2,
		condition: () => mailbox === mailboxIds.trash,
	},
	{
		label: __('Mark as Read (Shift+U)'),
		onClick: () => handleSetSeen({ 1: selections.value }),
		icon: MailOpen,
		condition: () =>
			selections.value.some(
				(threadID) =>
					threadsResource.value?.data?.find((t: Thread) => t.thread_id === threadID)
						?.seen === 0,
			),
	},
	{
		label: __('Mark as Unread (U)'),
		onClick: () => handleSetSeen({ 0: selections.value }),
		icon: MailIcon,
		condition: () =>
			selections.value.some(
				(threadID) =>
					threadsResource.value?.data?.find((t: Thread) => t.thread_id === threadID)
						?.seen === 1,
			),
	},
])

// Search

// Infinite-scroll state (shared by the threads and search resources — only one is active at a time)
const PAGE_LENGTH = 25
const hasMore = ref(false) // lookahead: the last fetched window returned an extra row, so more exist
const loadingMore = ref(false) // an append fetch is in flight (drives the bottom spinner)
// Bumped on every reset-to-top; an in-flight append captures it and discards its result if it changed
// meanwhile, so a stale window can't land on a freshly reset list.
const epoch = ref(0)
let loadEpoch = 0 // epoch captured when the current append was triggered
// Refresh ("check for new mail") state: merges the newest window into the loaded list, preserving
// scroll — set while such a reload is in flight so its onSuccess prepends instead of replacing.
const refreshMode = ref(false)
let refreshEpoch = 0 // epoch captured when the refresh was triggered (dropped if a reset intervenes)
// The loaded list to merge the fresh window into. Captured at *response* time (in the resource
// transform), not refresh-start, so it reflects any optimistic removals/undo-inserts that happened
// while the refresh was in flight — otherwise a thread archived mid-refresh would reappear.
let refreshSnapshot: Thread[] = []
// Current mailbox's record (carries total_threads/unread_threads); used by the periodic poll to
// detect count changes and by the tab title's unread badge.
const mailboxObj = computed(() => mailboxes.data?.find((m) => m.id === mailbox))

// ── Screener banner ─────────────────────────────────────────────────────────────────────────────
// An info bar mirroring the trash/junk one, shown on the inbox while Hey-style screening is on and
// unscreened threads are waiting. The count is the Screening folder's unread count, kept fresh by the
// periodic mailbox poll below.
const activeAccount = computed(() => user.data?.accounts?.find((a) => a.id === accountId))
const screeningEnabled = computed(() => !!activeAccount.value?.enable_screening)
const screenerCount = computed(
	() =>
		mailboxes.data?.find((m: MailboxData) => m.id === mailboxIds.screener)?.unread_threads ??
		0,
)
const showScreenerBanner = computed(
	() =>
		mailbox === mailboxIds.inbox &&
		screeningEnabled.value &&
		screenerCount.value > 0 &&
		(showReadingPane.value || !threadID),
)
const screenerBannerLabel = computed(() =>
	screenerCount.value === 1
		? __('1 new thread is waiting to be screened.')
		: __('{0} new threads are waiting to be screened.', [String(screenerCount.value)]),
)
const goToScreener = () => router.push({ name: 'mail-screener', params: { accountId } })

const scrollListToTop = () => mailListRef.value?.scrollTo({ top: 0 })

// Called when a first-window fetch resolves. Two modes:
// - refresh: keep the loaded rows, prepend only threads not already loaded (new mail), and hold the
//   reader's scroll position (re-anchored by the height the prepended rows added).
// - reset: reveal the fresh first window and scroll to top (mailbox switch, filter, undo, …).
// Either way, cancel any pending edge navigation.
const onResetSuccess = () => {
	pendingEdgeThread = null

	if (refreshMode.value) {
		refreshMode.value = false
		// A reset (mailbox switch, filter, undo) raced in and bumped the epoch — drop this stale merge.
		if (refreshEpoch !== epoch.value) return
		// Anchor to the current scroll before merging. The window replaced `data` a beat ago but the DOM
		// hasn't re-rendered yet, so these still reflect the loaded list the reader is looking at.
		const el = mailListRef.value
		const prevTop = el?.scrollTop ?? 0
		const prevHeight = el?.scrollHeight ?? 0
		const freshWindow = threadsResource.value.data ?? []
		const existing = new Set(refreshSnapshot.map((t) => t.thread_id))
		const fresh = freshWindow.filter((t: Thread) => !existing.has(t.thread_id))
		threadsResource.value.data = [...fresh, ...refreshSnapshot]
		// Keep the reader where they were: shift scroll by the height the prepended rows added. If they
		// were already at the top, leave them there so the new mail is visible.
		nextTick(() => {
			if (el && prevTop > 0) el.scrollTop = prevTop + (el.scrollHeight - prevHeight)
		})
		return
	}

	scrollListToTop()
}

// Reset resource for search: always the first window, over-fetching one row to drive `hasMore`.
const searchResults = createResource({
	url: 'suite.mail.api.mail.search_mails',
	makeParams: () => ({
		account: store.accountId,
		filter: route.query,
		limit: PAGE_LENGTH + 1,
		start: 0,
	}),
	transform: (data: [Thread[], number]) => {
		if (refreshMode.value) refreshSnapshot = threadsResource.value.data ?? []
		hasMore.value = data[0].length > PAGE_LENGTH
		return data[0].slice(0, PAGE_LENGTH)
	},
	onSuccess: () => {
		onResetSuccess()
		if (mailbox === 'search') isMailboxLoaded.value = true
	},
})

watch(
	() => JSON.stringify(route.query),
	() => {
		if (mailbox === 'search') resetThreads()
	},
)

// Main data

const filter = ref<string | null>(
	localStorage.getItem(`user:${user.data.name}:filter:${mailbox}`) || null,
)
const isMailboxLoaded = ref(false)

// Reset resource for a mailbox: always the first window. Over-fetches one row (PAGE_LENGTH + 1) to
// detect whether more exist without relying on the (flaky) stored count.
const threads = createResource({
	url: 'suite.mail.api.mail.get_threads',
	makeParams: () => ({
		account: store.accountId,
		mailbox,
		limit: PAGE_LENGTH + 1,
		start: 0,
		filter_by: filter.value,
	}),
	transform: (data: [Thread[], string]) => {
		// In refresh mode, snapshot the live loaded list now — before this window replaces it — so the
		// merge in onResetSuccess reflects any optimistic removals/undo-inserts made during the fetch.
		if (refreshMode.value) refreshSnapshot = threadsResource.value.data ?? []
		const rows = data[0]
		hasMore.value = rows.length > PAGE_LENGTH
		return rows.slice(0, PAGE_LENGTH)
	},
	onSuccess: (data: [Thread[], string]) => {
		onResetSuccess()
		if (mailbox === data[1]) isMailboxLoaded.value = true
	},
})

const threadsResource = computed(() => (mailbox === 'search' ? searchResults : threads))

// ── Infinite scroll ─────────────────────────────────────────────────────────────────────────────
// Two fetch paths that both write `threadsResource.value.data` — the single accumulated list every
// consumer reads: the reset resources above replace it (start:0); the append resources below push the
// next window onto it. Kept separate so createResource's replace-on-reload never fights the append.

// Appends the next window onto the loaded list, deduped by thread_id. `start = data.length` stays
// correct across optimistic removals (the server list shifts left by the same rows we dropped); the
// only skew is new mail inserted at the front, which the dedupe absorbs and the next reset reconciles.
const appendThreads = (rows: Thread[]) => {
	loadingMore.value = false
	// Discard a stale window that resolved after a reset began (mailbox switch, refresh, undo, …).
	if (loadEpoch !== epoch.value) return
	const seen = new Set(threadsResource.value.data.map((t: Thread) => t.thread_id))
	const fresh = rows.slice(0, PAGE_LENGTH).filter((t) => !seen.has(t.thread_id))
	// Stop auto-loading if the window added nothing new (offset stuck behind heavy front-inserted mail);
	// the next reset (poll/refresh/socket) reconciles. Guards against a tight reload loop while the
	// sentinel stays in view.
	hasMore.value = rows.length > PAGE_LENGTH && fresh.length > 0
	threadsResource.value.data = [...threadsResource.value.data, ...fresh]
	openPendingEdgeThread()
}

const loadMoreThreads = createResource({
	url: 'suite.mail.api.mail.get_threads',
	makeParams: () => ({
		account: store.accountId,
		mailbox,
		limit: PAGE_LENGTH + 1,
		start: threadsResource.value.data.length,
		filter_by: filter.value,
	}),
	onSuccess: (data: [Thread[], string]) => appendThreads(data[0]),
	onError: () => (loadingMore.value = false),
})

const loadMoreSearch = createResource({
	url: 'suite.mail.api.mail.search_mails',
	makeParams: () => ({
		account: store.accountId,
		filter: route.query,
		limit: PAGE_LENGTH + 1,
		start: threadsResource.value.data.length,
	}),
	onSuccess: (data: [Thread[], number]) => appendThreads(data[0]),
	onError: () => (loadingMore.value = false),
})

const loadMore = () => {
	if (!hasMore.value || loadingMore.value || threadsResource.value.loading) return
	loadingMore.value = true
	loadEpoch = epoch.value
	;(mailbox === 'search' ? loadMoreSearch : loadMoreThreads).reload()
}

const loadMoreSentinel = useTemplateRef('loadMoreSentinel')
useIntersectionObserver(
	loadMoreSentinel,
	([entry]) => {
		if (entry?.isIntersecting) loadMore()
	},
	{ root: mailListRef },
)

// The reading pane's Next arrow can always advance while more threads remain to load (crossing the
// last loaded thread triggers an append). The Prev arrow is disabled at the first loaded thread, which
// is the first thread overall (we always start from the top).
const canGoNext = computed(() => hasMore.value)

const isLoading = computed(() => {
	if (!isMailboxLoaded.value) return true
	if (emptyMailbox.loading) return true
	return !threadsResource.value.data.length && threadsResource.value?.loading
})

const threadIDs = computed(
	() => threadsResource.value.data?.map((thread: Thread) => thread.thread_id) || [],
)

// Reset-to-top: refetch only the first window, replacing the loaded list and scrolling to the top
// (via onResetSuccess). Bumping `epoch` discards any append/refresh still in flight. Used for
// mailbox/account switch, filter change, undo, and empty-mailbox.
const resetThreads: (reloadMailboxes?: boolean, mailboxRoles?: MailboxRole[]) => void = (
	reloadMailboxes = true,
	mailboxRoles = [],
) => {
	if (mailboxRoles.length && !mailboxRoles.map((m) => mailboxIds[m]).includes(mailbox)) return

	refreshMode.value = false
	epoch.value++
	resetSelections()
	threadsResource.value.reload()
	if (reloadMailboxes) mailboxes.reload()
}

// Check for new mail without losing the reader's place: refetch the newest window and prepend only the
// threads not already loaded (see onResetSuccess), keeping scroll position and the loaded rows. Used by
// the Refresh button, the periodic poll, and the new-mail socket. Selections are preserved.
const refreshThreads = (reloadMailboxes = true) => {
	if (threadsResource.value.loading || loadingMore.value) return

	refreshMode.value = true
	// Bump the epoch so an append still in flight is discarded (appendThreads checks it) instead of
	// landing after the merge and clobbering it. A new append can't start mid-refresh (loadMore bails
	// while the resource is loading), so this fully closes the refresh/append race. The merge base
	// (refreshSnapshot) and scroll anchor are captured later, at response time, so they reflect the list
	// as it actually is when the window arrives — not a stale start-of-refresh copy.
	epoch.value++
	refreshEpoch = epoch.value
	threadsResource.value.reload()
	if (reloadMailboxes) mailboxes.reload()
}

// After an optimistic action whose threads stay in the list (add-to-mailbox, or a move that leaves
// copies in the current mailbox): refresh selections + sidebar counts only, never refetch the list.
const syncAfterAction = () => {
	resetSelections()
	mailboxes.reload()
}

// Drops threads from the loaded list optimistically and returns the removed rows (so an undo can put
// them back). Their server rows leave the current view too, so the append offset (data.length) stays
// aligned. If the list empties while more remain, reset to top (the sentinel unmounts with an empty
// list and couldn't otherwise re-trigger a load).
const removeThreadsFromList = (thread_ids: string[]): Thread[] => {
	const data = threadsResource.value.data ?? []
	const removed = data.filter((thread: Thread) => thread_ids.includes(thread.thread_id))
	threadsResource.value.data = data.filter(
		(thread: Thread) => !thread_ids.includes(thread.thread_id),
	)
	if (!threadsResource.value.data.length && hasMore.value) resetThreads()
	return removed
}

// Re-insert threads (after undoing a move/junk) at their correct position by received_at, so they
// return to where they were instead of jumping to the top. Scroll stays put — the browser's
// scroll-anchoring holds the viewport as rows reappear above it.
const restoreThreadsToList = (restored: Thread[]) => {
	if (!restored.length) return
	const list = [...(threadsResource.value.data ?? [])]
	const present = new Set(list.map((t: Thread) => t.thread_id))
	for (const thread of restored) {
		if (present.has(thread.thread_id)) continue
		// The list is sorted newest-first; drop the thread before the first older row.
		const idx = list.findIndex((t: Thread) => t.received_at < thread.received_at)
		idx === -1 ? list.push(thread) : list.splice(idx, 0, thread)
	}
	threadsResource.value.data = list
}

watch(
	() => [mailbox, accountId],
	() => {
		isMailboxLoaded.value = false
		threadsResource.value.data = []
		filter.value = localStorage.getItem(`user:${user.data.name}:filter:${mailbox}`) || null
		threadInFocus.value = undefined
		collapsedGroups.value = []
		resetThreads(false)
	},
	{ immediate: true },
)

// Periodically refresh the mailbox list (keeps sidebar counts current), then merge in new threads only
// when the mailbox's thread count actually changed — so a quiet mailbox isn't touched (and the reader
// isn't disturbed) every 30s.
const pollForChanges = async () => {
	const prevTotal = mailboxObj.value?.total_threads
	await mailboxes.reload()
	if (mailboxObj.value?.total_threads !== prevTotal) refreshThreads(false)
}

onMounted(() => {
	window.addEventListener('keydown', handleKeyDown)
	window.addEventListener('keyup', handleKeyUp)
	reloadInterval.value = setInterval(pollForChanges, 30000)

	socket.on('new_mail_created', (updatedMailboxes: string[]) => {
		if (updatedMailboxes.includes(mailbox)) refreshThreads()
	})

	socket.on('mail_exchange_completed', (payload: { success: boolean; message: string }) =>
		raiseToast(payload.message, payload.success ? 'success' : 'error'),
	)

	socket.on('calendar_exchange_completed', (payload: { success: boolean; message: string }) =>
		raiseToast(payload.message, payload.success ? 'success' : 'error'),
	)
})

onUnmounted(() => {
	window.removeEventListener('keydown', handleKeyDown)
	window.removeEventListener('keyup', handleKeyUp)
	if (reloadInterval.value) clearInterval(reloadInterval.value)
	// Leaving the mailbox drops any pending undo so a lingering toast can't undo into another view.
	setUndoAction(undefined)
})

const goToMailbox = () =>
	router.push({ name: 'mail-mailbox', params: { accountId, mailbox }, query: route.query })

const getThreadByOffset = (offset: number, currentThread: string = threadID!) =>
	threadIDs.value[threadIDs.value.indexOf(currentThread) + offset]

const goToThread = (threadID: string) => {
	if (threadID)
		router.push({ name: 'mail-mail', params: { accountId, mailbox, threadID }, query: route.query })
}

// Stepping past the last loaded thread loads the next window, then opens/focuses the newly appended
// thread once it arrives (`openPendingEdgeThread`, called from the append's onSuccess). `action`
// distinguishes the reading view (open) from list keyboard focus (focus). `anchor` is the thread we
// stepped off (the previously-last loaded), captured so we can resolve its successor after the append.
// There's no backward case — the first loaded thread is the first thread overall.
let pendingEdgeThread: { action: 'open' | 'focus'; anchor: string | undefined } | null = null

const loadMoreThenOpenEdge = (offset: number, action: 'open' | 'focus') => {
	// One crossing at a time: ignore further edge steps until the append resolves, so key auto-repeat
	// at the bottom of the list can't fire a burst of loads.
	if (pendingEdgeThread || offset < 0 || !hasMore.value) return
	pendingEdgeThread = { action, anchor: action === 'open' ? threadID : threadInFocus.value }
	loadMore()
}

const goToThreadByOffset = (offset: number) => {
	const next = getThreadByOffset(offset)
	if (next) return goToThread(next)
	loadMoreThenOpenEdge(offset, 'open')
}

const openPendingEdgeThread = () => {
	if (!pendingEdgeThread) return
	const { action, anchor } = pendingEdgeThread
	// The successor of the anchor is now loaded (undefined only if nothing new arrived — then stop).
	const id = getThreadByOffset(1, anchor)
	pendingEdgeThread = null
	if (!id) return
	if (action === 'open') goToThread(id)
	else focusOnThread(id)
}

const goToNextThreadOrMailbox = (excludedThreads: string[] = []) => {
	const idx = threadIDs.value.indexOf(threadID)
	const next = threadIDs.value.slice(idx + 1).find((id) => !excludedThreads.includes(id))
	if (next) goToThread(next)
	else goToMailbox()
}

const focusOnThread = (threadID: string) => {
	if (!threadID) return

	threadInFocus.value = threadID
	scrollIntoView(threadID)
}

const focusOnThreadByOffset = (offset: number) => {
	const next = getThreadByOffset(offset, threadInFocus.value)
	if (next) return focusOnThread(next)
	loadMoreThenOpenEdge(offset, 'focus')
}

const scrollIntoView = (threadID: string) => {
	const el = mailItemsRef.value?.find((el) => el?.id === threadID)?.$el
	if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

// Actions

const {
	handleSetSeen,
	handleSyncUnseen,
	setFlaggedByThreadIDs,
	handleMoveThreads,
	handleSetSpamStatus,
	handleAddThreadsToMailbox,
	handleRemoveThreadsFromMailbox,
	junkOrDeleteThreads,
	setFlagged,
	moveToOptions,
	addToOptions,
	removeFromOptions,
	showAddTo,
	showRemoveFrom,
	showJunkOrDeleteThreads,
	junkOrDeleteThreadsOptions,
} = useThreadActions({
	threadsResource,
	mailbox: computed(() => mailbox),
	threadID: computed(() => threadID),
	selections,
	mailThreadRef,
	resetThreads,
	syncAfterAction,
	removeThreadsFromList,
	restoreThreadsToList,
	goToMailbox,
	goToNextThreadOrMailbox,
})

const showEmptyMailbox = ref(false)

const emptyMailbox = createResource({
	url: 'suite.mail.api.mail.empty_user_mailbox',
	makeParams: () => ({ account: store.accountId, mailbox }),
	onSuccess: () => {
		threadsResource.value.data = []
		raiseToast(__('{0} emptied.', [mailboxName.value]))
		resetThreads()
	},
	onError: (error) => raiseToast(error.message, 'error'),
})

const emptyMailboxOptions = computed(() => ({
	title: __('Empty {0}', [mailboxName.value]),
	message: __(`Are you sure you want to empty the contents of this mailbox?`),
	icon: { name: 'alert-triangle', appearance: 'warning' },
	actions: [
		{
			label: __('Confirm'),
			variant: 'solid',
			onClick: () => {
				emptyMailbox.submit()
				showEmptyMailbox.value = false
			},
		},
	],
}))

// Filter

const FILTER_OPTIONS = [
	{
		label: __('All'),
		icon: Mails,
		onClick: () => setFilter(null),
	},
	{
		label: __('Unread'),
		icon: MailIcon,
		onClick: () => setFilter('unread'),
	},
	{
		label: __('Starred'),
		icon: Star,
		onClick: () => setFilter('starred'),
		condition: () => ![mailboxIds.trash, 'starred'].includes(mailbox),
	},
	{
		label: __('Has attachments'),
		icon: Paperclip,
		onClick: () => setFilter('has_attachments'),
	},
]

const setFilter = (value: string | null) => {
	filter.value = value
	localStorage.setItem(`user:${user.data.name}:filter:${mailbox}`, value ?? '')
	resetThreads(false)
}

// UI formatting

const mailboxName = computed(() => {
	switch (mailbox) {
		case 'starred':
			return __('Starred')
		case 'search':
			return __('Search')
		default:
			return mailboxObj.value?._name
	}
})
const unreadThreadsPrefix = computed(() =>
	mailboxObj.value?.unread_threads ? `(${mailboxObj.value.unread_threads})` : '',
)

const currentThread = computed(() =>
	threadsResource.value?.data?.find((t: Thread) => t.thread_id === threadID),
)

usePageMeta(() => {
	if (threadID) return { title: currentThread.value?.subject || __('[No Subject]') }
	return { title: `${unreadThreadsPrefix.value} ${mailboxName.value}` }
})

const title = computed(() => {
	if (selections.value.length)
		return selections.value.length === 1
			? __('1 item selected')
			: __('{0} items selected', [String(selections.value.length)])

	switch (filter.value) {
		case 'unread':
			return __('Unread Mails')
		case 'starred':
			return __('Starred Mails')
		case 'has_attachments':
			return __('With Attachments')
		default:
			return __('All Mails')
	}
})
</script>

<style scoped>
.checkbox-hitbox:hover :deep(input[type='checkbox']) {
	@apply shadow-sm;
	border-color: var(--outline-gray-7);
}

.loading-bar__fill {
	animation: loading-bar-slide 1.2s linear infinite;
}

@keyframes loading-bar-slide {
	0% {
		transform: translateX(-100%);
	}
	100% {
		transform: translateX(333%);
	}
}
</style>
