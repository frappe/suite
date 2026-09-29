import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RouteLocationNormalized } from 'vue-router'

const state = vi.hoisted(() => ({ user: {} as Record<string, unknown> }))

vi.mock('@/router', () => ({ default: {} }))
vi.mock('@/boot/session', () => ({ useSessionStore: () => ({ isLoggedIn: true }) }))
vi.mock('@/apps/mail/stores/user', () => ({
	userStore: () => ({
		userResource: { promise: Promise.resolve(), data: state.user },
		mailboxes: { promise: Promise.resolve(), data: [{ id: 'inbox' }] },
		resolveAccount: () => {},
		accountId: 'acc',
		mailboxIds: {},
	}),
}))

import { mailGuard } from './router'

const replace = vi.fn()
const to = (name: string, meta: Record<string, unknown> = {}, params: Record<string, string> = {}) =>
	({ name, meta, params, query: {} }) as unknown as RouteLocationNormalized
const dashboard = to('mail-domains', { isDashboard: true })
const inbox = { name: 'mail-mailbox', params: { accountId: 'acc', mailbox: 'inbox' } }

describe('who reaches the Admin Dashboard', () => {
	beforeEach(() => {
		replace.mockClear()
		vi.stubGlobal('window', { location: { replace } })
		vi.stubGlobal('document', { referrer: '' })
	})

	it('an admin of a site connected to a Suite Cloud', async () => {
		state.user = { is_jmap_configured: true, is_suite_admin: true, is_suite_cloud_configured: true }
		expect(await mailGuard(dashboard)).toBeUndefined()
	})

	it('not an admin of a site without one: they keep their mailbox', async () => {
		state.user = { is_jmap_configured: true, is_suite_admin: true, is_suite_cloud_configured: false }
		expect(await mailGuard(dashboard)).toEqual(inbox)
	})

	it('not someone with a mailbox who is no admin', async () => {
		state.user = { is_jmap_configured: true, is_suite_admin: false, is_suite_cloud_configured: true }
		expect(await mailGuard(dashboard)).toEqual(inbox)
	})

	it('an admin without a mailbox lands on it when the site is connected', async () => {
		state.user = { is_jmap_configured: false, is_suite_admin: true, is_suite_cloud_configured: true }
		expect(await mailGuard(to('mail-root-shortcut'))).toEqual({ name: 'mail-overview' })
		expect(replace).not.toHaveBeenCalled()
	})

	it('an admin without a mailbox has nothing in Mail when it is not', async () => {
		state.user = { is_jmap_configured: false, is_suite_admin: true, is_suite_cloud_configured: false }
		expect(await mailGuard(dashboard)).toBe(false)
		expect(replace).toHaveBeenCalledWith('/desk')
	})
})

describe('mail without a Suite Cloud', () => {
	it('opens for anyone with a mailbox', async () => {
		state.user = { is_jmap_configured: true, is_suite_admin: false, is_suite_cloud_configured: false }
		const mailbox = to('mail-mailbox', {}, { accountId: 'acc', mailbox: 'inbox' })
		expect(await mailGuard(mailbox)).toBeUndefined()
	})
})
