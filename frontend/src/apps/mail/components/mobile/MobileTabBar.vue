<template>
	<!-- Compose FAB — floats above the bar, right thumb zone. Both the FAB and the
	     bar step aside while a thread is open: the thread's own reply actions own
	     the bottom edge there (the modals below stay mounted regardless). Hidden in
	     search results and the screener too — composing isn't part of those tasks. -->
	<Button
		v-if="
			!isThreadOpen &&
			!isMobileSelectionActive &&
			!isSearchRoute &&
			!showSearchModal &&
			!screenerActive
		"
		variant="solid"
		class="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 z-10 !h-14 !w-14 !rounded-full shadow-lg"
		:aria-label="__('Compose')"
		@click="showSendModal = true"
	>
		<template #icon>
			<FeatherIcon name="edit" class="h-6 w-6" />
		</template>
	</Button>

	<!-- Bottom tab bar — Raven-inspired: translucent bar with a hairline top border
	     and faint upward shadow; lucide icons, tint-only active state. -->
	<!-- Stays mounted during selection mode — the selection action bar overlays it at
	     identical geometry, so the layout never shifts. -->
	<nav
		v-if="!isThreadOpen"
		class="bg-surface-base/80 z-10 shrink-0 border-t pb-[env(safe-area-inset-bottom)] shadow-[0_-2px_5px_rgba(0,0,0,0.03)] backdrop-blur-lg"
	>
		<div class="flex h-15 items-stretch">
			<!-- Tab 1 morphs into the current folder: the fixed slot position is the
			     stable cue; icon + label say where you are. Re-tap opens the switcher. -->
			<button :class="tabClass(mailActive)" @click="openMail">
				<span class="relative">
					<Icon
						v-if="currentFolder"
						:name="currentFolder.icon"
						:class="iconClass(mailActive)"
					/>
					<Icon v-else name="inbox" :class="iconClass(mailActive)" />
					<span v-if="mailBadgeCount" :class="badgeClass">{{
						badgeText(mailBadgeCount)
					}}</span>
				</span>
				<span class="max-w-full truncate px-1" :class="labelClass(mailActive)">
					{{ currentFolder?.label ?? __('Inbox') }}
				</span>
			</button>
			<button v-if="screeningEnabled" :class="tabClass(screenerActive)" @click="openScreener">
				<span class="relative">
					<Icon name="eye" :class="iconClass(screenerActive)" />
					<span v-if="screenerCount" :class="badgeClass">{{ badgeText(screenerCount) }}</span>
				</span>
				<span :class="labelClass(screenerActive)">{{ __('Screener') }}</span>
			</button>
			<button :class="tabClass(searchActive)" @click="openSearch">
				<Icon name="search" :class="iconClass(searchActive)" />
				<span :class="labelClass(searchActive)">{{ __('Search') }}</span>
			</button>
			<!-- Profile is a sheet over the current surface (search included), not a navigation —
			     it must not dismiss the search overlay. -->
			<button :class="tabClass(isProfileSheetOpen)" @click="openProfileSheet">
				<Avatar :label="activeAccountName" size="md" class="shrink-0" />
				<span :class="labelClass(isProfileSheetOpen)">{{ __('Profile') }}</span>
			</button>
		</div>
	</nav>

	<SendMail v-model="showSendModal" />
	<SearchModal v-model="showSearchModal" />
	<MobileFolderSheet />
	<MobileProfileSheet />
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Avatar, Button, FeatherIcon } from 'frappe-ui'
import { Icon } from 'frappe-ui/icons'

import { getIcon, getMailboxName } from '@/apps/mail/utils'
import {
	useFolderSheet,
	useMobileSelection,
	useProfileSheet,
} from '@/apps/mail/utils/composables'
import { userStore } from '@/apps/mail/stores/user'
import SearchModal from '@/apps/mail/components/Modals/SearchModal.vue'
import SendMail from '@/apps/mail/components/SendMail.vue'
import MobileFolderSheet from '@/apps/mail/components/mobile/MobileFolderSheet.vue'
import MobileProfileSheet from '@/apps/mail/components/mobile/MobileProfileSheet.vue'

import type { MailboxData } from '@/apps/mail/types'

const route = useRoute()
const router = useRouter()
const store = userStore()
const { mailboxes, allInboxesUnread } = store
const { openFolderSheet } = useFolderSheet()
const { isProfileSheetOpen, openProfileSheet } = useProfileSheet()
const { isMobileSelectionActive } = useMobileSelection()

const activeAccountName = computed(
	() => store.userResource?.data?.accounts?.find((a) => a.id === store.accountId)?._name ?? '',
)

// The folder currently shown by a mail route; null elsewhere (tab falls back to "Inbox").
const currentFolder = computed(() => {
	if (route.name === 'mail-all-inboxes') return { label: __('All Inboxes'), icon: 'mails' }
	if (route.name !== 'mail-mailbox') return null
	if (route.params.mailbox === 'starred') return { label: __('Starred'), icon: 'star' }
	const mailbox = mailboxes.data?.find((m: MailboxData) => m.id === route.params.mailbox)
	return mailbox ? { label: getMailboxName(mailbox), icon: getIcon(mailbox) } : null
})

