import { KeyboardShortcut, type DropdownOptions } from 'frappe-ui'
import { computed, h, type ComputedRef } from 'vue'

import type { AccountArea, AccountSheetArea, AreaDefinition } from '@/platform/contracts'
import { useSession } from '@/platform/session'
import { openAreaShortcuts } from '@/platform/shortcuts'
import { translate as __ } from '@/platform/translation'

/** The areas whose entry is a row in the account menu and the phone account sheet. */
export function accountAreas(areas: readonly AreaDefinition[]): AccountArea[] {
  return areas.filter((area): area is AccountArea => area.placement === 'account')
}

/**
 * The areas listed as rows in the phone account sheet, in registry order: the
 * account areas, and the rail areas that leave the bottom bar on a phone.
 */
export function accountSheetAreas(areas: readonly AreaDefinition[]): AccountSheetArea[] {
  return areas.filter(
    (area): area is AccountSheetArea =>
      area.placement === 'account' || area.phonePlacement === 'account',
  )
}

/**
 * The desktop account menu [T021]: who is signed in; the account areas
 * (People) and Keyboard shortcuts; Log out.
 * Settings is not here: the menu opens from the rail, and the rail's gear
 * sits directly above the avatar (spec section 3.5).
 */
export function useAccountMenu(areas: () => readonly AccountArea[]): ComputedRef<DropdownOptions> {
  const session = useSession()

  return computed<DropdownOptions>(() => {
    const user = session.user.value
    const name = user?.fullName || user?.id || __('Account')
    const email = user?.email ?? user?.id ?? ''

    return [
      {
        group: __('Account'),
        hideLabel: true,
        options: [
          {
            label: name,
            disabled: true,
            slots: {
              item: () =>
                h('div', { class: 'flex min-w-0 flex-col px-2 py-1.5' }, [
                  h('span', { class: 'truncate text-base font-medium text-ink-gray-8' }, name),
                  email && email !== name
                    ? h('span', { class: 'truncate text-sm text-ink-gray-5' }, email)
                    : null,
                ]),
            },
          },
        ],
      },
      {
        group: __('Go to'),
        hideLabel: true,
        options: [
          ...areas().map((area) => ({ label: area.label(), icon: area.menuIcon, route: area.to })),
          {
            label: __('Keyboard shortcuts'),
            icon: 'lucide-keyboard',
            onClick: () => openAreaShortcuts(),
            // `leading-none` keeps the hint's text-sm line height from making this row taller.
            slots: { suffix: () => h(KeyboardShortcut, { combo: '?', class: 'leading-none' }) },
          },
        ],
      },
      {
        group: __('Session'),
        hideLabel: true,
        options: [
          {
            label: __('Log out'),
            icon: 'lucide-log-out',
            onClick: () => void session.logout().then(() => window.location.reload()),
          },
        ],
      },
    ]
  })
}
