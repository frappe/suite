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
