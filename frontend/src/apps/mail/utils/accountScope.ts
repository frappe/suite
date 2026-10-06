import { computed, inject, provide, type ComputedRef, type InjectionKey } from 'vue'

import { api, useQuery } from '@/api'
import { deriveMailboxIds, userStore, type MailboxRole } from '@/apps/mail/stores/user'
import type { UserAccount } from '@/apps/mail/types'
import type { QueryState } from '@/platform/server-state'

import type {
  GetIdentitiesOutput,
  GetMailboxesOutput,
  GetScreenedAddressesOutput,
} from '../client/generated'

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
  mailboxes: ComputedRef<QueryState<GetMailboxesOutput>>
  mailboxIds: ComputedRef<Record<MailboxRole | 'screener', string>>
  identities: ComputedRef<QueryState<GetIdentitiesOutput>>
  screenedAddresses: ComputedRef<QueryState<GetScreenedAddressesOutput>>
}

export const useAccountScope = (owner?: () => string | undefined): AccountScope => {
  const store = userStore()
  const accountId = computed(() => owner?.() || store.accountId)
  const account = () => (accountId.value ? { account: accountId.value } : false)
  const mailboxes = useQuery(api.mail.mailboxes.list, account)
  const identities = useQuery(api.mail.identities.list, account)
  const screenedAddresses = useQuery(api.mail.screening.list, account)
  return {
    accountId,
    account: computed(() =>
      store.userResource?.data?.accounts?.find((a) => a.id === accountId.value),
    ),
    mailboxes: computed(() => mailboxes),
    identities: computed(() => identities),
    screenedAddresses: computed(() => screenedAddresses),
    mailboxIds: computed(() => deriveMailboxIds(mailboxes.data)),
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
