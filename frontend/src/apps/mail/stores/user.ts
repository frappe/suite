import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { createResource } from 'frappe-ui'

import router from '@/apps/mail/router'
import { SCREENER_MAILBOX_NAME } from '@/apps/mail/constants'

import type { UserAccount, UserResource } from '@/apps/mail/types'

export type MailboxRole = 'inbox' | 'sent' | 'drafts' | 'trash' | 'junk' | 'archive' | 'important'

const ACCOUNT_STORAGE_KEY = 'mail-account-id'

export const userStore = defineStore('mail-user', () => {
	const accountId = ref('')

	const resolveAccount = (accounts?: UserAccount[], routeAccountId?: string) => {
		if (!accounts?.length) return

		// 1. Route param
		if (routeAccountId && accounts.some((a) => a.id === routeAccountId)) {
			if (routeAccountId !== accountId.value) setAccount(routeAccountId)
			return
		}

		// 2. localStorage
		const localId = localStorage.getItem(ACCOUNT_STORAGE_KEY)
		if (localId && accounts.some((a) => a.id === localId)) {
			if (localId !== accountId.value) setAccount(localId)
			return
		}

		// 3. Personal account fallback
		if (accountId.value) return
		const personalId = accounts.find((a) => a.is_personal)?.id
		if (personalId) setAccount(personalId)
	}

	const setAccount = (id: string) => {
		accountId.value = id
		localStorage.setItem(ACCOUNT_STORAGE_KEY, id)
		mailboxes.fetch()
		addressBooks.fetch()
		identities.fetch()
		screenedAddresses.fetch()
		sieveScripts.fetch()
	}

	const userResource: UserResource = createResource({
		url: 'suite.mail.api.account.get_user_info',
		onSuccess: (data) => {
			if (data?.is_mail_admin) domains.fetch()
			// The unified All Inboxes badge only applies when there's more than one account to merge.
			if ((data?.accounts?.length ?? 0) > 1) allInboxesUnread.fetch()
			resolveAccount(data?.accounts)
		},
		onError: (error) => {
			if (error && error.exc_type === 'AuthenticationError')
				router.push({ name: 'mail-login' })
		},
		auto: true,
	})

	// Total unread across every account's Inbox — drives the "All Inboxes" sidebar badge. Not scoped to
	// the active account, so (unlike the per-account resources) it isn't re-fetched in setAccount().
	const allInboxesUnread = createResource({ url: 'suite.mail.api.mail.get_all_inbox_unread_count' })

	// Keep the unified badge in step with the per-account mailbox counts: refresh it whenever the active
	// account's mailboxes reload — i.e. after any thread action (read, move, archive, trash, …) and on
	// the periodic poll, since every one of those calls mailboxes.reload(). Only relevant with >1 account.
	const reloadAllInboxesUnread = () => {
		if ((userResource.data?.accounts?.length ?? 0) > 1) allInboxesUnread.reload()
	}

	const mailboxes = createResource({
		url: 'suite.mail.api.mail.get_mailboxes',
		makeParams: () => ({ account: accountId.value }),
		cache: ['mailboxes', accountId.value],
		onSuccess: reloadAllInboxesUnread,
	})

	const mailboxIds = computed(() => {
		const ids: Record<MailboxRole | 'screener', string> = {
			inbox: '',
			sent: '',
			drafts: '',
			trash: '',
			junk: '',
			archive: '',
			important: '',
			screener: '',
		}
		mailboxes.data?.forEach((m: { role?: MailboxRole; _name?: string; id: string }) => {
			if (m.role) ids[m.role] = m.id
			else if (m._name === SCREENER_MAILBOX_NAME) ids.screener = m.id
		})
		return ids
	})

	const addressBooks = createResource({
		url: 'suite.mail.api.contacts.get_address_books',
		makeParams: () => ({ account: accountId.value }),
		cache: ['addressBooks', accountId.value],
	})

	const identities = createResource({
		url: 'suite.mail.api.account.get_identities',
		makeParams: () => ({ account: accountId.value }),
		cache: ['identities', accountId.value],
	})

	// Screened senders for the account: each is `{ email, action }` where action is 'Reject'
	// (discard incoming mail) or 'Spam' (file it into the Spam folder).
	const screenedAddresses = createResource({
		url: 'suite.mail.api.mail.get_screened_addresses',
		makeParams: () => ({ account: accountId.value }),
		cache: ['screenedAddresses', accountId.value],
	})

	const sieveScripts = createResource({
		url: 'suite.mail.api.sieve.get_sieve_scripts',
		makeParams: () => ({ account: accountId.value }),
		cache: ['sieveScripts', accountId.value],
	})

	const domains = createResource({ url: 'suite.mail.api.admin.get_enabled_domains' })

	// Clear all user/account state so the next sign-in starts from a clean slate. Without
	// resetting accountId, resolveAccount() would see the resolved account as unchanged and skip
	// setAccount(), so the per-account resources (mailboxes, etc.) would never re-fetch until a
	// full page reload.
	const reset = () => {
		accountId.value = ''
		userResource.reset()
		mailboxes.reset()
		addressBooks.reset()
		identities.reset()
		screenedAddresses.reset()
		sieveScripts.reset()
		domains.reset()
		allInboxesUnread.reset()
	}

	return {
		accountId,
		resolveAccount,
		userResource,
		mailboxes,
		mailboxIds,
		addressBooks,
		identities,
		domains,
		sieveScripts,
		screenedAddresses,
		allInboxesUnread,
		reset,
	}
})
