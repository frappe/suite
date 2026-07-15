<script setup lang="ts">
import { onMounted, onUnmounted, provide, watchEffect } from 'vue'
import { FrappeUIProvider, createResource } from 'frappe-ui'

import { raiseToast, shouldIgnoreKeypress } from '@/apps/calendar/utils'
import dayjs from '@/apps/calendar/utils/dayjs'
import { useTheme } from '@/apps/calendar/utils/composables'
import { userStore } from '@/apps/calendar/stores/user'

/**
 * Calendar route-group layout.
 *
 * Maps the standalone app's root App.vue. The suite shell already provides the
 * top-level chrome, so this layout only:
 *   - provides the calendar-local `$user` (mail/calendar userResource) and
 *     `$dayjs` injections that calendar components depend on,
 *   - applies the user's color scheme to <html data-theme>,
 *   - ports the Cmd/Ctrl+Shift+L theme-cycle shortcut,
 *   - wraps children in FrappeUIProvider and renders the nested <router-view>.
 */
const { userResource } = userStore()
const { dataTheme } = useTheme()

provide('$user', userResource)
provide('$dayjs', dayjs)

watchEffect(() => document.documentElement.setAttribute('data-theme', dataTheme.value))

onMounted(() => window.addEventListener('keydown', handleKeyDown))
onUnmounted(() => window.removeEventListener('keydown', handleKeyDown))

const handleKeyDown = (e: KeyboardEvent) => {
	const key = e.key.toLowerCase()

	// Handle Ctrl/Cmd+Shift+L (Cycle Theme)
	if ((e.metaKey || e.ctrlKey) && e.shiftKey && key === 'l' && !shouldIgnoreKeypress(e, true)) {
		e.preventDefault()
		return cycleTheme()
	}
}

const COLOR_SCHEME_CYCLE = ['System Default', 'Light Mode', 'Dark Mode'] as const

const cycleTheme = () => {
	const current = userResource.data?.color_scheme
	if (!current) return

	const idx = COLOR_SCHEME_CYCLE.indexOf(current)
	const next = COLOR_SCHEME_CYCLE[(idx + 1) % COLOR_SCHEME_CYCLE.length]

	// Optimistic: flip the theme and confirm at once, before the server round-trip resolves.
	userResource.data.color_scheme = next
	raiseToast(__('Color scheme updated to {0}.', [next]))

	updateColorScheme.submit(next, {
		onError: () => {
			userResource.data.color_scheme = current
			raiseToast(__('Failed to update color scheme. Please try again later.'), 'error')
		},
	})
}

const updateColorScheme = createResource({
	url: 'frappe.client.set_value',
	makeParams: (color_scheme) => ({
		doctype: 'User Settings',
		name: userResource.data.user_settings,
		fieldname: { color_scheme },
	}),
	onSuccess: () => {
		// Reconcile the optimistic value against server truth (sets the same value; harmless).
		userResource.reload()
	},
})
</script>

<template>
	<FrappeUIProvider>
		<router-view />
	</FrappeUIProvider>
</template>
