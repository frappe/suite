<template>
	<Button
		v-for="action in primaryActions(mail).filter((d) => d.condition !== false && !isCollapsed)"
		:key="action.label"
		variant="ghost"
		:tooltip="action.label"
		@click.stop="action.onClick"
	>
		<template #icon>
			<component :is="action.icon" class="text-ink-gray-5 icon" />
		</template>
	</Button>

	<!-- .stop lives on the wrapper: AdaptiveDropdown's mobile trigger opens via
	     the click bubbling to its own span, so stopping on the Button itself
	     would keep the sheet from opening. -->
	<div v-if="!mail.draft && !isCollapsed" class="flex" @click.stop>
		<AdaptiveDropdown :options="moreActions(mail)">
			<Button variant="ghost" :tooltip="__('More')">
				<template #icon>
					<Ellipsis class="text-ink-gray-5 icon" />
				</template>
			</Button>
		</AdaptiveDropdown>
	</div>
</template>

<script lang="ts" setup>
import { h, inject } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
	Ban,
	CircleAlert,
	CircleCheck,
	Code,
	Download,
	Ellipsis,
	ExternalLink,
	Forward,
	ListFilter,
	LockOpen,
	Mail as MailIcon,
	Reply,
	ReplyAll,
	ShieldCheck,
	SquarePen,
	Star,
	Trash2,
} from 'lucide-vue-next'
import { Button, createResource } from 'frappe-ui'

import { FLAGGED_STAR_STYLE } from '@/apps/mail/constants'
import AdaptiveDropdown from '@/apps/mail/components/AdaptiveDropdown.vue'

import {
	downloadUrlAsFile,
	matchesScreenedValue,
	raiseOptimisticToast,
	raiseToast,
} from '@/apps/mail/utils'
import { useFilterBySender, useScreenSize, useUndo } from '@/apps/mail/utils/composables'
import { injectAccountScope } from '@/apps/mail/utils/accountScope'

import type { ComposeMailData, Identity, Mail, ScreenedAddress } from '@/apps/mail/types'

const {
	mailbox,
	mail,
	draftMail,
	isCollapsed,
	showReplyAll,
	popOutDraft,
	reply,
	replyAll,
	forward,
	reloadMails,
	thread,
} = defineProps<{
	mailbox: string
	mail: Mail
	draftMail?: ComposeMailData
	isCollapsed: boolean
	showReplyAll: boolean
	popOutDraft: (mail: ComposeMailData) => void
	reply: (mail: Mail) => void
	replyAll: (mail: Mail) => void
	forward: (mail: Mail) => void
	reloadMails: (isUndo?: boolean) => void
	thread: Mail[]
}>()

const emit = defineEmits(['setFlagged', 'syncUnseen', 'moveMail', 'markMailSpam', 'deleteMail'])

const { isMobile } = useScreenSize()
const route = useRoute()
const router = useRouter()
// Everything account-scoped resolves through the enclosing pane's scope — the
// thread's owning account in All Inboxes, the active account otherwise. The
// computed refs read live, so makeParams always sees the pane's current account.
const { accountId: scopeAccountId, mailboxIds, identities, screenedAddresses } =
	injectAccountScope()
const { setUndoAction, undo } = useUndo()
const { filterBySender } = useFilterBySender()
const user = inject('$user')

// A sender is "blocked" when screened with the Reject action (their mail is discarded) — either by their
// exact address or by a '@domain' entry covering them.
const isSenderBlocked = (email: string) =>
	screenedAddresses.value.data?.some(
		(a: ScreenedAddress) => a.action === 'Reject' && matchesScreenedValue(email, a.email),
	)

const primaryActions = (mail: Mail): MailAction[] => [
	{
		label: __('Unstar'),
		onClick: () => emit('setFlagged', mail.id, false),
		icon: () => h(Star, { style: FLAGGED_STAR_STYLE }),
		condition: !!mail.flagged && mailbox !== mailboxIds.value.trash && !isMobile.value,
	},
	{
		label: __('Star'),
		onClick: () => emit('setFlagged', mail.id, true),
		icon: Star,
		condition: !mail.flagged && !mail.draft && mailbox !== mailboxIds.value.trash && !isMobile.value,
	},
	{
		label: __('Edit Draft'),
		onClick: () => popOutDraft(draftMail!),
		icon: SquarePen,
		condition: !!mail.draft && isMobile.value,
	},
	{
		label: showReplyAll ? __('Reply All') : __('Reply'),
		onClick: () => (showReplyAll ? replyAll(mail) : reply(mail)),
		icon: showReplyAll ? ReplyAll : Reply,
		condition: !mail.draft && !isMobile.value,
	},
]