const showSendModal = ref(false)
const showSearchModal = ref(false)

const MAIL_ROUTES = ['mail-mailbox', 'mail-all-inboxes']
const isThreadOpen = computed(() => !!route.params.threadID)
// Search results live on the mailbox route with the virtual 'search' mailbox, but
// they belong to the Search tab — the Mail tab must not read as active there.
const isSearchRoute = computed(
	() => route.name === 'mail-mailbox' && route.params.mailbox === 'search',
)
const mailActive = computed(
	() => MAIL_ROUTES.includes(route.name as string) && !isSearchRoute.value,
)
const screenerActive = computed(() => route.name === 'mail-screener')
const searchActive = computed(() => showSearchModal.value || isSearchRoute.value)

// The Search tab is a navigation like the others: it lands on the search page (so tab
// selection stays route-driven — an overlay over a mail route read as two active tabs),
// then opens the query editor on top of it. Navigate first: the editor pushes its own
// history state, which must sit above the search page's entry for back to unwind cleanly.
const openSearch = async () => {
	if (!isSearchRoute.value)
		await router.push({
			name: 'mail-mailbox',
			params: { accountId: store.accountId, mailbox: 'search' },
		})
	showSearchModal.value = true
}

const openMail = () => {
	// The query editor overlay leaves the bar visible; a tab tap first dismisses it. It
	// only ever covers the search page now, so the tap always navigates on to the inbox.
	if (showSearchModal.value) {
		showSearchModal.value = false
		if (!mailActive.value) router.push('/mail')
		return
	}
	// Re-tapping the active Mail tab opens the folder switcher.
	if (mailActive.value) {
		openFolderSheet()
		return
	}
	// From elsewhere the tab reads "Inbox" with the Inbox's unread badge, so the
	// tap must land there — restoring the last-viewed folder made a badged tab
	// open Sent. (/mail redirects to the inbox.)
	router.push('/mail')
}

const openScreener = () => {
	showSearchModal.value = false
	if (screenerActive.value) return
	router.push({ name: 'mail-screener', params: { accountId: store.accountId } })
}

const screeningEnabled = computed(
	() =>
		!!store.userResource?.data?.accounts?.find((a) => a.id === store.accountId)
			?.enable_screening,
)

const screenerCount = computed(
	() =>
		mailboxes.data?.find((m: MailboxData) => m.id === store.mailboxIds.screener)
			?.unread_threads ?? 0,
)

// The badge follows what the tab is showing: the current folder's unread while
// on a mail route (so Drafts with nothing unread shows no badge), the Inbox's
// unread when the tab reads "Inbox" from elsewhere. Starred is virtual — no count.
const mailBadgeCount = computed(() => {
	if (route.name === 'mail-all-inboxes') return allInboxesUnread.data ?? 0
	// In search the tab reads "Inbox" (below), so fall through to the Inbox's count.
	if (route.name === 'mail-mailbox' && !isSearchRoute.value) {
		if (route.params.mailbox === 'starred') return 0
		return (
			mailboxes.data?.find((m: MailboxData) => m.id === route.params.mailbox)
				?.unread_threads ?? 0
		)
	}
	return (
		mailboxes.data?.find((m: MailboxData) => m.id === store.mailboxIds.inbox)
			?.unread_threads ?? 0
	)
})

// Numeric unread badge shared by the Mail and Screener tabs (replaces the old
// presence dot). Bordered like the dot was, to read against the translucent bar.
// Anchored at the icon's top-right (left 60%) and allowed to overflow, so wide
// counts ("99+") grow outward instead of spreading back across the glyph — the
// icon keeps its optical centering. Neutral ink pill, not red — counts are
// information here, and red shouted louder than the active tab. gray-10 +
// ink-base is the app's inverted-chip pair (see the row selection check),
// flipping correctly in both themes.
const badgeClass =
	'bg-surface-gray-10 text-ink-base absolute -top-1.5 left-[60%] flex h-4 min-w-5 items-center justify-center rounded-full border border-[var(--surface-base)] px-1 text-[10px] font-semibold leading-none'

const badgeText = (count: number) => (count > 99 ? '99+' : String(count))

// Active/inactive contrast rides two channels: ink (9 vs 4 — dropping inactive
// to 3 read as more disparity but tipped into illegible) and weight (stroke 2
// vs 1.75, semibold vs medium), so the active tab pops without any label going
// faint.
const tabClass = (active: boolean) =>
	[
		'flex flex-1 flex-col items-center justify-center gap-1',
		active ? 'text-ink-gray-9' : 'text-ink-gray-4',
	].join(' ')

const iconClass = (active: boolean) =>
	['h-6 w-6 shrink-0', active ? 'stroke-2' : '[stroke-width:1.75]'].join(' ')

const labelClass = (active: boolean) =>
	['text-xs !leading-3', active ? '!font-semibold' : '!font-medium'].join(' ')
</script>
