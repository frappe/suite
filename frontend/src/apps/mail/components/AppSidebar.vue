<template>
	<div
		v-if="isMobile && isSidebarOpen"
		class="fixed inset-0 z-10 bg-black bg-opacity-50"
		@click="closeSidebar"
	/>

	<Transition>
		<!-- Composition mode (default slot): the app owns the body, so each
		     SidebarSection's collapse state can be bound (v-model:collapsed) — the
		     legacy `sections` config keeps that state internal. Owning it lets
		     More/People default to collapsed and persist their state. -->
		<Sidebar
			v-if="!isMobile || isSidebarOpen"
			id="sidebar"
			v-model:collapsed="isSidebarCollapsed"
			class="border-r border-outline-gray-1"
			:class="{ 'fixed left-0 top-0 z-10 w-60 !bg-surface-base': isMobile }"
			:disable-collapse="isMobile"
		>
			<!-- No padding around the header: its own inset centres the logo in the
			     collapsed rail, in line with the icons of the px-2 body below. -->
			<div class="flex h-full flex-col">
				<SidebarHeader
					:title="title"
					:subtitle="subtitle"
					:menu-items="menuItems"
					:logo="branding.data?.brand_html || MailLogo"
				/>

				<div class="flex-1 overflow-y-auto overflow-x-hidden px-2">
					<SidebarSection
						v-for="section in sidebarItems"
						:key="section.key ?? section.label"
						:label="section.label"
						:collapsible="section.collapsible"
						:collapsed="isSectionCollapsed(section)"
						@update:collapsed="(collapsed) => setSectionCollapsed(section.key, collapsed)"
					>
						<SidebarItem
							v-for="item in section.items"
							:key="item.label"
								:label="item.label"
								:icon="item.icon"
								:to="item.to"
								:class="
									threadDrag.overMailbox.value === item.mailboxId &&
									'ring-2 ring-outline-gray-3 ring-inset'
								"
								@dragover="onFolderDragOver($event, item)"
								@dragleave="onFolderDragLeave(item)"
								@drop="onFolderDrop($event, item)"
								:active="
									item.activeFor?.includes(
										['mail-mailbox', 'mail-mail'].includes(route.name as string)
											? route.params.mailbox
											: route.name,
									)
								"
								:on-click="item.onClick"
								class="group"
							>
								<template #suffix>
									<div class="flex items-center">
										<Dropdown v-if="item.menuOptions" :options="item.menuOptions">
											<Button variant="ghost" class="!bg-transparent" @click.stop>
												<template #icon>
													<Ellipsis
														class="text-ink-gray-6 invisible h-4 w-4 group-hover:visible"
													/>
												</template>
											</Button>
										</Dropdown>
										<span
											class="text-ink-gray-4 mr-2 text-sm"
											:class="{ 'group-hover:hidden': item.menuOptions }"
										>
											{{ item.suffix }}
										</span>
									</div>
								</template>
						</SidebarItem>
					</SidebarSection>
				</div>

				<div class="mt-auto p-2">
					<!-- Personal widgets (events, quota) are meaningless while administering the server. -->
					<UpcomingEvents
						v-if="user.data.is_jmap_configured && !route.meta.isDashboard"
						:is-collapsed="isSidebarCollapsed"
					/>
					<QuotaBar
						v-if="user.data.is_jmap_configured && !route.meta.isDashboard"
						:is-collapsed="isSidebarCollapsed"
					/>
					<SidebarCollapseToggle v-if="!isMobile" />
				</div>
			</div>
		</Sidebar>
	</Transition>

	<SettingsModal v-if="!isMobile" v-model="showSettings" />
	<!-- Mobile settings pushes in from the right like a thread: its back-chevron
	     header is push-navigation language (slide-up is reserved for summoned
	     tasks — compose/search). Teleported to body: inside the layout's isolate
	     stacking context the tab bar/FAB would paint over it. -->
	<Teleport v-else to="body">
		<Transition
			enter-active-class="transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]"
			enter-from-class="translate-x-full"
			leave-active-class="transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]"
			leave-to-class="translate-x-full"
		>
			<PWASettings v-if="showSettings" @close="showSettings = false" />
		</Transition>
	</Teleport>
	<FolderModal v-model="showFolderModal" :mailbox="selectedMailbox" />
	<DeleteFolderModal v-model="showDeleteMailbox" :mailbox="selectedMailbox" />
	<ShortcutsModal v-model="showShortcuts" />
