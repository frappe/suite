import { describe, expect, it } from 'vitest'

import { isShared, managedSharees, shareeName } from './sharing'

import type { Sharee } from './sharing'

const sharee = (principal_id: string, role: Sharee['role'], extra: Partial<Sharee> = {}): Sharee => ({
	principal_id,
	role,
	...extra,
})

describe('shareeName', () => {
	it('names a person', () => {
		expect(shareeName({ principal_id: 'a1', name: 'Akash Tom', email: 'akash@frappe.io' })).toBe(
			'Akash Tom',
		)
	})

	it('does not say the address twice', () => {
		expect(shareeName({ principal_id: 'a1', name: 'akash@frappe.io', email: 'akash@frappe.io' })).toBe(
			'akash@frappe.io',
		)
	})

	it('falls back to the address, then to the id', () => {
		expect(shareeName({ principal_id: 'a1', name: null, email: 'akash@frappe.io' })).toBe(
			'akash@frappe.io',
		)
		expect(shareeName({ principal_id: 'a1', name: null, email: null })).toBe('a1')
	})
})

describe('managedSharees', () => {
	it('sends the sharees it has a role for', () => {
		expect(managedSharees([sharee('a1', 'view'), sharee('b2', 'view')])).toEqual([
			{ principal_id: 'a1', role: 'view' },
			{ principal_id: 'b2', role: 'view' },
		])
	})

	it('leaves out rights no role describes, so the server keeps them', () => {
		expect(managedSharees([sharee('a1', null), sharee('b2', 'view')])).toEqual([
			{ principal_id: 'b2', role: 'view' },
		])
	})
})

describe('isShared', () => {
	it('counts everyone on the calendar, Custom included', () => {
		const sharees = [sharee('a1', 'view'), sharee('custom', null)]
		expect(isShared(sharees, 'a1')).toBe(true)
		expect(isShared(sharees, 'custom')).toBe(true)
		expect(isShared(sharees, 'b2')).toBe(false)
	})
})
