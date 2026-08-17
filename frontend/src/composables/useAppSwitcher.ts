import { computed, h } from 'vue'
import { LayoutGrid } from 'lucide-vue-next'

import { getAppSwitcherItems, type SuiteAppSwitcherItem } from '@/apps/registry'
import { translate as __ } from '@/boot/translation'

function appOption(app: SuiteAppSwitcherItem) {
	return {
		label: app.title,
		route: app.spa ? app.route : undefined,
		onClick: app.spa ? undefined : () => window.location.assign(app.route),
		slots: {
			prefix: () => h('img', { src: app.logo, class: 'size-6 object-contain', alt: '' }),
		},
	}
}

export function useAppSwitcher(currentAppId: string) {
	return computed(() => ({
		label: __('Apps'),
		icon: LayoutGrid,
		submenu: getAppSwitcherItems(currentAppId).map(appOption),
	}))
}
