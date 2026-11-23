import { describe, expect, it, vi } from 'vitest'
import { h, render } from 'vue'

import { accountSubmenu } from './accountSubmenu'

// A row's end as the menu draws it.
const endOf = (row: { slots: { suffix: () => unknown } }) => {
  const el = document.createElement('div')
  render(
    h(() => row.slots.suffix()),
    el,
  )
  return { text: el.textContent?.trim() ?? '', ticked: !!el.querySelector('svg') }
}

const accounts = [
  { id: 'one', _name: 'one@example.com' },
  { id: 'two', _name: 'two@example.com' },
]

describe('accountSubmenu', () => {
  it('names every account', () => {
    expect(accountSubmenu(accounts, 'one', () => {}).map((r) => r.label)).toEqual([
      'one@example.com',
      'two@example.com',
    ])
  })

  // The tick is the whole point: it answers "which account am I in" without
  // filling the row, which on a list this short reads as a stuck hover.
  it('ticks the account in use, and only that one', () => {
    const ticked = accountSubmenu(accounts, 'two', () => {}).map((r) => !!r.slots.suffix())
    expect(ticked).toEqual([false, true])
  })

  it('ticks nothing when the active account is not in the list', () => {
    const ticked = accountSubmenu(accounts, 'gone', () => {}).map((r) => !!r.slots.suffix())
    expect(ticked).toEqual([false, false])
  })

  it('gives every row an avatar', () => {
    expect(accountSubmenu(accounts, 'one', () => {}).every((r) => !!r.slots.prefix())).toBe(true)
  })

  it('hands the picked account to the caller', () => {
    const onSelect = vi.fn()
    accountSubmenu(accounts, 'one', onSelect)[1]!.onClick()
    expect(onSelect).toHaveBeenCalledWith('two')
  })

  it('has no rows to show before the accounts arrive', () => {
    expect(accountSubmenu(undefined, 'one', () => {})).toEqual([])
  })
})

describe('accountSubmenu with an all-accounts row', () => {
  const all = (active: boolean, onSelect = () => {}) => ({
    label: 'All accounts',
    active,
    onSelect,
  })

  it('ends with the all-accounts row', () => {
    expect(accountSubmenu(accounts, 'one', () => {}, all(false)).map((r) => r.label)).toEqual([
      'one@example.com',
      'two@example.com',
      'All accounts',
    ])
  })

  it('ticks only the all-accounts row while it is picked', () => {
    const ticked = accountSubmenu(accounts, 'one', () => {}, all(true)).map(
      (r) => !!r.slots.suffix(),
    )
    expect(ticked).toEqual([false, false, true])
  })

  it('ticks the active account otherwise', () => {
    const ticked = accountSubmenu(accounts, 'two', () => {}, all(false)).map(
      (r) => !!r.slots.suffix(),
    )
    expect(ticked).toEqual([false, true, false])
  })

  it('selects all accounts from its row', () => {
    const onSelect = vi.fn()
    accountSubmenu(accounts, 'one', () => {}, all(false, onSelect))
      .at(-1)!
      .onClick()
    expect(onSelect).toHaveBeenCalledOnce()
  })

  it('is left out when there is only one account to merge', () => {
    expect(accountSubmenu(accounts.slice(0, 1), 'one', () => {}, all(false))).toHaveLength(1)
  })
})

// The count is the reason to switch, so it is on the accounts the reader is not in. The one in
// use has its folders' counts in the sidebar, and its row's end is the tick.
describe('accountSubmenu unread counts', () => {
  const all = (active: boolean, unread?: number) => ({
    label: 'All accounts',
    active,
    onSelect: () => {},
    unread,
  })

  const three = [...accounts, { id: 'three', _name: 'three@example.com' }]

  it('says what is unread in the accounts not in use', () => {
    const rows = accountSubmenu(three, 'one', () => {}, undefined, { one: 5, two: 3, three: 0 })
    expect(rows.map(endOf)).toEqual([
      { text: '', ticked: true },
      { text: '3 unread', ticked: false },
      { text: '', ticked: false },
    ])
  })

  it('stops a count at 99+', () => {
    const rows = accountSubmenu(accounts, 'one', () => {}, undefined, { two: 5106 })
    expect(endOf(rows[1]!).text).toBe('99+ unread')
  })

  it('counts every account on the all-accounts row, and each account while it is picked', () => {
    const unread = { one: 5, two: 3 }
    expect(endOf(accountSubmenu(accounts, 'one', () => {}, all(false, 8), unread).at(-1)!)).toEqual(
      {
        text: '8 unread',
        ticked: false,
      },
    )
    expect(accountSubmenu(accounts, 'one', () => {}, all(true, 8), unread).map(endOf)).toEqual([
      { text: '5 unread', ticked: false },
      { text: '3 unread', ticked: false },
      { text: '', ticked: true },
    ])
  })
})

describe('accountSubmenu order', () => {
  it("puts the reader's own account first", () => {
    const mixed = [
      { id: 'shared', _name: 'suite@example.com', is_personal: 0 as const },
      { id: 'mine', _name: 'akash@example.com', is_personal: 1 as const },
    ]
    expect(accountSubmenu(mixed, 'mine', () => {}).map((r) => r.label)).toEqual([
      'akash@example.com',
      'suite@example.com',
    ])
  })
})
