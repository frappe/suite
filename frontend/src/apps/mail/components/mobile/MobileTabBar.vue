<template>
	<!-- Compose FAB — floats above the bar, right thumb zone. Both the FAB and the
	     bar step aside while a thread is open: the thread's own reply actions own
	     the bottom edge there (the overlay and sheets below stay mounted regardless).
	     Hidden in search results, the screener and the profile page too — composing
	     isn't part of those tasks. -->
	<Button
		v-if="
			!isThreadOpen &&
			!keyboardOpen &&
			!isMobileSelectionActive &&
			!isSearchRoute &&
			!root.paletteOpen &&
			!screenerActive &&
			!profileActive
		"
		variant="solid"
		class="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 z-10 !h-14 !w-14 !rounded-full shadow-lg"
		:aria-label="__('Compose')"
		@click="openCompose"
	>
		<template #icon>
			<FeatherIcon name="square-pen" class="h-6 w-6" />
		</template>
	</Button>

	<!-- Bottom tab bar — Raven-inspired: translucent bar with a hairline top border
	     and faint upward shadow; lucide icons, tint-only active state. -->
	<!-- Stays mounted during selection mode — the selection action bar overlays it at
	     identical geometry, so the layout never shifts. Steps aside for the on-screen
	     keyboard, though: the shell is sized in dvh and the keyboard shrinks that, so a
	     bar left mounted rides up and sits on top of the keyboard (worst in search, where
	     the field is focused the whole time). -->
	<nav
		v-if="!isThreadOpen && !keyboardOpen"
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
					<span v-if="mailUnreadCount" :class="dotClass" />
				</span>
				<span class="max-w-full truncate px-1" :class="labelClass(mailActive)">
					{{ currentFolder?.label ?? __('Inbox') }}
				</span>
			</button>
			<button v-if="screeningEnabled" :class="tabClass(screenerActive)" @click="openScreener">
				<span class="relative">
					<Icon name="eye" :class="iconClass(screenerActive)" />
					<span v-if="screenerCount" :class="dotClass" />
				</span>
				<span :class="labelClass(screenerActive)">{{ __('Screener') }}</span>
			</button>
			<!-- The tab stands for the person, so it carries their photo when there is one
			     and falls back to the active account's initial. A photo has no stroke to
			     thicken the way the other icons do, so selection draws a ring instead —
			     `ring-current` at the 1.5px they stroke at, and no offset, so it reads as
			     the avatar's own edge rather than a halo. -->
			<button :class="tabClass(profileActive)" @click="openProfile">
				<Avatar
					:label="activeAccountName"
					:image="user.data?.user_image"
					size="md"
					class="size-5.5 shrink-0"
					:class="profileActive && 'ring-[1.5px] ring-current'"
				/>
				<span :class="labelClass(profileActive)">{{ __('Profile') }}</span>
			</button>
			<MobileAppTab app-id="mail" />
		</div>
	</nav>

	<MobileFolderSheet />
</template>

<script setup lang="ts">
import { computed, inject, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Avatar, Button } from 'frappe-ui'
import { Icon as FeatherIcon } from 'frappe-ui/experimental'
import { Icon } from 'frappe-ui/experimental'

import { getIcon, getMailboxName } from '@/apps/mail/utils'
import { useFolderSheet, useKeyboardOpen, useMobileSearch, useMobileSelection } from '@/apps/mail/utils/composables'
import { userStore } from '@/apps/mail/stores/user'
import { openComposePage } from '@/apps/mail/composables/composeHandoff'
import MobileFolderSheet from '@/apps/mail/components/mobile/MobileFolderSheet.vue'
import { useRootStore } from '@/stores/root'
import MobileAppTab from '@/components/mobile/MobileAppTab.vue'
import { iconClass, labelClass, tabClass } from '@/components/mobile/mobileClasses'

import type { MailboxData } from '@/apps/mail/types'

