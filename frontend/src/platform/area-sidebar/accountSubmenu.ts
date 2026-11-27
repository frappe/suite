import { Check } from 'lucide-vue-next'
import { h } from 'vue'

import { translate as __ } from '@/platform/translation'

import AccountMark from './AccountMark.vue'

export interface Account {
  id: string
  _name: string | null
  is_personal?: boolean | 0 | 1
}

/**
 * An "every account at once" row below the accounts, for an app that can merge them. While it is
 * the one picked, no single account is ticked.
 */
export interface AllAccountsOption {
  label: string
  active: boolean
  onSelect: () => void
  /** What is unread across every account. */
  unread?: number
}

/** What is unread in each account, by account id. An account left out has nothing unread. */
export type AccountUnread = Readonly<Record<string, number>>

/**
 * An account's unread count as its row shows it. It stops at 99+: the menu is the sidebar's width,
 * and past that the number only takes room from the account's name.
 */
export const accountUnreadLabel = (count: number) => (count > 99 ? '99+' : String(count))

/**
 * The rows of the sidebar's account list.
 *
 * Mail, Calendar and People show the same accounts, so they should say the same
 * things about them — which is exactly what stopped being true once each app
 * built its own rows: one grew an avatar and a tick, another marked the current
 * account by filling its row instead. Written once here so they cannot drift again.
 *
 * What legitimately differs between them is only where picking an account
 * takes you, and what an app counts as unread, so those are what is passed in.
 *
 * A row's end says one thing: the tick on the row in use, and on any other row what is unread
 * there, which is the reason to switch to it. The row in use needs no count, as the sidebar below
 * already shows its folders'.
 *
 * The row itself is the menu's own — the account's mark where an icon goes, name as the
 * label, tick or count as a suffix. Standing in for the whole row with a custom `item`
 * slot means re-declaring the padding, hover and truncation it already has, and
 * costs the row its element on every render.
 */
export const accountSubmenu = (
  accounts: Account[] | undefined,
  activeId: string | undefined,
  onSelect: (id: string) => void,
  all?: AllAccountsOption,
  unread: AccountUnread = {},
) => {
  // Small and muted, as a folder's count is in the sidebar below.
  const end =
    (active: boolean, count = 0) =>
    () => {
      if (active) return h(Check, { class: 'icon size-4 shrink-0 text-ink-gray-7' })
      if (count <= 0) return null
      return h('span', { class: 'text-sm tabular-nums text-ink-gray-5' }, [
        accountUnreadLabel(count),
        h('span', { class: 'sr-only' }, ` ${__('unread')}`),
      ])
    }

  // The reader's own account leads; the rest keep the order they came in.
  const ordered = [...(accounts ?? [])].sort(
    (a, b) => Number(!!b.is_personal) - Number(!!a.is_personal),
  )

  const rows = ordered.map((account) => ({
    label: account._name ?? account.id,
    onClick: () => onSelect(account.id),
    slots: {
      prefix: () => h(AccountMark, { name: account._name ?? account.id }),
      suffix: end(!all?.active && account.id === activeId, unread[account.id]),
    },
  }))

  if (!all || rows.length < 2) return rows

  return [
    ...rows,
    {
      label: all.label,
      onClick: all.onSelect,
      slots: {
        prefix: () => h(AccountMark, { name: null }),
        suffix: end(all.active, all.unread),
      },
    },
  ]
}
