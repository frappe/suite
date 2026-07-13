<template>
	<!-- Header -->
	<header class="flex items-center justify-between border-b px-3 py-2.5 sm:px-5">
		<div class="flex items-center space-x-2">
			<Button v-if="isMobile" icon="menu" variant="ghost" @click="openSidebar" />
			<Breadcrumbs :items="[{ label: __('All Inboxes'), route: { name: 'mail-all-inboxes' } }]" />
		</div>
		<HeaderActions @reload-mails="reload()" />
	</header>

	<div class="relative flex h-[calc(100dvh-3.05rem)]">
		<!-- Loading -->
		<div v-if="isLoading" class="flex w-full flex-col items-center justify-center">
			<div class="text-ink-gray-5 flex items-center space-x-2">
				<LoaderCircle class="h-5 w-5 animate-spin" />
				<span>{{ __('Loading...') }}</span>
			</div>
		</div>

		<template v-else-if="threads.data?.length">
			<div ref="mailSidebar" class="sticky top-16 flex w-full flex-col border-r">
				<!-- Toolbar -->
				<div
					class="relative flex items-center border-b border-l-transparent px-3.5 py-2.5 sm:border-l sm:px-5"
				>
					<Dropdown :options="FILTER_OPTIONS">
						<button
							class="text-ink-gray-8 hover:bg-surface-gray-2 -ml-2 flex min-w-0 items-center gap-1 rounded px-2 py-1"
						>
							<span class="truncate">{{ title }}</span>
							<ChevronDown class="text-ink-gray-5 icon shrink-0" />
						</button>
					</Dropdown>
					<Button
						class="ml-1.5"
						variant="ghost"
						:tooltip="__('Refresh')"
						:disabled="threads.loading"
						@click="reload()"
					>
						<template #icon>
							<RefreshCw class="icon" :class="{ 'animate-spin': threads.loading }" />
						</template>
					</Button>
					<div class="-mr-1.5 ml-auto flex items-center space-x-1.5 sm:space-x-3">
						<div v-if="displayTotal" class="text-ink-gray-6 flex items-center gap-1">
							<span class="whitespace-nowrap text-sm tabular-nums">
								{{ range }} {{ __('of') }} {{ totalLabel }}
							</span>
							<Button
								:tooltip="__('Previous Page')"
								variant="ghost"
								:disabled="!canGoPrev"
								@click="goToPage(false)"
							>
								<template #icon>
									<ChevronLeft class="icon" />
								</template>
							</Button>
							<Button
								:tooltip="__('Next Page')"
								variant="ghost"
								:disabled="!canGoNext"
								@click="goToPage(true)"
							>
								<template #icon>
									<ChevronRight class="icon" />
								</template>
							</Button>
						</div>
					</div>

					<!-- Loading bar -->
					<div
						v-if="threads.loading"
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
				<div ref="mailList" class="h-full overflow-y-auto overscroll-contain">
					<div v-for="(group, key) in groupedThreads" :key="key">
						<div
							v-if="groupMessagesBy !== 'None'"
							class="text-ink-gray-6 flex items-center border-b border-l-transparent p-3.5 text-xs-semibold sm:border-l sm:px-5"
						>
							<span class="select-none pt-[2px]">
								{{ getFormattedDate(key, groupMessagesBy === 'Month').toUpperCase() }}
							</span>
						</div>
						<MailListItem
							v-for="mail in group"
							:key="`${mail.account}:${mail.thread_id}`"
							:mailbox="mail.inbox || ''"
							:account-id="mail.account"
							:account-label="mail.account_name || undefined"
							:mail
							:is-selected="false"
							:selectable="false"
							class="border-l-transparent sm:border-l"
							@set-seen="(seen: boolean) => handleSetSeen(mail, seen)"
							@archive-thread="handleArchive(mail)"
							@trash-thread="handleTrash(mail)"
							@set-flagged="(flagged: boolean) => handleSetFlagged(mail, flagged)"
						/>
					</div>
				</div>
			</div>
		</template>

		<!-- No mails -->
		<div v-else class="text-ink-gray-5 flex w-full flex-col items-center justify-center">
			<NoMails class="text-ink-gray-2 mb-2 h-16 w-16" />
			<p>{{ __('You have no mails in any inbox.') }}</p>
			<Button
				class="mt-3"
				variant="ghost"
				:label="__('Refresh')"
				:disabled="threads.loading"
				@click="reload()"
			>
				<template #prefix>
					<RefreshCw class="icon" :class="{ 'animate-spin': threads.loading }" />
				</template>
			</Button>
		</div>
	</div>
