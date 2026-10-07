import { defineStore } from 'pinia'
import { computed, reactive, ref, watch } from 'vue'

import { api, useQuery } from '@/api'
import { SCREENER_MAILBOX_NAME } from '@/apps/mail/constants'
import router from '@/apps/mail/router'
import type { UserAccount } from '@/apps/mail/types'
import { useSession } from '@/platform/session'

export type MailboxRole = 'inbox' | 'sent' | 'drafts' | 'trash' | 'junk' | 'archive' | 'important'

/** Destinations rather than places mail is read — the folder lists (desktop sidebar,
 * mobile folder sheet) render these in their own "More" section below the custom folders,
 * in this order. Typed wide (string) because mailbox data carries role as a string. */
export const SECONDARY_MAILBOX_ROLES: readonly string[] = [
  'junk',
  'archive',
  'trash',
] satisfies readonly MailboxRole[]

/** Role → mailbox id map for a mailbox list (plus the named Screener). Shared with
 * utils/accountScope, which derives the same map for a non-active account's list. */
export const deriveMailboxIds = (
  mailboxes?: { role?: MailboxRole | null; _name?: string; id: string }[],
): Record<MailboxRole | 'screener', string> => {
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
  mailboxes?.forEach((m) => {
    if (m.role) ids[m.role] = m.id
    else if (m._name === SCREENER_MAILBOX_NAME) ids.screener = m.id
  })
  return ids
}

const ACCOUNT_STORAGE_KEY = 'mail-account-id'

export const userStore = defineStore('mail-user', () => {
  const accountId = ref('')

  const resolveAccount = (accounts?: readonly UserAccount[], routeAccountId?: string) => {
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
  }

  const account = () => (accountId.value ? { account: accountId.value } : false)
  const userQuery = useQuery(api.mail.account.get, () => (useSession().user.value ? {} : false))
  const userResource = reactive({
    get status() {
      return userQuery.status
    },
    get isFetching() {
      return userQuery.isFetching
    },
    get error() {
      return userQuery.error
    },
    refetch: userQuery.refetch,
    cancel: userQuery.cancel,
    get data() {
      const data = userQuery.data
      return data ? { ...data, accounts: data.accounts.filter((account) => account.in_mail) } : data
    },
  })
  const loadUser = () => userQuery.refetch()
  watch(
    () => userResource.data?.accounts,
    (accounts) => resolveAccount(accounts),
    { flush: 'sync' },
  )
  watch(
    () => userQuery.error,
    (error) => {
      if (error && 'type' in error && error.type === 'AuthenticationError')
        void router.push({ name: 'mail-login' })
    },
  )

  // Every account's folders merged by slug, with their unread counts summed — the folder list of the
  // "All accounts" view. Only fetched when there's more than one account to merge, and not scoped to
  // the active account.
  const unifiedFolders = useQuery(api.mail.unified.folders, () =>
    (userResource.data?.accounts.length ?? 0) > 1 ? {} : false,
  )
  const mailboxes = useQuery(api.mail.mailboxes.list, account)
  const addressBooks = useQuery(api.mail.addressBooks.list, account)
  const identities = useQuery(api.mail.identities.list, account)
  const screenedAddresses = useQuery(api.mail.screening.list, account)
  const globalScreenedAddresses = useQuery(api.mail.screening.global, () =>
    useSession().user.value ? {} : false,
  )
  const sieveScripts = useQuery(api.mail.sieve.list, account)
  // Keep the unified counts in step with the per-account mailbox counts: refresh them whenever the
  // active account's mailboxes reload — after any thread action and on the periodic poll.
  watch(
    () => mailboxes.data,
    () => {
      if ((userResource.data?.accounts.length ?? 0) > 1)
        void unifiedFolders.refetch().catch(() => {})
    },
  )

  const mailboxIds = computed(() => deriveMailboxIds(mailboxes.data))

  // Short display labels for the merged views (All Inboxes, all-accounts search), keyed by the
  // account's full name. Only the odd ones out get labelled: the currently open account is
  // where the reader already is, so its rows stay bare ('' here — the row hides an empty
  // label) and ink scales with how much the reader actually needs it. The rest show the
  // address's local part — enough to tell the accounts apart in a fraction of the width —
  // falling back to the full address only when two accounts share a local part.
  const accountShortNames = computed<Record<string, string>>(() => {
    const accounts = userResource.data?.accounts ?? []
    const shortOf = (name: string) => name.split('@')[0] || name
    const counts: Record<string, number> = {}
    for (const account of accounts) {
      const short = shortOf(account._name ?? '')
      counts[short] = (counts[short] ?? 0) + 1
    }
    return Object.fromEntries(
      accounts.map((account) => {
        const name = account._name ?? ''
        if (account.id === accountId.value) return [name, '']
        return [name, counts[shortOf(name)] > 1 ? name : shortOf(name)]
      }),
    )
  })

  const reset = () => {
    accountId.value = ''
  }

  return {
    accountId,
    resolveAccount,
    userResource,
    loadUser,
    mailboxes,
    mailboxIds,
    accountShortNames,
    addressBooks,
    identities,
    sieveScripts,
    screenedAddresses,
    globalScreenedAddresses,
    unifiedFolders,
    reset,
  }
})