interface MailAction {
	label: string
	onClick: () => void
	icon: typeof SquarePen
	condition?: boolean | (() => boolean)
}

interface GroupedAction {
	group: string
	items: MailAction[]
}

const moreActions = (mail: Mail): GroupedAction[] => [
	{
		group: '',
		items: [
			{
				label: __('Reply'),
				onClick: () => setTimeout(() => reply(mail), 300),
				icon: Reply,
				condition: () => !mail.draft,
			},
			{
				label: __('Reply All'),
				onClick: () => setTimeout(() => replyAll(mail), 300),
				icon: ReplyAll,
				condition: () => showReplyAll,
			},
			{
				label: __('Forward'),
				onClick: () => setTimeout(() => forward(mail), 300),
				icon: Forward,
				condition: () => !mail.draft,
			},
		],
	},
	{
		group: '',
		items: [
			{
				label: __('Unstar'),
				onClick: () => emit('setFlagged', mail.id, false),
				icon: () => h(Star, { style: FLAGGED_STAR_STYLE }),
				condition: () => !!mail.flagged && mailbox !== mailboxIds.value.trash,
			},
			{
				label: __('Star'),
				onClick: () => emit('setFlagged', mail.id, true),
				icon: Star,
				condition: () => !mail.flagged && !mail.draft && mailbox !== mailboxIds.value.trash,
			},
			{
				label: __('Mark as Junk'),
				onClick: () => emit('markMailSpam', mail, true),
				icon: CircleAlert,
				condition: () => mailbox !== mailboxIds.value.drafts && mail.junk === 0,
			},
			{
				label: __('Mark as Not Junk'),
				onClick: () => emit('markMailSpam', mail, false),
				icon: CircleCheck,
				condition: () => mail.junk === 1,
			},
			{
				label: __('Move to Trash'),
				onClick: () => emit('moveMail', mail, mailboxIds.value.trash),
				icon: Trash2,
				condition: () => mailbox !== mailboxIds.value.trash,
			},
			{
				label: __('Delete Message'),
				onClick: () => emit('deleteMail', mail),
				icon: Trash2,
				condition: () => mailbox === mailboxIds.value.trash,
			},
			{
				label: thread.length === 1 ? __('Mark as Unread') : __('Mark Unread from Here'),
				onClick: () => handleMarkUnreadFromHere(),
				icon: MailIcon,
				condition: () => !mail.draft,
			},
			{
				label: __("Filter Sender's Messages"),
				onClick: () => filterBySender(mail.from_email),
				icon: ListFilter,
				condition: () => !mail.draft && !!mail.from_email,
			},
			{
				label: __('Block Sender'),
				onClick: () => handleBlockAddress(true),
				icon: Ban,
				condition: () =>
					mailbox !== mailboxIds.value.screener &&
					!identities.value.data.some((i: Identity) => i.email === mail.from_email) &&
					!isSenderBlocked(mail.from_email),
			},
			{
				label: __('Unblock Sender'),
				onClick: () => handleBlockAddress(false),
				icon: LockOpen,
				condition: () =>
					mailbox !== mailboxIds.value.screener && isSenderBlocked(mail.from_email),
			},
			{
				label: __('Mark Domain as Trusted'),
				onClick: () => trustDomain.submit(),
				icon: ShieldCheck,
				condition: () =>
					mailbox !== mailboxIds.value.screener &&
					!mail.draft &&
					!!mail.from_email &&
					!isDomainTrusted(mail.from_email),
			},
		],
	},
	{
		group: '',
		items: [
			{
				label: __('Download Email'),
				onClick: () => downloadEmail.submit(),
				icon: Download,
				condition: () => !mail.draft,
			},
			{
				label: __('See MIME Message'),
				onClick: () => window.open(`/mail/mime-message/${mail.name}`, '_blank')?.focus(),
				icon: Code,
				condition: () => !mail.draft,
			},
			{
				label: __('View in Desk'),
				onClick: () => window.open(`/app/mail-message/${mail.name}`, '_blank')?.focus(),
				icon: ExternalLink,
				condition: () => user.data.is_system_manager,
			},
		],
	},
]

const downloadEmail = createResource({
	url: 'suite.mail.api.mail.fetch_mail_as_eml',
	makeParams: () => ({ name: mail.name }),
	onSuccess: (content: string) => {
		const byteArray = new Uint8Array(content)
		const blob = new Blob([byteArray], { type: 'message/rfc822' })
		const url = URL.createObjectURL(blob)
		downloadUrlAsFile(url, `${mail.subject || mail.name}.eml`)
	},
	onError: (error) => raiseToast(error.message, 'error'),
})

