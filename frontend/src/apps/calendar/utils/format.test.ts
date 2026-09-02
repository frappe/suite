import { beforeAll, describe, expect, it } from 'vitest'

import { getRepeatMessage } from './format'

// The app's translation helper is a global installed at boot. The placeholder form is what
// the assertions read, so it substitutes rather than translating.
beforeAll(() => {
	;(globalThis as any).__ = (text: string, args?: (string | number)[]) =>
		args ? text.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)])) : text
})

describe('getRepeatMessage', () => {
	it('describes an ordinary rule', () => {
		expect(getRepeatMessage({ frequency: 'weekly', interval: 1 } as any)).toBe('Every  week')
	})

	it('says nothing about a rule it cannot read', () => {
		// An occurrence can outlive the rule that made it: a series whose rule was cleared keeps
		// the occurrences the server had already expanded, and they still carry a recurrence id.
		// This used to assert its way to a frequency and throw out of the panel rendering it.
		expect(getRepeatMessage({} as any)).toBe('')
		expect(getRepeatMessage(undefined as any)).toBe('')
		expect(getRepeatMessage({ interval: 1 } as any)).toBe('')
	})
})
