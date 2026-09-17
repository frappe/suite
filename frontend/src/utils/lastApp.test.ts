import { beforeEach, describe, expect, it } from 'vitest'

import { lastAppPrefix, rememberLastApp } from './lastApp'

describe('lastApp', () => {
	beforeEach(() => localStorage.clear())

	it('opens mail before any app is remembered', () => {
		expect(lastAppPrefix()).toBe('/mail')
	})

	it('opens the app the phone was last in', () => {
		rememberLastApp('calendar')
		expect(lastAppPrefix()).toBe('/calendar')
		rememberLastApp('mail')
		expect(lastAppPrefix()).toBe('/mail')
	})

	it('remembers only the apps that make the install offer', () => {
		rememberLastApp('calendar')
		rememberLastApp('drive')
		rememberLastApp(undefined)
		expect(lastAppPrefix()).toBe('/calendar')
	})
})