const moveMail = createResource({
	url: 'suite.mail.api.mail.move_mails',
	makeParams: (mailbox: string) => ({
		account: scopeAccountId.value,
		ids: [mail.id],
		mailbox,
		clear_junk: mail.junk === 1 && mailbox !== mailboxIds.value.junk,
	}),
})

const setMailsSeen = createResource({
	url: 'suite.mail.api.mail.set_mails_seen',
	makeParams: ({ ids }: { ids: string[] }) => ({ account: scopeAccountId.value, ids, seen: false }),
	onSuccess: (ids: string[]) => {
		raiseToast(__('{0} marked as unread.', [ids.length === 1 ? __('Mail') : __('Mails')]))
		// Leaving the thread is the point — staying would mark it read again. Return to whichever
		// list we came from: hardcoding the mailbox route threw All Inboxes out of the merged view
		// and into the owning account's mailbox, which read as the page reloading.
		router.push(
			route.name === 'mail-all-inboxes-mail'
				? { name: 'mail-all-inboxes', query: route.query }
				: {
						name: 'mail-mailbox',
						params: { accountId: route.params.accountId, mailbox },
						query: route.query,
					},
		)
		emit('syncUnseen', ids)
	},
})

const handleMarkUnreadFromHere = () => {
	const idx = thread.indexOf(mail)
	if (idx === -1) return
	const ids = thread
		.slice(idx)
		.filter((m: Mail) => !m.draft)
		.map((m: Mail) => m.id)
	if (ids.length) setMailsSeen.submit({ ids })
}

// The sender's domain as a screened value ('@example.com'). "Trusted" = an
// Accepted '@domain' entry — the same state that lets remote images load.
const senderDomain = (email: string) => `@${(email ?? '').trim().toLowerCase().split('@').pop()}`
const isDomainTrusted = (email: string) =>
	!!screenedAddresses.value.data?.some(
		(a: ScreenedAddress) =>
			a.action === 'Accepted' && a.email.trim().toLowerCase() === senderDomain(email),
	)

const trustDomain = createResource({
	url: 'suite.mail.api.mail.screen_email_addresses',
	makeParams: () => ({
		account: scopeAccountId.value,
		emails: [senderDomain(mail.from_email)],
		action: 'Accepted',
	}),
	onSuccess: () => {
		raiseToast(__('Domain marked as trusted.'))
		screenedAddresses.value.reload()
	},
	onError: (error) => raiseToast(error.message, 'error'),
})

const blockEmailAddress = createResource({
	url: 'suite.mail.api.mail.screen_email_address',
	makeParams: () => ({ account: scopeAccountId.value, email: mail.from_email, action: 'Reject' }),
})

const unblockEmailAddress = createResource({
	url: 'suite.mail.api.mail.unscreen_email_addresses',
	makeParams: () => ({ account: scopeAccountId.value, emails: [mail.from_email] }),
})

// Optimistically reflect the sender's blocked state so the immediate toast isn't lying, mirroring the
// backend exactly: blocking adds an exact-address 'Reject' entry (overriding any existing rule for the
// sender); unblocking removes the exact-address entry — a '@domain' rule that also covers the sender is
// left in place, just as the unscreen API leaves it. Returns a revert to restore the list on failure.
const applyScreenOptimistic = (block: boolean) => {
	const prev = screenedAddresses.value.data
	if (!prev) return () => {}
	const isExact = (a: ScreenedAddress) =>
		!a.email.startsWith('@') && matchesScreenedValue(mail.from_email, a.email)
	const kept = prev.filter((a: ScreenedAddress) => !isExact(a))
	const blocked: ScreenedAddress = { email: mail.from_email, action: 'Reject', creation: '', modified: '' }
	screenedAddresses.value.data = block ? [...kept, blocked] : kept
	return () => (screenedAddresses.value.data = prev)
}

const handleBlockAddress = (block: boolean, isUndo = false) => {
	const revert = applyScreenOptimistic(block) // optimistic: the menu item flips before the request
	const forward = (async () => {
		try {
			await (block ? blockEmailAddress : unblockEmailAddress).submit()
		} catch (error) {
			revert()
			throw error
		}
		screenedAddresses.value.reload()
	})()
	const successMessage = block ? __('Sender blocked.') : __('Sender unblocked.')

	if (isUndo) return raiseOptimisticToast(forward, successMessage)

	setUndoAction(() => handleBlockAddress(!block, true))
	raiseOptimisticToast(forward, successMessage, undo)
}
</script>
