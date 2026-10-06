import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RouteLocationNormalized } from 'vue-router'

const state = vi.hoisted(() => ({
	user: {} as Record<string, unknown>,
	switchedTo: [] as (string | undefined)[],
}))

// Two accounts: the user's own, and a team's whose number skips the one an unlinked account had.
const ACCOUNTS = [
	{ id: 'acc', number: 0 },
	{ id: 'team', number: 2 },
]
const MAILBOXES = [
	{ id: 'a', role: 'inbox', _name: 'Inbox' },
	{ id: 'b', role: 'sent', _name: 'Sent' },
	{ id: 'c', role: null, _name: 'Bills' },
	{ id: 'd', role: null, _name: 'Screener' },
]

vi.mock('@/router', () => ({ default: {} }))
vi.mock('@/boot/session', () => ({ useSessionStore: () => ({ isLoggedIn: true }) }))
vi.mock('@/apps/mail/stores/user', () => ({
	userStore: () => ({
		userResource: { promise: Promise.resolve(), data: state.user },
		mailboxes: { promise: Promise.resolve(), data: MAILBOXES },
		resolveAccount: (_accounts: unknown, id?: string) => state.switchedTo.push(id),
		accountId: 'acc',
		mailboxIds: { screener: 'd' },
	}),
}))

import { mailGuard } from './router'

const replace = vi.fn()
const to = (name: string, meta: Record<string, unknown> = {}, params: Record<string, string> = {}) =>
	({ name, meta, params, query: {} }) as unknown as RouteLocationNormalized
const dashboard = to('mail-domains', { isDashboard: true })
const inbox = { name: 'mail-mailbox', params: { account: '0', mailbox: 'inbox' } }
const member = (user: Record<string, unknown> = {}) =>
	(state.user = { is_jmap_configured: true, accounts: ACCOUNTS, ...user })

describe('who reaches the Admin Dashboard', () => {
	beforeEach(() => {
		replace.mockClear()
		vi.stubGlobal('window', { location: { replace } })
		vi.stubGlobal('document', { referrer: '' })
	})

	it('an admin of a site connected to a Suite Cloud', async () => {
		member({ is_suite_admin: true, is_suite_cloud_configured: true })
		expect(await mailGuard(dashboard)).toBeUndefined()
	})

	it('not an admin of a site without one: they keep their mailbox', async () => {
		member({ is_suite_admin: true, is_suite_cloud_configured: false })
		expect(await mailGuard(dashboard)).toEqual(inbox)
	})

	it('not someone with a mailbox who is no admin', async () => {
		member({ is_suite_admin: false, is_suite_cloud_configured: true })
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
		member({ is_suite_admin: false, is_suite_cloud_configured: false })
		const mailbox = to('mail-mailbox', {}, { account: '0', mailbox: 'inbox' })
		expect(await mailGuard(mailbox)).toBeUndefined()
	})
})

describe('the account a URL names by number', () => {
	beforeEach(() => {
		member()
		state.switchedTo.length = 0
	})

	it('becomes the active one', async () => {
		await mailGuard(to('mail-mailbox', {}, { account: '2', mailbox: 'inbox' }))
		expect(state.switchedTo).toEqual(['team'])
	})

	it('falls back to the personal account when the user has none at that number', async () => {
		const unlinked = to('mail-mail', {}, { account: '1', mailbox: 'sent', threadID: 'T1' })
		expect(await mailGuard(unlinked)).toEqual({
			name: 'mail-mail',
			params: { account: '0', mailbox: 'sent', threadID: 'T1' },
			query: {},
		})
	})

	it('stays as it was for a thread open in All Inboxes, which names its own', async () => {
		await mailGuard(to('mail-all-inboxes-mail', {}, { account: '2', threadID: 'T1' }))
		expect(state.switchedTo).toEqual([undefined])
	})
})

describe('a mailbox', () => {
	beforeEach(() => member())

	it('the account has not got is left for the page to say so', async () => {
		const renamed = to('mail-folder', {}, { account: '0', mailbox: 'Old Name' })
		expect(await mailGuard(renamed)).toBeUndefined()
		expect(await mailGuard(to('mail-mailbox', {}, { account: '0', mailbox: 'archive' }))).toBeUndefined()
	})

	it('that is the Screener opens the Screener', async () => {
		const screener = to('mail-folder', {}, { account: '0', mailbox: 'Screener' })
		expect(await mailGuard(screener)).toEqual({ name: 'mail-screener', params: { account: '0' } })
	})

	it('linked by its id lands on its own address', async () => {
		const shortcut = { shortcut: true }
		const byId = to('mail-mailbox-shortcut', shortcut, { account: '0', mailbox: 'c', threadID: 'T1' })
		expect(await mailGuard(byId)).toEqual({
			name: 'mail-folder-mail',
			params: { account: '0', mailbox: 'Bills', threadID: 'T1' },
			query: {},
		})
		const gone = to('mail-mailbox-shortcut', shortcut, { account: '0', mailbox: 'zz' })
		expect(await mailGuard(gone)).toEqual({ ...inbox, query: {} })
	})
})
