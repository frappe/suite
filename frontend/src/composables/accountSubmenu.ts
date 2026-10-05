import { Avatar } from 'frappe-ui'
import { Check, Mails } from 'lucide-vue-next'
import { h } from 'vue'

interface Account {
  id: string
  _name: string
  is_personal?: boolean | 0 | 1
}

/**
 * An "every account at once" row below the accounts, for an app that can merge them. While it is
 * the one picked, no single account is ticked.
 */
interface AllAccountsOption {
  label: string
  active: boolean
  onSelect: () => void
}

/**
 * The rows of the sidebar's account list.
 *
 * Mail and calendar show the same accounts, so they should say the same things
 * about them — which is exactly what stopped being true once each app built its
 * own rows: one grew an avatar and a tick, the other marked the current account
 * by filling its row instead. Written once here so they cannot drift again.
 *
 * What legitimately differs between the two is only where picking an account
 * takes you, so that is the one thing passed in.
 *
 * The row itself is the menu's own — avatar where an icon goes, name as the
 * label, tick as a suffix. Standing in for the whole row with a custom `item`
 * slot means re-declaring the padding, hover and truncation it already has, and
 * costs the row its element on every render.
 */
export const accountSubmenu = (
  accounts: Account[] | undefined,
  activeId: string | undefined,
  onSelect: (id: string) => void,
  all?: AllAccountsOption,
) => {
  const tick = (active: boolean) => () =>
    active ? h(Check, { class: 'icon size-4 shrink-0 text-ink-gray-7' }) : null

  // The reader's own account leads; the rest keep the order they came in.
  const ordered = [...(accounts ?? [])].sort(
    (a, b) => Number(!!b.is_personal) - Number(!!a.is_personal),
  )

  const rows = ordered.map((account) => ({
    label: account._name,
    onClick: () => onSelect(account.id),
    slots: {
      // Close to icon size: the menu's rows are built around a 16 px icon, and a larger avatar
      // stretches them.
      prefix: () => h(Avatar, { label: account._name, size: 'sm' }),
      suffix: tick(!all?.active && account.id === activeId),
    },
  }))

  if (!all || rows.length < 2) return rows

  return [
    ...rows,
    {
      label: all.label,
      onClick: all.onSelect,
      slots: {
        prefix: () => h(Mails, { class: 'icon size-4 shrink-0 text-ink-gray-6' }),
        suffix: tick(all.active),
      },
    },
  ]
}
