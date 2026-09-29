import { afterEach, describe, expect, it } from 'vitest'

import { jmapUser, systemUser } from '@/boot/session'
import { getAppSwitcherItems, getPhoneAppSwitcherItems } from './registry'

const names = (currentApp: string) => getPhoneAppSwitcherItems(currentApp).map((app) => app.name)

describe('getPhoneAppSwitcherItems', () => {
	afterEach(() => {
		jmapUser.value = false
		systemUser.value = false
	})

	it('leads with the current app, then only the other apps with a phone layout', () => {
		jmapUser.value = true
		expect(names('mail')).toEqual(['mail', 'calendar'])
		expect(names('calendar')).toEqual(['calendar', 'mail'])
	})

	it('leaves Desk out even for a system user, since it has no phone layout', () => {
		jmapUser.value = true
		systemUser.value = true
		expect(names('mail')).toEqual(['mail', 'calendar'])
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
