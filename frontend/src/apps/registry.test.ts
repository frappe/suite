import { afterEach, describe, expect, it, vi } from 'vitest'

import { getAppSwitcherItems, getPhoneAppSwitcherItems } from './registry'

// The session flags are read-only views of the platform session, so the test
// stands in its own values for them.
const session = vi.hoisted(() => ({
	jmapUser: { value: false },
}))
vi.mock('@/boot/session', () => session)
const { jmapUser } = session

const names = (currentApp: string) => getPhoneAppSwitcherItems(currentApp).map((app) => app.name)

describe('getPhoneAppSwitcherItems', () => {
	afterEach(() => {
		jmapUser.value = false
	})

	it('leads with the current app, then only the other apps with a phone layout', () => {
		jmapUser.value = true
		expect(names('mail')).toEqual(['mail', 'calendar'])
		expect(names('calendar')).toEqual(['calendar', 'mail'])
	})

	it('offers no Desk entry: Open Desk lives in the account menu', () => {
		jmapUser.value = true
		expect(getAppSwitcherItems('mail', true).every((app) => app.spa)).toBe(true)
	})

	it('offers no other app the desktop menu would not', () => {
		jmapUser.value = false
		expect(names('mail')).toEqual(['mail'])
	})

	it('can include the current app for the command palette', () => {
		jmapUser.value = true
		expect(getAppSwitcherItems('mail', true).map((app) => app.name)).toContain('mail')
	})
})
