<template>
	<FrappeUIProvider>
		<component :is="Layout" class="mail-app-root">
			<router-view />
		</component>
		<InstallPrompt v-if="isMobile" />
	</FrappeUIProvider>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, provide, watchEffect } from 'vue'
import { useRoute } from 'vue-router'
import { FrappeUIProvider } from 'frappe-ui'

import { shouldIgnoreKeypress } from '@/apps/mail/utils'
import { useScreenSize, useTheme } from '@/apps/mail/utils/composables'
import { showNotification } from '@/apps/mail/utils/push-notifications'
import { initSocket } from '@/apps/mail/socket'
import dayjs from '@/apps/mail/utils/dayjs'
import { userStore } from '@/apps/mail/stores/user'
import DefaultLayout from '@/apps/mail/components/DefaultLayout.vue'
import InstallPrompt from '@/apps/mail/components/InstallPrompt.vue'

import type { NotificationPayload } from '@/apps/mail/types'

/**
 * Mail route-group layout.
 *
 * Maps the standalone app's root App.vue. The suite shell already provides the
 * top-level chrome and main.ts provides Pinia/router/frappe-ui/translation, but
 * does NOT provide mail's `$user` / `$dayjs` / `$socket` injects, register
 * mail's push-notification SW, or set up mail's theme. So this layout:
 *   - provides the mail-local `$user` / `$dayjs` / `$socket` injections,
 *   - applies the user's color scheme to <html data-theme>,
 *   - picks the inner layout (DefaultLayout / bare div for noLayout routes),
 *   - wires push-notification onMessage and registers the (fail-safe) SW,
 *   - wraps children in FrappeUIProvider and renders the nested <router-view>.
 *
 * Public pre-auth routes (login/signup/...) sit OUTSIDE this layout since they
 * do not need the $user/$dayjs/$socket injects.
 */
const { userResource } = userStore()
const { dataTheme, cycleTheme } = useTheme()
const { isMobile } = useScreenSize()
const route = useRoute()

provide('$user', userResource)
provide('$dayjs', dayjs)
provide('$socket', initSocket())

const Layout = computed(() => {
	if (route.meta.noLayout) return 'div'
	return DefaultLayout
})

watchEffect(() => document.documentElement.setAttribute('data-theme', dataTheme.value))

// Mark <body> while mail is mounted so the base styles below (see <style>) can reach frappe-ui
// Dialogs/Dropdowns, which teleport to <body> — OUTSIDE .mail-app-root. Without this, their
// un-classed text (modal <h1> titles, base ink color) and heading weights fall back to defaults
// (black + non-bold), which the standalone app avoided by setting these on <html> globally.
// Removed on leave so other suite apps are unaffected.
onMounted(() => document.body.classList.add('mail-app'))
onUnmounted(() => document.body.classList.remove('mail-app'))

// App-wide Cmd/Ctrl+Shift+L to cycle the color scheme. The standalone app wired this in its root
// App.vue, but in the suite that App.vue is unused — this MailLayout is the mounted mail root, so the
// listener has to live here for the shortcut to fire on any mail page.
const handleThemeShortcut = (e: KeyboardEvent) => {
	if (
		(e.metaKey || e.ctrlKey) &&
		e.shiftKey &&
		e.key.toLowerCase() === 'l' &&
		!shouldIgnoreKeypress(e, true)
	) {
		e.preventDefault()
		cycleTheme()
	}
}

/* -------------------------------------------------------------------------- */
/* Push-notification service worker.                                          */
/*                                                                            */
/* Moved out of the standalone main.ts. `sw.js` (the FCM service worker) is    */
/* emitted at /assets/suite/frontend/sw.js by vite-plugin-pwa from             */
/* src/apps/mail/sw.ts (see vite.config.ts). It is a build-only artifact, so   */
/* push notifications work in a production build, not the dev server. Kept     */
/* FULLY fail-safe so it never breaks the build or first paint. `firebase` is  */
/* dynamically imported so it stays code-split out of the shared shell chunk.  */
/* -------------------------------------------------------------------------- */
const registerServiceWorker = async () => {
	try {
		if (!('serviceWorker' in navigator)) return

		const { default: FrappePushNotification } = await import(
			'@/apps/mail/utils/frappe-push-notification'
		)
		window.frappePushNotification = new FrappePushNotification('mail')

		let serviceWorkerURL = '/assets/suite/frontend/sw.js'
		let config: unknown = ''

		try {
			config = await window.frappePushNotification.fetchWebConfig()
			serviceWorkerURL = `${serviceWorkerURL}?config=${encodeURIComponent(
				JSON.stringify(config),
			)}`
		} catch (err) {
			console.error('Failed to fetch FCM config', err)
		}

		const registration = await navigator.serviceWorker.register(serviceWorkerURL, {
			type: 'module',
		})
		if (config)
			window.frappePushNotification
				.initialize(registration)
				.then(() => console.log('Frappe Push Notification initialized'))
	} catch (err) {
		console.error('Failed to register service worker', err)
	}
}

onMounted(() => {
	registerServiceWorker()
	window.frappePushNotification?.onMessage((payload: NotificationPayload) =>
		showNotification(payload),
	)
	window.addEventListener('keydown', handleThemeShortcut)
})

onUnmounted(() => window.removeEventListener('keydown', handleThemeShortcut))
</script>

<style>
/* Global mail styles ported from the standalone src/index.css. The suite's
   global css already imports frappe-ui/style.css, so we only carry the mail
   base type sizing, the heading rules, and the shared `.icon` helper.
   The standalone applied these to `html`/`h1`/`h2` globally; here they are
   scoped to `.mail-app-root` (the mail layout root) so they don't leak into
   the other suite apps. frappe-ui design *tokens* are referenced via their CSS
   variables (NOT @apply, which would break the build for these plugin-registered
   token classes); plain Tailwind utilities below still use @apply. */
.mail-app-root {
	@apply text-xl sm:text-lg text-ink-gray-8 bg-surface-base;
}

.mail-app-root h1 {
	@apply !font-semibold;
}

.mail-app-root h2 {
	@apply text-xl !font-medium sm:text-lg;
}

/* frappe-ui Dialogs/Dropdowns teleport to <body>, escaping .mail-app-root, so the base text color
   and heading weights above don't reach them (e.g. the Settings modal's bold <h1> titles, readable
   ink color in dark mode). Re-apply at <body> scope while mail is mounted (the `mail-app` class is
   added/removed by this layout). */
body.mail-app {
	color: var(--ink-gray-8);
}

body.mail-app h1 {
	@apply !font-semibold;
}

body.mail-app h2 {
	@apply text-xl !font-medium sm:text-lg;
}

.icon {
	stroke-width: 1.5;
	width: 1rem;
	height: 1rem;
	color: var(--ink-gray-6);
}
</style>
