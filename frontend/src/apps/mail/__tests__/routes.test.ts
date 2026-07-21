import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

// `@/apps/mail/routes` imports the mail guard for side effects, which pulls in
// the whole suite router + session store. Stub it out: this suite is about the
// shape of the route table, not the guard.
vi.mock('@/apps/mail/router', () => ({ default: {}, router: {} }))
vi.mock('frappe-ui', () => ({ createResource: () => ({ fetch: () => {} }) }))

let router: Router

beforeAll(async () => {
	const { routes } = await import('@/apps/mail/routes')
	router = createRouter({
		history: createMemoryHistory('/'),
		// Mounted the way the suite router mounts it: relative paths under /mail.
		routes: [{ path: '/mail', component: { render: () => null }, children: routes }],
	})
})

const PUBLIC_ROUTES: [string, string][] = [
	['/mail/login', 'mail-login'],
	['/mail/signup', 'mail-signup'],
	['/mail/signup/abc123', 'mail-invite-setup'],
	['/mail/reset-password', 'mail-forgot-password'],
	['/mail/reset-password/abc123', 'mail-reset-password'],
]

describe('mail route table', () => {
	// Regression: a `path: ''` LoginLayout wrapper shadowed `mail-root-shortcut`,
	// so /mail rendered a bare "Create a new account" card for authed users.
	it('resolves /mail to the root shortcut, not the login layout', () => {
		expect(router.resolve('/mail').name).toBe('mail-root-shortcut')
	})

	it('resolves the public routes to their named records', () => {
		for (const [path, name] of PUBLIC_ROUTES) {
			expect(router.resolve(path).name, path).toBe(name)
		}
	})

	it('wraps every public route in LoginLayout', () => {
		for (const [path] of PUBLIC_ROUTES) {
			const resolved = router.resolve(path)
			expect(resolved.meta.isLogin, path).toBe(true)
			expect(resolved.meta.allowGuest, path).toBe(true)
			// /mail wrapper -> LoginLayout -> leaf view
			expect(resolved.matched.length, path).toBeGreaterThanOrEqual(3)
		}
	})

	it('keeps authed routes matching under MailLayout', () => {
		expect(router.resolve('/mail/dashboard/members').name).toBe('mail-members')
		expect(router.resolve('/mail/all-inboxes').name).toBe('mail-all-inboxes')
		expect(router.resolve('/mail/mailbox/inbox').name).toBe('mail-mailbox-shortcut')
	})
})
