import { computed, h } from 'vue'
import { useRouter, type Router } from 'vue-router'

import { getAppSwitcherItems } from '@/apps/registry'
import { translate as __ } from '@/boot/translation'

import type { SuiteAppSwitcherItem } from '@/apps/registry'

/**
 * Leave for another app. The suite apps share this SPA, so the router takes
 * you there; Desk is a separate page, so the browser does. Shared by the
 * desktop sidebar's Apps menu and the phone's Apps sheet.
 */
export const openApp = (router: Router, app: SuiteAppSwitcherItem) =>
	app.spa ? router.push(app.route) : window.location.assign(app.route)

export function useAppSwitcher(
	currentAppId: string,
	beforeNavigate?: () => boolean | void | Promise<boolean | void>,
) {
	const router = useRouter()

	return computed(() => ({
		label: __('Apps'),
		icon: 'lucide-layout-grid',
		submenu: getAppSwitcherItems(currentAppId).map((app) => ({
			label: app.title,
			icon: h('img', { src: app.logo, class: '!size-6' }),
			onClick: async () => {
				if ((await beforeNavigate?.()) === false) return
				openApp(router, app)
			},
		})),
	}))
}
