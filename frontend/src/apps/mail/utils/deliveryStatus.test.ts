import { describe, expect, it } from 'vitest'

import { overallDsnAction, serverResponse, type DsnRecipient } from './deliveryStatus'

const recipient = (overrides: Partial<DsnRecipient>): DsnRecipient => ({
	email: 'a@example.com',
	action: 'failed',
	status: '',
	diagnostic_code: '',
	remote_mta: '',
	will_retry_until: '',
	...overrides,
})

describe('overallDsnAction', () => {
	it('is the single recipient action', () => {
		expect(overallDsnAction([recipient({ action: 'delayed' })])).toBe('delayed')
	})

	it('picks the worst outcome across recipients: failed over delayed over delivered', () => {
		expect(
			overallDsnAction([
				recipient({ action: 'delivered' }),
				recipient({ action: 'delayed' }),
				recipient({ action: 'failed' }),
			]),
		).toBe('failed')
		expect(
			overallDsnAction([recipient({ action: 'delivered' }), recipient({ action: 'delayed' })]),
		).toBe('delayed')
	})

	it('falls back to the first action for unranked ones like relayed', () => {
		expect(overallDsnAction([recipient({ action: 'relayed' })])).toBe('relayed')
	})

	it('is empty for no recipients', () => {
		expect(overallDsnAction([])).toBe('')
	})
})

describe('serverResponse', () => {
	it('prefers the diagnostic over the status code', () => {
		expect(
			serverResponse(recipient({ status: '5.7.26', diagnostic_code: '550 rejected' })),
		).toBe('550 rejected')
	})

	it('falls back to the status code', () => {
		expect(serverResponse(recipient({ status: '5.1.1' }))).toBe('5.1.1')
	})
})
