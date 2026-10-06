import type { RouteLocationNormalized } from 'vue-router'

import { userStore } from '@/apps/people/stores/user'

/**
 * People-local guard on the shared suite router: user-data wait, account
 * resolution and shortcut-route expansion. Auth itself is the suite router's
 * `beforeEach`.
 */
type Params = Record<string, string | string[]>

const resolveShortcut = (
  name: string | symbol | null | undefined,
  params: Params,
  accountId: string,
) => {
  switch (name) {
    case 'people-address-books-shortcut':
      if (params.addressBookName)
        return { name: 'people-address-book', params: { accountId, ...params } }
      return { name: 'people-address-books', params: { accountId } }
    case 'people-contacts-shortcut':
      if (params.contactName) return { name: 'people-contact', params: { accountId, ...params } }
      return { name: 'people-contacts', params: { accountId } }
    default:
      return { name: 'people-contacts', params: { accountId } }
  }
}

export const peopleGuard = async (to: RouteLocationNormalized) => {
  const store = userStore()
  await store.userResource.promise
  store.resolveAccount(store.userResource.data?.accounts, to.params.accountId as string | undefined)

  if (to.meta.shortcut) return { ...resolveShortcut(to.name, to.params, store.accountId), query: to.query }
}