</template>

<script setup lang="ts">
import { computed, h, inject, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useStorage } from '@vueuse/core'
import { Icon } from 'frappe-ui/experimental'
import { Keyboard, User } from 'lucide-vue-next'
import {
	Button,
	Dropdown,
	Sidebar,
	SidebarCollapseToggle,
	SidebarHeader,
	SidebarItem,
	SidebarSection,
} from 'frappe-ui'

import { accountSubmenu } from '@/composables/accountSubmenu'
import { useAppSwitcher } from '@/composables/useAppSwitcher'
import { FOLDER_ICON_COLOR_MAP } from '@/apps/mail/constants'
import { canMoveToMailbox, getIcon, getMailboxName, toTitleCase } from '@/apps/mail/utils'
import { useAccountSwitch, useScreenSize, useSettings, useSidebar } from '@/apps/mail/utils/composables'
import { useThreadDrag } from '@/apps/mail/composables/useThreadDrag'
import { sessionStore } from '@/apps/mail/stores/session'
import { SECONDARY_MAILBOX_ROLES, userStore } from '@/apps/mail/stores/user'
import MailLogo from '@/apps/mail/components/Icons/MailLogo.vue'
import DeleteFolderModal from '@/apps/mail/components/Modals/DeleteFolderModal.vue'
import FolderModal from '@/apps/mail/components/Modals/FolderModal.vue'
import SettingsModal from '@/apps/mail/components/Modals/SettingsModal.vue'
import ShortcutsModal from '@/apps/mail/components/Modals/ShortcutsModal.vue'
import PWASettings from '@/apps/mail/components/PWASettings.vue'
import QuotaBar from '@/apps/mail/components/QuotaBar.vue'
import UpcomingEvents from '@/apps/mail/components/UpcomingEvents.vue'

import type { MailboxData } from '@/apps/mail/types'

import ArrowLeft from '~icons/lucide/arrow-left'
import BookUser from '~icons/lucide/book-user'
import CalendarClock from '~icons/lucide/calendar-clock'
import ContactRound from '~icons/lucide/contact-round'
import Crown from '~icons/lucide/crown'
import Ellipsis from '~icons/lucide/ellipsis'
import Globe from '~icons/lucide/globe'
import House from '~icons/lucide/house'
import LogOut from '~icons/lucide/log-out'
import Mailbox from '~icons/lucide/mailbox'
import Mails from '~icons/lucide/mails'
import Megaphone from '~icons/lucide/megaphone'
import Plus from '~icons/lucide/plus'
import Settings from '~icons/lucide/settings'
import Star from '~icons/lucide/star'
import Trash2 from '~icons/lucide/trash-2'
import Users from '~icons/lucide/users'
import UsersRound from '~icons/lucide/users-round'

const route = useRoute()
const router = useRouter()
const { isMobile } = useScreenSize()
const { switchAccount } = useAccountSwitch()
const { isSidebarOpen, closeSidebar } = useSidebar()
const isSidebarCollapsed = useStorage('isSidebarCollapsed', false)

// Per-section open/closed state for collapsible sections, keyed by the section's
// stable `key` (labels are translated, so they can't be storage keys). More and
// People start collapsed for new users; every toggle is remembered.
const collapsedSections = useStorage<Record<string, boolean>>('mail-sidebar-collapsed-sections', {
	more: true,
	people: true,
})
const setSectionCollapsed = (key: string | undefined, collapsed: boolean) => {
	if (key) collapsedSections.value[key] = collapsed
}
const isSectionCollapsed = (section: { key?: string }) =>
	!!section.key && !!collapsedSections.value[section.key]
const { logout, branding } = sessionStore()
const store = userStore()
const { mailboxes, allInboxesUnread } = store

