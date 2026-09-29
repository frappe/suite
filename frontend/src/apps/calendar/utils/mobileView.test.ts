import { describe, expect, it } from 'vitest'

import { isViewRoute, VIEW_ROUTES } from './mobileView'

describe('isViewRoute', () => {
	it('is true for every view, on either device', () => {
		for (const name of VIEW_ROUTES) expect(isViewRoute(name)).toBe(true)
		expect(VIEW_ROUTES).toEqual(['calendar-day', 'calendar-week', 'calendar-month', 'calendar-agenda'])
	})

	// The phone rewrites the route to the view it is showing whenever the view moves. On a
	// page that is not a view that rewrite would carry the reader off the page they opened.
	it('is false for the pages that are not views', () => {
		for (const name of ['calendar-search', 'calendar-profile', 'calendar-root-shortcut', 'mail-inbox', undefined, 7])
			expect(isViewRoute(name)).toBe(false)
	})
})
