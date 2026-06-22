import { computed } from 'vue'
import { defineStore } from 'pinia'
import { createResource } from 'frappe-ui'

import { getSessionUser, useSessionStore } from '@/boot/session'
import router from '@/apps/mail/router'
import { userStore } from '@/apps/mail/stores/user'

export const sessionStore = defineStore('mail-session', () => {
	const session = useSessionStore()
	const { userResource, mailboxes } = userStore()

	const login = createResource({
		url: 'login',
		onError: () => {
			throw new Error('Invalid email or password')
		},
		onSuccess: () => {
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
			userResource.reset()
			mailboxes.reset()
			session.user = null
			window.location.reload()
		},
	})

	const branding = createResource({
		url: 'suite.mail.api.get_branding',
		cache: 'brand',
		auto: true,
		onSuccess: (data) => (document.querySelector("link[rel='icon']").href = data.favicon),
	})

	return { isLoggedIn: computed(() => session.isLoggedIn), login, logout, branding }
})
