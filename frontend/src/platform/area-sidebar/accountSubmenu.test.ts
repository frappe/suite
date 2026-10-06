import { describe, expect, it, vi } from 'vitest'

import { accountSubmenu } from './accountSubmenu'

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