// ── Threads dropped onto a folder ─────────────────────────────────────────────────────────────────
// The rows are dragged in the view; the folders that take them are here. The move itself belongs to
// the view too — the sidebar only says which folder the cursor is over, and hands the drop back.
const threadDrag = useThreadDrag()

/**
 * Folders that can take a drop: exactly the ones the "Move to" menu offers, read from the same
 * predicate so the two lists cannot drift. That rules out the mailbox the thread is already in,
 * along with Sent, Drafts and the Screener; Junk and Trash stay in, since handleMoveThreads reads
 * those as "mark as spam" and "delete", which is what dropping there means. Sidebar entries that
 * are not real mailboxes — Starred, All Inboxes, Outbox — have no id and fall out on their own.
 */
const canDrop = (item: { mailboxId?: string }) =>
	threadDrag.isDragging.value &&
	!!mailboxes.data?.some((m: MailboxData) => m.id === item.mailboxId) &&
	canMoveToMailbox(item.mailboxId, route.params.mailbox as string, store.mailboxIds)

const onFolderDragOver = (e: DragEvent, item: { mailboxId?: string }) => {
	if (!canDrop(item)) return
	// Without preventDefault the browser refuses the drop and shows the "no" cursor.
	e.preventDefault()
	if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
	threadDrag.overMailbox.value = item.mailboxId!
}

const onFolderDragLeave = (item: { mailboxId?: string }) => {
	if (threadDrag.overMailbox.value === item.mailboxId) threadDrag.overMailbox.value = ''
}

const onFolderDrop = (e: DragEvent, item: { mailboxId?: string }) => {
	if (!canDrop(item)) return
	e.preventDefault()
	threadDrag.drop(item.mailboxId!)
}

const user = inject('$user')

const appsMenuOption = useAppSwitcher('mail')

const { showSettings } = useSettings()
const showFolderModal = ref(false)
const selectedMailbox = ref()
const showDeleteMailbox = ref(false)
const showShortcuts = ref(false)

const title = computed(() =>
	branding.data?.brand_name && branding.data?.brand_name != 'Frappe'
		? branding.data.brand_name
		: 'Mail',
)

const subtitle = computed(() => {
	const currentAccount = user.data.accounts.find((a) => a.id === store.accountId)
	if (!currentAccount || currentAccount.is_personal) return toTitleCase(user.data.full_name)
	return currentAccount._name
})

// Leave the dashboard for the active account's default mailbox (or the address
// books when no mailbox exists yet). Shared by the header menu item and the
// pinned "Back to Mail" sidebar item.
const goToMailbox = () => {
	const mailbox = mailboxes.data?.[0]?.id
	if (mailbox)
		router.push({
			name: 'mail-mailbox',
			params: { accountId: store.accountId, mailbox },
		})
	else
		router.push({
			name: 'mail-address-books',
			params: { accountId: store.accountId },
		})
}

const menuItems = computed(() => [
	{
		group: '',
		options: [
			{
				...appsMenuOption.value,
				condition: () => !isMobile.value,
			},
			{
				icon: Mailbox,
				label: __('Mailbox'),
				onClick: goToMailbox,
				condition: () =>
					user.data.is_suite_admin &&
					user.data.is_jmap_configured &&
					route.meta.isDashboard,
			},
			{
				icon: Crown,
				label: __('Admin Dashboard'),
				onClick: () => router.push('/mail/dashboard'),
				condition: () =>
					user.data.is_jmap_configured &&
					user.data.is_suite_admin &&
					!route.meta.isDashboard &&
					!isMobile.value,
			},
		],
	},
	{
		group: '',
		options: [
			{
				icon: Settings,
				label: __('Settings'),
				onClick: () => (showSettings.value = true),
			},
			{
				icon: Keyboard,
				label: __('Shortcuts'),
				onClick: () => (showShortcuts.value = true),
				condition: () => !isMobile.value,
			},
		],
	},
	{
		group: '',
		options: [
			{
				icon: User,
				label: __('Accounts'),
				submenu: accountSubmenu(user.data.accounts, store.accountId, switchAccount),
				condition: () => user.data.accounts?.length > 1 && !route.meta.isDashboard,
			},
			{
				icon: LogOut,
				label: __('Log Out'),
				onClick: logout.submit,
			},
		],
	},
])

