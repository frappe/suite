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

	it('account-scoped routes still resolve', () => {
		expect(makeRouter().resolve('/mail/account/ih/mailbox/a').name).toBe('mail-mailbox')
	})
})
