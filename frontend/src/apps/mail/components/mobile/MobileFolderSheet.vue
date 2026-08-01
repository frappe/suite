<template>
	<BottomSheet v-model:open="isFolderSheetOpen" :title="__('Folders')">
		<!-- BottomSheet provides the scroll container (h-[70vh] overflow-y-auto); this
		     div only pads the content, including the home-indicator safe area. -->
		<div class="px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
			<button
				v-if="showAllInboxes"
				:class="rowClass(allInboxesActive)"
				@click="go({ name: 'mail-all-inboxes' })"
			>
				<Mails class="text-ink-gray-6 h-[18px] w-[18px] shrink-0" />
				<span class="flex-1 truncate text-left">{{ __('All Inboxes') }}</span>
				<span v-if="allInboxesUnread.data" class="text-ink-gray-5 text-sm">
					{{ allInboxesUnread.data }}
				</span>
			</button>

			<template v-for="group in groups" :key="group.label">
				<div class="text-ink-gray-5 px-3 pb-1 pt-3 text-sm">{{ group.label }}</div>
				<button
					v-for="folder in group.rows"
					:key="folder.id"
					:class="rowClass(folder.active)"
					@click="go(folder.to)"
				>
					<Icon
						:name="folder.icon"
						class="h-[18px] w-[18px] shrink-0"
						:class="folder.iconColor || 'text-ink-gray-6'"
					/>
					<span class="flex-1 truncate text-left">{{ folder.label }}</span>
					<span v-if="folder.count" class="text-ink-gray-5 text-sm">{{ folder.count }}</span>
				</button>
				<!-- Folder creation lives here now that the mobile drawer is gone. -->
				<button v-if="group.isCustom" :class="rowClass(false)" @click="createFolder">
					<Plus class="text-ink-gray-6 h-[18px] w-[18px] shrink-0" />
					<span class="flex-1 truncate text-left">{{ __('New Folder') }}</span>
				</button>
			</template>
		</div>
	</BottomSheet>
	<FolderModal v-model="showFolderModal" :mailbox="undefined" />
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter, type RouteLocationRaw } from 'vue-router'
import { Mails, Plus } from 'lucide-vue-next'
import { BottomSheet } from 'frappe-ui'
import { Icon } from 'frappe-ui/icons'

import FolderModal from '@/apps/mail/components/Modals/FolderModal.vue'

import { FOLDER_ICON_COLOR_MAP } from '@/apps/mail/constants'
import { getIcon, getMailboxName } from '@/apps/mail/utils'
import { useFolderSheet } from '@/apps/mail/utils/composables'
import { SECONDARY_MAILBOX_ROLES, userStore } from '@/apps/mail/stores/user'

import type { MailboxData } from '@/apps/mail/types'

const route = useRoute()
const router = useRouter()
const store = userStore()
const { mailboxes, allInboxesUnread } = store
const { isFolderSheetOpen, closeFolderSheet } = useFolderSheet()

const showAllInboxes = computed(
	() => (store.userResource?.data?.accounts?.length ?? 0) > 1,
)
const allInboxesActive = computed(() => route.name === 'mail-all-inboxes')

// Same source, split, and ordering as the desktop sidebar: role folders (+ the
// virtual Starred mailbox) under Default, roleless ones under Custom. The
// Screener is excluded because it has its own tab in the bar.
const groups = computed(() => {
	const toRow = (mailbox: MailboxData) => ({
		id: mailbox.id,
		label: getMailboxName(mailbox),
		icon: getIcon(mailbox),
		iconColor: FOLDER_ICON_COLOR_MAP[mailbox.color],
		count: mailbox.unread_threads || 0,
		active: route.params.mailbox === mailbox.id,
		to: {
			name: 'mail-mailbox',
			params: { accountId: store.accountId, mailbox: mailbox.id },
		} as RouteLocationRaw,
	})

	const items =
		mailboxes.data?.filter(
			(mailbox: MailboxData) =>
				mailbox.subscribed && mailbox.id !== store.mailboxIds.screener,
		) ?? []

	const starredRow = {
		id: 'starred',
		label: __('Starred'),
		icon: 'star',
		iconColor: '',
		count: 0,
		active: route.params.mailbox === 'starred',
		to: {
			name: 'mail-mailbox',
			params: { accountId: store.accountId, mailbox: 'starred' },
		} as RouteLocationRaw,
	}

	const isSecondary = (m: MailboxData) => !!m.role && SECONDARY_MAILBOX_ROLES.includes(m.role)

	return [
		{
			label: __('Default'),
			isCustom: false,
			rows: [
				...items.filter((m: MailboxData) => m.role && !isSecondary(m)).map(toRow),
				starredRow,
			],
		},
		{
			// Always rendered (even with no custom folders yet): it hosts New Folder.
			label: __('Custom'),
			isCustom: true,
			rows: items.filter((m: MailboxData) => !m.role).map(toRow),
		},
		{
			// Junk/Archive/Trash sit in their own section below Custom, as in the desktop sidebar.
			label: __('More'),
			isCustom: false,
			rows: items
				.filter(isSecondary)
				.sort(
					(a: MailboxData, b: MailboxData) =>
						SECONDARY_MAILBOX_ROLES.indexOf(a.role!) - SECONDARY_MAILBOX_ROLES.indexOf(b.role!),
				)
				.map(toRow),
		},
	].filter((group) => group.isCustom || group.rows.length)
})

const showFolderModal = ref(false)

const createFolder = () => {
	closeFolderSheet()
	showFolderModal.value = true
}

const go = (to: RouteLocationRaw) => {
	closeFolderSheet()
	router.push(to)
}

const rowClass = (active: boolean) =>
	[
		'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-base text-ink-gray-8',
		active ? 'bg-surface-gray-2 !font-semibold' : 'active:bg-surface-gray-1',
	].join(' ')
</script>
