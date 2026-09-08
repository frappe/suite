import { computed, inject, provide, type ComputedRef, type InjectionKey } from 'vue'
import { createResource } from 'frappe-ui'

import { deriveMailboxIds, userStore, type MailboxRole } from '@/apps/mail/stores/user'

import type { UserAccount } from '@/apps/mail/types'

/**
 * The account a thread pane acts as. The merged All Inboxes view opens threads from
 * any account without switching the active one — switching flipped the whole sidebar,
 * refetched five per-account resources and stranded the reader in another account —
 * so everything account-scoped inside the pane resolves through this scope instead:
 * mailbox ids for the folder menus, identities for reply addresses, screened senders
 * for the blocked/trusted banners.
 *
 * A pane on the active account reuses the store's live resources. Other accounts get
 * their own instances, fetched on first use and kept for the session — folder menus
 * and identities don't need the poll-fresh counts the active list does.
 */
interface AccountScope {
	accountId: ComputedRef<string>
	/** The account's record off the user resource (default_outgoing_email, block_remote_images, …). */
	account: ComputedRef<UserAccount | undefined>
	mailboxes: ComputedRef<ReturnType<typeof createResource>>
	mailboxIds: ComputedRef<Record<MailboxRole | 'screener', string>>
	identities: ComputedRef<ReturnType<typeof createResource>>
	screenedAddresses: ComputedRef<ReturnType<typeof createResource>>
}

const scopedResources = new Map<
	string,
	Record<'mailboxes' | 'identities' | 'screenedAddresses', ReturnType<typeof createResource>>
>()

const resourcesFor = (account: string) => {
	if (!scopedResources.has(account)) {
		scopedResources.set(account, {
			mailboxes: createResource({
				url: 'suite.mail.api.mail.get_mailboxes',
				params: { account },
				cache: ['mailboxes', account],
				auto: true,
			}),
			identities: createResource({
				url: 'suite.mail.api.account.get_identities',
				params: { account },
				cache: ['identities', account],
				auto: true,
			}),
			screenedAddresses: createResource({
				url: 'suite.mail.api.mail.get_screened_addresses',
				params: { account },
				cache: ['screenedAddresses', account],
				auto: true,
			}),
		})
	}
	return scopedResources.get(account)!
}

export const useAccountScope = (owner?: () => string | undefined): AccountScope => {
	const store = userStore()
	const accountId = computed(() => owner?.() || store.accountId)
	const scoped = computed(() =>
		accountId.value && accountId.value !== store.accountId
			? resourcesFor(accountId.value)
			: null,
	)
	return {
		accountId,
		account: computed(() =>
			store.userResource?.data?.accounts?.find((a: UserAccount) => a.id === accountId.value),
		),
		mailboxes: computed(() => scoped.value?.mailboxes ?? store.mailboxes),
		identities: computed(() => scoped.value?.identities ?? store.identities),
		screenedAddresses: computed(() => scoped.value?.screenedAddresses ?? store.screenedAddresses),
		mailboxIds: computed(() =>
			scoped.value ? deriveMailboxIds(scoped.value.mailboxes.data) : store.mailboxIds,
		),
	}
}

const ACCOUNT_SCOPE: InjectionKey<AccountScope> = Symbol('mail-account-scope')

/** Called by the pane root (MailThread); everything below it resolves this scope. */
export const provideAccountScope = (owner: () => string | undefined): AccountScope => {
	const scope = useAccountScope(owner)
	provide(ACCOUNT_SCOPE, scope)
	return scope
}

/** The enclosing pane's scope, or the active account for components outside one. */
export const injectAccountScope = (): AccountScope =>
	inject(ACCOUNT_SCOPE, () => useAccountScope(), true)