</template>

<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted, ref, useTemplateRef } from 'vue'
import { useDebounceFn } from '@vueuse/core'
import {
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	LoaderCircle,
	Mail as MailIcon,
	Mails,
	Paperclip,
	RefreshCw,
	Star,
} from 'lucide-vue-next'
import { Breadcrumbs, Button, Dropdown, call, createResource, usePageMeta } from 'frappe-ui'

import { getFormattedDate, raisePromiseToast, raiseToast } from '@/apps/mail/utils'
import { useScreenSize, useSidebar } from '@/apps/mail/utils/composables'
import { userStore } from '@/apps/mail/stores/user'
import HeaderActions from '@/apps/mail/components/HeaderActions.vue'
import NoMails from '@/apps/mail/components/Icons/NoMails.vue'
import MailListItem from '@/apps/mail/components/MailListItem.vue'

import type { Thread, UserResource } from '@/apps/mail/types'

const { isMobile } = useScreenSize()
const { openSidebar } = useSidebar()

const socket = inject('$socket')
const user = inject('$user') as UserResource
const dayjs = inject('$dayjs')

const store = userStore()

// Pagination (lookahead only — there's no cheap exact total across accounts, so the running count
// gets a "+" suffix while a next page is detected, mirroring the mailbox view's filtered mode).
const PAGE_LENGTH = 25
const page = ref(0) // navigation target
const displayedPage = ref(0) // page currently shown; lags `page` until its data loads
const hasMore = ref(false) // an extra row was returned, so a next page exists
const isLoaded = ref(false)
const filter = ref<string | null>(
	localStorage.getItem(`user:${user.data.name}:filter:all-inboxes`) || null,
)

const mailListRef = useTemplateRef('mailList')

const threads = createResource({
	url: 'suite.mail.api.mail.get_all_inbox_threads',
	makeParams: () => ({
		limit: PAGE_LENGTH + 1,
		start: page.value * PAGE_LENGTH,
		filter_by: filter.value,
	}),
	transform: (rows: Thread[]) => {
		// Fetch one extra row to detect a next page without a total, then clip it from the display.
		hasMore.value = rows.length > PAGE_LENGTH
		return rows.slice(0, PAGE_LENGTH)
	},
	onSuccess: () => {
		if (displayedPage.value !== page.value) {
			displayedPage.value = page.value
			mailListRef.value?.scrollTo({ top: 0 })
		}
		isLoaded.value = true
	},
	auto: true,
})

const isLoading = computed(() => !isLoaded.value && threads.loading)

// After an action, refresh the sidebar counts: the active account's per-mailbox counts, which via the
// store's mailboxes.onSuccess hook also refreshes the unified All Inboxes badge.
const refreshCounts = () => store.mailboxes.reload()

const reload = () => {
	threads.reload()
	refreshCounts()
}

// Pagination controls
const threadsOnPage = computed(() => threads.data?.length ?? 0)
const rangeEnd = computed(() => displayedPage.value * PAGE_LENGTH + threadsOnPage.value)
const rangeStart = computed(() => (rangeEnd.value === 0 ? 0 : displayedPage.value * PAGE_LENGTH + 1))
const range = computed(() =>
	rangeStart.value === rangeEnd.value
		? `${rangeStart.value}`
		: `${rangeStart.value}–${rangeEnd.value}`,
)
const displayTotal = computed(() => rangeEnd.value)
const totalLabel = computed(() => `${rangeEnd.value}${hasMore.value ? '+' : ''}`)

const canGoPrev = computed(() => page.value > 0)
const canGoNext = computed(() => hasMore.value && page.value === displayedPage.value)

const navigate = useDebounceFn(() => threads.reload(), 250)

const goToPage = (next: boolean) => {
	if (next ? !canGoNext.value : !canGoPrev.value) return
	page.value += next ? 1 : -1
	navigate()
}

// Date grouping (headers only — no collapsing, unlike the per-mailbox view)
const groupMessagesBy = computed(() => user.data.group_messages_by)

const groupedThreads = computed<Record<string, Thread[]>>(() =>
	(threads.data ?? []).reduce((groups: Record<string, Thread[]>, thread: Thread) => {
		const date = dayjs(thread.received_at).format(
			groupMessagesBy.value === 'Day' ? 'YYYY-MM-DD' : 'YYYY-MM',
		)
		if (!groups[date]) groups[date] = []
		groups[date].push(thread)
		return groups
	}, {}),
)

