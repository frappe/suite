import type { RouteRecordRaw } from 'vue-router'

import { peopleGuard } from '@/apps/people/router'

/**
 * People route module — mounted by the suite router under the '/people'
 * prefix. Paths are RELATIVE to '/people'. Route names are namespaced
 * `people-*` to avoid collisions in the single suite router.
 *
 * The shortcut routes resolve to their account-scoped equivalents in the
 * guard once the active accountId is known (see ./router.ts).
 */

const ShortcutRedirect = { render: () => null }

export const routes: RouteRecordRaw[] = [
  {
    path: '',
    component: () => import('@/apps/people/pages/PeopleLayout.vue'),
    children: [
      {
        path: 'account/:accountId/contacts',
        name: 'people-contacts',
        component: () => import('@/apps/people/pages/ContactsView.vue'),
        props: true,
      },
      {
        path: 'account/:accountId/contacts/:contactName',
        name: 'people-contact',
        component: () => import('@/apps/people/pages/ContactView.vue'),
        props: true,
      },
      {
        path: 'account/:accountId/address-books',
        name: 'people-address-books',
        component: () => import('@/apps/people/pages/AddressBooksView.vue'),
        props: true,
      },
      {
        path: 'account/:accountId/address-books/:addressBookName',
        name: 'people-address-book',
        component: () => import('@/apps/people/pages/AddressBookView.vue'),
        props: true,
      },
      // Shortcut routes: short paths that resolve to their full account-scoped
      // equivalents once the active accountId is known (resolved in the guard).
      {
        path: '',
        name: 'people-root-shortcut',
        component: ShortcutRedirect,
        meta: { shortcut: true },
      },
      {
        path: 'account/:accountId?',
        name: 'people-account-shortcut',
        component: ShortcutRedirect,
        meta: { shortcut: true },
      },
      {
        path: 'contacts/:contactName?',
        name: 'people-contacts-shortcut',
        component: ShortcutRedirect,
        meta: { shortcut: true },
      },
      {
        path: 'address-books/:addressBookName?',
        name: 'people-address-books-shortcut',
        component: ShortcutRedirect,
        meta: { shortcut: true },
      },
    ].map((route) => ({ ...route, beforeEnter: peopleGuard })),
  },
]
