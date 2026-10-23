import { defineStore } from 'pinia'
import { reactive, ref, watch } from 'vue'

import { api, useQuery, type OutputOf } from '@/api'
import { useSession } from '@/platform/session'

type UserAccount = NonNullable<OutputOf<typeof api.mail.account.get>>['accounts'][number]

// Shared with Mail and Calendar, so People opens on the account last picked in any of them.
const ACCOUNT_STORAGE_KEY = 'mail-account-id'

export const userStore = defineStore('people-user', () => {
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

  const userQuery = useQuery(api.mail.account.get, () => (useSession().user.value ? {} : false))
  const userResource = reactive({
    get error() {
      return userQuery.error
    },
    // The accounts Mail lists: an address book belongs to a mail account, so one that only
    // shares a calendar has none.
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
        window.location.replace('/login?redirect-to=/people')
    },
  )

  const addressBooks = useQuery(api.mail.addressBooks.list, () =>
    accountId.value ? { account: accountId.value } : false,
  )

  return { accountId, resolveAccount, userResource, loadUser, addressBooks }
})