const route = useRoute()
const router = useRouter()
const store = userStore()
const root = useRootStore()
const user = inject('$user') as { data: Record<string, any> }
const { mailboxes, allInboxesUnread } = store
const { openFolderSheet } = useFolderSheet()
const { isSearchRoute } = useMobileSearch()
const { isMobileSelectionActive } = useMobileSelection()
const keyboardOpen = useKeyboardOpen()

const activeAccountName = computed(
	() => store.userResource?.data?.accounts?.find((a) => a.id === store.accountId)?._name ?? '',
)

// The folder currently shown by a mail route; null elsewhere (tab falls back to "Inbox").
// Search is not a folder: the virtual 'search' mailbox matches nothing here, so the tab
// reads "Inbox" on the results page, and a tap on it is the way back out of search.
const currentFolder = computed(() => {
	if (route.name === 'mail-all-inboxes') return { label: __('All Inboxes'), icon: 'mails' }
	if (route.name !== 'mail-mailbox') return null
	if (route.params.mailbox === 'starred') return { label: __('Starred'), icon: 'star' }
	const mailbox = mailboxes.data?.find((m: MailboxData) => m.id === route.params.mailbox)
	return mailbox ? { label: getMailboxName(mailbox), icon: getIcon(mailbox) } : null
})

// Compose is a route now, not an overlay, so the back gesture closes it and the composer owns a
// whole screen to lay itself out in rather than floating over this one.
const openCompose = () => openComposePage(router, store.accountId)

const MAIL_ROUTES = ['mail-mailbox', 'mail-all-inboxes']
const isThreadOpen = computed(() => !!route.params.threadID)
// Search results live on the mailbox route with the virtual 'search' mailbox, but
// search is the title header's, not a tab's — no tab reads as active there.
const mailActive = computed(
	() => MAIL_ROUTES.includes(route.name as string) && !isSearchRoute.value,
)
// Either screener route: with a sender open the tab is still the screener's.
const screenerActive = computed(() =>
	['mail-screener', 'mail-screener-sender'].includes(route.name as string),
)
const profileActive = computed(() => route.name === 'mail-profile')

watch(isSearchRoute, (active) => {
	if (!active) root.paletteOpen = false
})

const openMail = () => {
	// Re-tapping the active Mail tab opens the folder switcher.
	if (mailActive.value) {
		openFolderSheet()
		return
	}
	// From elsewhere the tab reads "Inbox" with the Inbox's unread dot, so the
	// tap must land there — restoring the last-viewed folder made a dotted tab
	// open Sent. (/mail redirects to the inbox.)
	router.push('/mail')
}

const openScreener = () => {
	if (screenerActive.value) return
	router.push({ name: 'mail-screener', params: { accountId: store.accountId } })
}

// Profile is a route now, not a sheet over the current surface — so it dismisses the
// search overlay on the way, like every other navigating tab. Re-tapping it pops back
// to the root of its own stack: the open settings sub-page is a query on this route,
// so dropping the query closes it.
const openProfile = () => {
	if (profileActive.value) {
		if (route.query.tab) router.replace({ query: {} })
		return
	}
	router.push({ name: 'mail-profile', params: { accountId: store.accountId } })
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

// The dot follows what the tab is showing: the current folder's unread while
// on a mail route (so Drafts with nothing unread shows no dot), the Inbox's
// unread when the tab reads "Inbox" from elsewhere. Starred is virtual — no count.
const mailUnreadCount = computed(() => {
	if (route.name === 'mail-all-inboxes') return allInboxesUnread.data ?? 0
	// In search the tab reads "Inbox" (above), so fall through to the Inbox's count.
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

// Raven-style unread dot (RailItemBadge dot recipe) shared by the Mail and
// Screener tabs: presence, not a count. Offset outward so it hangs off the
// icon's corner rather than sitting on the glyph strokes; bordered to read
// against the translucent bar.
const dotClass =
	'bg-surface-red-6 absolute -right-1 -top-1 block size-2 rounded-full border border-[var(--surface-base)]'
</script>
