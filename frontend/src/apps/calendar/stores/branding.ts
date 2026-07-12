import { defineStore } from 'pinia'
import { createResource } from 'frappe-ui'

/**
 * Calendar-local branding store.
 *
 * `suite.mail.api.get_branding` fetches brand name / brand HTML for the sidebar.
 * Auth/logout lives in the shared suite session store (`@/boot/session`).
 */
export const brandingStore = defineStore('calendar-branding', () => {
	const branding = createResource({
		url: 'suite.mail.api.get_branding',
		cache: 'brand',
		auto: true,
	})

	return { branding }
})