const dashboardItems = [
	{
		label: __('Directory'),
		items: [
			{
				label: __('Accounts'),
				icon: Users,
				to: { name: 'mail-accounts' },
				activeFor: ['mail-accounts', 'mail-invites', 'mail-account'],
			},
			{
				label: __('Groups'),
				icon: UsersRound,
				to: { name: 'mail-groups' },
				activeFor: ['mail-groups', 'mail-group'],
			},
			{
				label: __('Mailing Lists'),
				icon: Megaphone,
				to: { name: 'mail-mailing-lists' },
				activeFor: ['mail-mailing-lists', 'mail-mailing-list'],
			},
		],
	},
	{
		label: __('Domains'),
		items: [
			{
				label: __('Domains'),
				icon: Globe,
				to: { name: 'mail-domains' },
				activeFor: ['mail-domains', 'mail-domain'],
			},
		],
	},
]

const mailboxItems = computed(
	() =>
		mailboxes.data
			?.filter((mailbox: MailboxData) => mailbox.subscribed)
			?.map((mailbox: MailboxData) => {
				// The Screening folder opens the dedicated Screener page, not the thread list.
				const isScreener = mailbox.id === store.mailboxIds.screener
				return {
					mailboxId: mailbox.id,
					label: getMailboxName(mailbox),
					icon: h(Icon, {
						name: getIcon(mailbox),
						class: FOLDER_ICON_COLOR_MAP[mailbox.color],
					}),
					to: isScreener
						? { name: 'mail-screener', params: { accountId: store.accountId } }
						: {
								name: 'mail-mailbox',
								params: { accountId: store.accountId, mailbox: mailbox.id },
							},
					suffix: mailbox.unread_threads ? String(mailbox.unread_threads) : '',
					activeFor: isScreener ? ['mail-screener', 'mail-screener-sender'] : [mailbox.id],
					menuOptions: isScreener
						? undefined
						: [
								{
									label: __('Configure'),
									icon: Settings,
									onClick: () => {
										selectedMailbox.value = mailbox
										showFolderModal.value = true
									},
								},
								{
									label: __('Delete'),
									theme: 'red',
									icon: Trash2,
									onClick: () => {
										selectedMailbox.value = mailbox
										showDeleteMailbox.value = true
									},
								},
							],
				}
			}) || [],
)

const screeningEnabled = computed(
	() =>
		!!store.userResource?.data?.accounts?.find((a) => a.id === store.accountId)
			?.enable_screening,
)

