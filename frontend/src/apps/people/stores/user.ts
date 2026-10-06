import { createResource } from 'frappe-ui'
import { defineStore } from 'pinia'
import { ref } from 'vue'

interface UserAccount {
  id: string
  _name: string
  is_personal?: boolean | 0 | 1
  in_mail?: boolean
}

// Shared with Mail and Calendar, so People opens on the account last picked in any of them.
const ACCOUNT_STORAGE_KEY = 'mail-account-id'

export const userStore = defineStore('people-user', () => {
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
    addressBooks.fetch()
  }

  const userResource = createResource({
    url: 'suite.mail.api.account.get_user_info',
    // The accounts Mail lists: an address book belongs to a mail account, so one that only
    // shares a calendar has none. In place, so onSuccess — handed the response rather than
    // this — reads the same list.
    transform: (data) => {
      if (data?.accounts)
        data.accounts = data.accounts.filter((account: UserAccount) => account.in_mail)
      return data
    },
    onSuccess: (data) => resolveAccount(data?.accounts),
    onError: (error) => {
      if (error && error.exc_type === 'AuthenticationError')
        window.location.replace('/login?redirect-to=/people')
    },
    auto: true,
  })

  const addressBooks = createResource({
    url: 'suite.mail.api.contacts.get_address_books',
    makeParams: () => ({ account: accountId.value }),
    cache: ['addressBooks', accountId.value],
  })

  return { accountId, resolveAccount, userResource, addressBooks }
})
