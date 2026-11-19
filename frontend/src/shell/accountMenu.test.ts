import { fromPartial } from '@total-typescript/shoehorn'
import type { DropdownOption, DropdownOptions } from 'frappe-ui'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'

import type { AreaDefinition } from '@/platform/contracts'
import type { Session } from '@/platform/session'
import { shellShortcutsOpen } from '@/platform/shortcuts'
import { accountAreas, accountSheetAreas, useAccountMenu } from '@/shell/accountMenu'

vi.mock('frappe-ui', () => ({ ItemListRow: {}, KeyboardShortcut: {} }))

const capabilities = ref({ jmap: true, systemManager: false })
vi.mock('@/platform/session', () => ({
  useSession: () =>
    fromPartial<Session>({
      user: ref({ id: 'maya@northwind.test', fullName: 'Maya Chen', avatar: null }),
      capabilities,
    }),
}))

const icon = defineComponent({ setup: () => () => h('span') })
const areas: AreaDefinition[] = [
  { id: 'home', label: () => 'Home', icon, to: '/home', loadRoutes: vi.fn() },
  {
    id: 'mail',
    label: () => 'Mail',
    icon,
    to: '/mail',
    phonePlacement: 'account',
    menuIcon: 'lucide-mail',
    loadRoutes: vi.fn(),
  },
  {
    id: 'people',
    label: () => 'People',
    icon,
    to: '/people',
    placement: 'account',
    menuIcon: 'lucide-users',
    loadRoutes: vi.fn(),
  },
  {
    id: 'admin',
    label: () => 'Admin',
    icon,
    to: '/admin',
    placement: 'workspace',
    loadRoutes: vi.fn(),
  },
]

/** The rows a person sees, group by group, as the menu leaves out a row whose condition fails. */
function rows(options: DropdownOptions) {
  return options.map((item) =>
    'group' in item
      ? item.options
          .filter((option: DropdownOption) => option.condition?.() ?? true)
          .map((option: DropdownOption) => option.label)
      : [item.label],
  )
}

function menuOption(options: DropdownOptions, label: string) {
  for (const item of options) {
    const found =
      'group' in item ? item.options.find((option: DropdownOption) => option.label === label) : item
    if (found?.label === label) return found
  }
  throw new Error(`No row ${label}`)
}

afterEach(() => {
  capabilities.value = { jmap: true, systemManager: false }
  shellShortcutsOpen.value = false
})

describe('account menu', () => {
  it('holds who is signed in, People and Keyboard shortcuts, then Log out', () => {
    const menu = useAccountMenu(() => accountAreas(areas))

    expect(rows(menu.value)).toEqual([['Maya Chen'], ['People', 'Keyboard shortcuts'], ['Log out']])
    expect(menuOption(menu.value, 'People').route).toBe('/people')
  })

  it('offers no Open Desk, even to a system manager', () => {
    capabilities.value = { jmap: true, systemManager: true }
    const menu = useAccountMenu(() => accountAreas(areas))

    expect(rows(menu.value).flat()).not.toContain('Open Desk')
  })

  it('opens the shortcuts list from Keyboard shortcuts', () => {
    const menu = useAccountMenu(() => accountAreas(areas))
    const shortcuts = menuOption(menu.value, 'Keyboard shortcuts')

    shortcuts.onClick?.(new Event('click'))

    expect(shellShortcutsOpen.value).toBe(true)
  })
})

describe('phone account sheet', () => {
  it('lists the rail areas placed there on a phone, then the account areas, in registry order', () => {
    expect(accountSheetAreas(areas).map((area) => area.label())).toEqual(['Mail', 'People'])
  })
})