const sidebarItems = computed(() => {
	if (route.meta.isDashboard) {
		// A pinned, unlabelled group at the top of the nav: the exit back to the
		// inbox (previously buried in the header dropdown) and the Overview home.
		// Admins without a JMAP account (e.g. System Managers) have no inbox to
		// go back to, so the exit is omitted for them.
		const pinned = [
			...(user.data?.is_jmap_configured
				? [
						{
							label: __('Back to Mail'),
							icon: ArrowLeft,
							onClick: goToMailbox,
						},
					]
				: []),
			{
				label: __('Overview'),
				icon: House,
				to: { name: 'mail-overview' },
				activeFor: ['mail-overview'],
			},
		]
		return [{ label: '', items: pinned }, ...dashboardItems]
	}

	// Screening is a roleless folder; it gets its own nameless group pinned to the top of the
	// sidebar, separate from the default and custom mailboxes.
	const isScreening = (item: { mailboxId?: string }) =>
		!!store.mailboxIds.screener && item.mailboxId === store.mailboxIds.screener

	const screenerItem = mailboxItems.value.find((item) => isScreening(item))

	const roleOf = (item: { mailboxId?: string }) =>
		mailboxes.data?.find((m) => m.id === item.mailboxId)?.role

	const defaultMailboxes = mailboxItems.value.filter((item) => {
		const role = roleOf(item)
		return role && !SECONDARY_MAILBOX_ROLES.includes(role)
	})
	const starredItem = {
		label: __('Starred'),
		icon: Star,
		to: { name: 'mail-mailbox', params: { accountId: store.accountId, mailbox: 'starred' } },
		activeFor: ['starred'],
	}
	// Synthetic like Starred, but backed by the server's held (FUTURERELEASE)
	// EmailSubmissions rather than a mailbox, so it opens a dedicated page.
	const outboxItem = {
		label: __('Outbox'),
		icon: CalendarClock,
		to: { name: 'mail-outbox', params: { accountId: store.accountId } },
		activeFor: ['mail-outbox', 'mail-submission'],
	}
	const defaultItems = [...defaultMailboxes, starredItem, outboxItem]

	const secondaryItems = mailboxItems.value
		.filter((item) => {
			const role = roleOf(item)
			return role && SECONDARY_MAILBOX_ROLES.includes(role)
		})
		.sort(
			(a, b) =>
				SECONDARY_MAILBOX_ROLES.indexOf(roleOf(a)!) - SECONDARY_MAILBOX_ROLES.indexOf(roleOf(b)!),
		)

	const customMailboxes = mailboxItems.value.filter(
		(item) => !roleOf(item) && !isScreening(item),
	)
	const addMailboxItem = {
		label: __('New Folder'),
		icon: Plus,
		onClick: () => {
			selectedMailbox.value = undefined
			showFolderModal.value = true
		},
	}
	const customItems = [...customMailboxes, addMailboxItem]

	const contactsItems = [
		{
			label: __('Address Books'),
			icon: BookUser,
			to: { name: 'mail-address-books', params: { accountId: store.accountId } },
			activeFor: ['mail-address-books', 'mail-address-book'],
		},
		{
			label: __('Contacts'),
			icon: ContactRound,
			to: { name: 'mail-contacts', params: { accountId: store.accountId } },
			activeFor: ['mail-contacts', 'mail-contact'],
		},
	]

	const groups = [
		{ label: __('Default'), items: defaultItems },
		{ label: __('Custom'), items: customItems },
		...(secondaryItems.length
			? [{ label: __('More'), key: 'more', items: secondaryItems, collapsible: true }]
			: []),
		{ label: __('People'), key: 'people', items: contactsItems, collapsible: true },
	]

	// All Inboxes and Screener share one nameless group pinned above the folders, so they sit at
	// item spacing (not the wider section gap two separate groups would create). All Inboxes first
	// (broadest scope: all accounts), then Screener (active account). Each is conditional:
	// All Inboxes only with more than one account, Screener only when screening is enabled.
	const pinnedItems = []
	if (user.data.accounts?.length > 1)
		pinnedItems.push({
			label: __('All Inboxes'),
			icon: Mails,
			to: { name: 'mail-all-inboxes' },
			// A thread opened from the merged list is its own route (it carries the
			// thread's real account/mailbox params) but still belongs to this item.
			activeFor: ['mail-all-inboxes', 'mail-all-inboxes-mail'],
			suffix: allInboxesUnread.data ? String(allInboxesUnread.data) : '',
		})
	if (screenerItem && screeningEnabled.value) pinnedItems.push(screenerItem)

	if (pinnedItems.length) groups.unshift({ label: '', items: pinnedItems })

	return groups
})

// Shortcuts

const handleKeyDown = (event: KeyboardEvent) => {
	if (event.metaKey || event.ctrlKey) {
		if (event.key === ';') {
			event.preventDefault()
			isSidebarCollapsed.value = !isSidebarCollapsed.value
			return
		}
	}
}

onMounted(() => window.addEventListener('keydown', handleKeyDown))
onUnmounted(() => window.removeEventListener('keydown', handleKeyDown))
</script>

<style scoped>
.v-enter-from,
.v-leave-to {
	@apply -translate-x-full opacity-0;
}

.v-enter-to,
.v-leave-from {
	@apply translate-x-0 opacity-100;
}
</style>
