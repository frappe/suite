import { computed, h } from 'vue'
import { RouterLink } from 'vue-router'

import { getAppSwitcherItems, type SuiteAppSwitcherItem } from '@/apps/registry'
import { translate as __ } from '@/boot/translation'

const linkClasses =
	'flex items-center gap-2 rounded-4 p-1.5 outline-none focus:bg-surface-gray-2 data-[highlighted]:bg-surface-alpha-gray-2'

function renderAppLink(app: SuiteAppSwitcherItem) {
	return h(
		app.spa ? RouterLink : 'a',
		{ class: linkClasses, ...(app.spa ? { to: app.route } : { href: app.route }) },
		[
			h('img', { src: app.logo, class: 'size-6' }),
			h('span', { class: 'max-w-18 w-full truncate text-sm text-ink-gray-9' }, app.title),
		],
	)
}

export function useAppSwitcher(currentAppId: string) {
	return computed(() => ({
		label: __('Apps'),
		icon: 'lucide-layout-grid',
		submenu: getAppSwitcherItems(currentAppId).map((app) => ({
			label: app.title,
			icon: h('img', { src: app.logo, class: '!size-6' }),
			component: renderAppLink(app),
		})),
	}))
}