// Per-item actions — each row carries its own account + that account's mailbox ids, so actions target
// the correct JMAP account without touching the active-account state.
const messageIds = (thread: Thread) => (thread.messages ?? []).map((m) => m.id)

const removeFromList = (thread: Thread) => {
	threads.data = threads.data?.filter(
		(t: Thread) => !(t.thread_id === thread.thread_id && t.account === thread.account),
	)
}

// Each action is a stateless one-shot `call()` rather than a shared createResource: rows act on
// different accounts/threads and can be fired in rapid succession, so every invocation must be a
// fully independent request. A shared resource carries a single reactive state slot (and one abort
// controller); call() has no shared state, so concurrent row actions can never clobber one another.
const handleSetSeen = (thread: Thread, seen: boolean) => {
	if (thread.seen === (seen ? 1 : 0)) return
	const applySeen = (value: 0 | 1) => {
		thread.seen = value
		thread.messages?.forEach((m) => (m.seen = value))
	}
	applySeen(seen ? 1 : 0)
	call('suite.mail.api.mail.set_mails_seen', {
		account: thread.account,
		ids: messageIds(thread),
		seen,
	})
		.then(refreshCounts)
		.catch((error) => {
			applySeen(seen ? 0 : 1) // revert the optimistic update
			raiseToast(error?.messages?.[0] || error?.message, 'error')
		})
}

const handleSetFlagged = (thread: Thread, flagged: boolean) => {
	thread.flagged = flagged ? 1 : 0
	call('suite.mail.api.mail.set_flagged', {
		account: thread.account,
		ids: [thread.id],
		flagged,
	}).catch((error) => {
		thread.flagged = flagged ? 0 : 1 // revert the optimistic update
		raiseToast(error?.messages?.[0] || error?.message, 'error')
	})
}

// Optimistically drop the row, then move on the server. Reload on both outcomes so a failure restores
// the true list (the row reappears); rethrow on failure so the toast reports the error, not success.
const moveThreadOut = (thread: Thread, mailbox: string) =>
	call('suite.mail.api.mail.move_mails', {
		account: thread.account,
		ids: messageIds(thread),
		mailbox,
		clear_junk: true,
	}).then(reload, (error) => {
		reload()
		throw error
	})

const handleArchive = (thread: Thread) => {
	if (!thread.archive) return raiseToast(__('No Archive folder for this account.'), 'error')
	removeFromList(thread)
	raisePromiseToast(
		() => moveThreadOut(thread, thread.archive!),
		__('Archiving...'),
		__('Thread archived.'),
	)
}

const handleTrash = (thread: Thread) => {
	if (!thread.trash) return raiseToast(__('No Trash folder for this account.'), 'error')
	removeFromList(thread)
	raisePromiseToast(
		() => moveThreadOut(thread, thread.trash!),
		__('Moving to Trash...'),
		__('Thread moved to Trash.'),
	)
}

// Filter
const FILTER_OPTIONS = [
	{ label: __('All'), icon: Mails, onClick: () => setFilter(null) },
	{ label: __('Unread'), icon: MailIcon, onClick: () => setFilter('unread') },
	{ label: __('Starred'), icon: Star, onClick: () => setFilter('starred') },
	{ label: __('Has attachments'), icon: Paperclip, onClick: () => setFilter('has_attachments') },
]

const setFilter = (value: string | null) => {
	filter.value = value
	localStorage.setItem(`user:${user.data.name}:filter:all-inboxes`, value ?? '')
	page.value = 0
	threads.reload()
}

const title = computed(() => {
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

const unreadPrefix = computed(() =>
	store.allInboxesUnread.data ? `(${store.allInboxesUnread.data})` : '',
)

usePageMeta(() => ({ title: `${unreadPrefix.value} ${__('All Inboxes')}` }))

// Keep the merged list fresh: poll periodically and react to new-mail push events (which can arrive
// for any account). Both are cheap reloads of the current page.
const reloadInterval = ref<ReturnType<typeof setInterval>>()

onMounted(() => {
	reloadInterval.value = setInterval(reload, 30000)
	socket.on('new_mail_created', reload)
})

onUnmounted(() => {
	if (reloadInterval.value) clearInterval(reloadInterval.value)
	socket.off('new_mail_created', reload)
})
</script>

<style scoped>
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
