import { describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter, type RouteLocation, type Router } from 'vue-router'

// routes.ts imports the mail guard (which drags in the whole suite router) for its
// side effects, and frappe-ui for a resource — neither affects route matching.
vi.mock('@/apps/mail/router', () => ({}))
vi.mock('frappe-ui', () => ({ createResource: () => ({ fetch: () => {} }) }))

import { routes } from './routes'

const Stub = { render: () => null }

/** Mirror src/router/index.ts: the mail module is mounted as children of '/mail'. */
const makeRouter = () =>
	createRouter({
		history: createMemoryHistory(),
		routes: [{ path: '/mail', component: Stub, children: routes }],
	})

/** resolve() never follows `redirect`; hop once so assertions see the landing route. */
const resolveFollowingRedirect = (router: Router, to: string): RouteLocation => {
	const resolved = router.resolve(to)
	const redirect = resolved.matched.at(-1)?.redirect
	if (!redirect) return resolved
	return router.resolve(typeof redirect === 'function' ? redirect(resolved) : redirect)
}

describe('mail route matching', () => {
	// Regression: the LoginLayout wrapper restored in #281 sits at path '' — the same
	// full path as the root shortcut — and, registered first, won the matcher tie.
	// Bare /mail then rendered an empty login card instead of redirecting to the inbox.
	it('bare /mail lands on the root shortcut', () => {
		const landed = resolveFollowingRedirect(makeRouter(), '/mail')
		expect(String(landed.name)).toBe('mail-root-shortcut')
	})

	it('public pre-auth routes still resolve', () => {
		const router = makeRouter()
		expect(router.resolve('/mail/login').name).toBe('mail-login')
		expect(router.resolve('/mail/signup').name).toBe('mail-signup')
	})

	it('dashboard DMARC routes resolve as dashboard pages', () => {
		const router = makeRouter()
		const list = router.resolve('/mail/dashboard/dmarc')
		expect([list.name, list.meta.isDashboard]).toEqual(['mail-dmarc-reports', true])
		const detail = router.resolve('/mail/dashboard/dmarc/c1-dma1')
		expect([detail.name, detail.params.reportId]).toEqual(['mail-dmarc-report', 'c1-dma1'])
	})

	it('dashboard TLS routes resolve as dashboard pages', () => {
		const router = makeRouter()
		const list = router.resolve('/mail/dashboard/tls')
		expect([list.name, list.meta.isDashboard]).toEqual(['mail-tls-reports', true])
		const detail = router.resolve('/mail/dashboard/tls/c1-tls1')
		expect([detail.name, detail.params.reportId]).toEqual(['mail-tls-report', 'c1-tls1'])
	})

})

describe('the pages of an account', () => {
	const at = (path: string) => {
		const { name, params } = makeRouter().resolve(path)
		return [name, params]
	}

	it('a mailbox by its role, with or without a thread open', () => {
		expect(at('/mail/a/0/inbox')).toEqual(['mail-mailbox', { account: '0', mailbox: 'inbox' }])
		expect(at('/mail/a/2/sent/Tabc')).toEqual([
			'mail-mail',
			{ account: '2', mailbox: 'sent', threadID: 'Tabc' },
		])
	})

	it('a folder of the user by its name', () => {
		expect(at('/mail/a/0/mailbox/Custom%20Folder')).toEqual([
			'mail-folder',
			{ account: '0', mailbox: 'Custom Folder' },
		])
		expect(at('/mail/a/0/mailbox/Custom%20Folder/Tabc')).toEqual([
			'mail-folder-mail',
			{ account: '0', mailbox: 'Custom Folder', threadID: 'Tabc' },
		])
	})

	it('a folder named like a role is not the mailbox of that role', () => {
		expect(at('/mail/a/0/mailbox/sent')[0]).toBe('mail-folder')
		expect(at('/mail/a/0/mailbox/mailbox')).toEqual([
			'mail-folder',
			{ account: '0', mailbox: 'mailbox' },
		])
	})

	it('a nested folder by its whole path', () => {
		const link = makeRouter().resolve({
			name: 'mail-folder',
			params: { account: '0', mailbox: 'Clients/2024' },
		})
		expect(link.path).toBe('/mail/a/0/mailbox/Clients%2F2024')
		expect(at(link.path)[1]).toEqual({ account: '0', mailbox: 'Clients/2024' })
	})

	it('the merged list, and a thread open in it', () => {
		expect(at('/mail/a/0/all')[0]).toBe('mail-all-inboxes')
		expect(at('/mail/a/1/all/Tabc')).toEqual([
			'mail-all-inboxes-mail',
			{ account: '1', threadID: 'Tabc' },
		])
	})

	it('the pages that are not mailboxes', () => {
		expect(at('/mail/a/0/outbox')[0]).toBe('mail-outbox')
		expect(at('/mail/a/0/outbox/S1')[0]).toBe('mail-submission')
		expect(at('/mail/a/0/screener')[0]).toBe('mail-screener')
		expect(at('/mail/a/0/screener/a@b.c')[0]).toBe('mail-screener-sender')
		expect(at('/mail/a/0/compose')[0]).toBe('mail-compose')
		expect(at('/mail/a/0/contacts')[0]).toBe('mail-contacts')
		expect(at('/mail/a/0/contacts/C1')[0]).toBe('mail-contact')
		expect(at('/mail/a/0/address-books/B1')[0]).toBe('mail-address-book')
	})

	it('a mailbox by its id is a shortcut to its own address', () => {
		expect(at('/mail/a/0/id/a/Tabc')).toEqual([
			'mail-mailbox-shortcut',
			{ account: '0', mailbox: 'a', threadID: 'Tabc' },
		])
		expect(at('/mail/a/1')[0]).toBe('mail-account-shortcut')
	})

	it('the addresses from before account numbers are gone', () => {
		const router = makeRouter()
		expect(router.resolve('/mail/account/ih/mailbox/a').matched).toEqual([])
		expect(router.resolve('/mail/all-inboxes').matched).toEqual([])
	})
})
