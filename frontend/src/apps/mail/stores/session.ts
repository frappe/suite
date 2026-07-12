import { computed } from 'vue'
import { defineStore } from 'pinia'
import { createResource } from 'frappe-ui'

import { getSessionUser, useSessionStore } from '@/boot/session'
import router from '@/apps/mail/router'
import { raiseToast } from '@/apps/mail/utils'
import { userStore } from '@/apps/mail/stores/user'

export const sessionStore = defineStore('mail-session', () => {
	const session = useSessionStore()
	const { userResource, reset } = userStore()

	const login = createResource({
		url: 'login',
		onError: () => {
			throw new Error('Invalid email or password')
		},
		onSuccess: () => {
			// Start from a clean slate: a prior session's account/resources may still be in memory
			// (e.g. cookies cleared without a page reload). Without this, resolveAccount() would
			// skip setAccount() and the mailboxes/account resources wouldn't load until a reload.
			reset()
			userResource.reload()
			session.user = getSessionUser()
			login.reset()

			if (session.user === 'Administrator') window.location.replace('/app')
			else router.replace({ name: 'mail-root-shortcut' })
		},
	})

	const logout = createResource({
		url: 'logout',
		onSuccess() {
			reset()
			session.user = null
			window.location.reload()
		},
	})

	const branding = createResource({
		url: 'suite.mail.api.get_branding',
		cache: 'brand',
		auto: true,
	})

	// Called when a request fails with an auth/permission error: sign the user out (clear state,
	// one toast, redirect to login) when their session is actually gone. No-op when still logged
	// in (a genuine PermissionError that should surface) or when there was never a session in
	// this tab (a failed login attempt — let the form show "wrong password"). Frappe resets the
	// user_id cookie to Guest on a dead session, so the cookie is the discriminator. Idempotent:
	// once the session user is cleared, concurrent calls return early, so the toast/redirect fire once.
	const handleSessionExpired = (): void => {
		if (getSessionUser()) return
		if (!session.user) return

		session.user = null
		reset()
		raiseToast(__('You have been signed out. Please sign in again.'), 'error')
		if (router.currentRoute.value.name !== 'mail-login') router.replace({ name: 'mail-login' })
	}

	return {
		isLoggedIn: computed(() => session.isLoggedIn),
		login,
		logout,
		branding,
		handleSessionExpired,
	}
})
