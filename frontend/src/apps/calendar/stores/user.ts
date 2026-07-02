import { ref } from 'vue'
import { defineStore } from 'pinia'
import { createResource } from 'frappe-ui'

import type { UserAccount } from '@/apps/calendar/types/doctypes'

const ACCOUNT_STORAGE_KEY = 'mail-account-id'

export const userStore = defineStore('calendar-user', () => {
	const accountId = ref('')

	const resolveAccount = (accounts?: UserAccount[], routeAccountId?: string) => {
		if (!accounts?.length) return

		// 1. Route param
		if (routeAccountId && accounts.some((a) => a.id === routeAccountId)) {
			if (routeAccountId !== accountId.value) setAccount(routeAccountId)
			return
		}

		// 2. localStorage
		const localId = localStorage.getItem(ACCOUNT_STORAGE_KEY)
		if (localId && accounts.some((a) => a.id === localId)) {
			if (localId !== accountId.value) setAccount(localId)
			return
		}

		// 3. Personal account fallback
		if (accountId.value) return
		const personalId = accounts.find((a) => a.is_personal)?.id
		if (personalId) setAccount(personalId)
	}

	const setAccount = (id: string) => {
		accountId.value = id
		localStorage.setItem(ACCOUNT_STORAGE_KEY, id)
		identities.fetch()
	}

	const userResource = createResource({
		url: 'suite.mail.api.account.get_user_info',
		onSuccess: (data) => resolveAccount(data?.accounts),
		onError: (error) => {
			if (error && error.exc_type === 'AuthenticationError')
				window.location.replace('/login?redirect-to=/calendar')
		},
		auto: true,
	})

	const identities = createResource({
		url: 'suite.mail.api.account.get_identities',
		makeParams: () => ({ account: accountId.value }),
		cache: ['identities', accountId.value],
	})

	return { accountId, resolveAccount, userResource, identities }
})
