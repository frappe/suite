<template>
	<FrappeUIProvider>
		<!-- Nothing in mail works without the mail server, so an outage replaces the whole
		     route group (incl. noLayout pages) rather than decorating a UI whose every fetch
		     would fail. -->
		<MailServerUnavailableView v-if="mailServerUnavailable" class="mail-app-root" />
		<component :is="Layout" v-else class="mail-app-root">
			<router-view />
		</component>
		<InstallPrompt v-if="isMobile" />
		<ShortcutsModal v-model="showShortcuts" />
	</FrappeUIProvider>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, provide, ref, watchEffect } from 'vue'
import { useRoute } from 'vue-router'
import { FrappeUIProvider } from 'frappe-ui'

import { mailServerUnavailable } from '@/boot/config'
import { type RouteLocationRaw, useRouter } from 'vue-router'
import { shouldIgnoreKeypress } from '@/apps/mail/utils'
import { useGPrefix } from '@/apps/mail/utils/listNavigation'
import { useScreenSize, useTheme } from '@/apps/mail/utils/composables'
import { showNotification } from '@/apps/mail/utils/push-notifications'
import { initSocket } from '@/apps/mail/socket'
import dayjs from '@/apps/mail/utils/dayjs'
import { userStore } from '@/apps/mail/stores/user'
import ShortcutsModal from '@/apps/mail/components/Modals/ShortcutsModal.vue'
import DefaultLayout from '@/apps/mail/components/DefaultLayout.vue'
import InstallPrompt from '@/apps/mail/components/InstallPrompt.vue'
import MailServerUnavailableView from '@/apps/mail/components/MailServerUnavailableView.vue'

import type { NotificationPayload } from '@/apps/mail/types'

/**
 * Mail route-group layout.
 *
 * The suite shell already provides the top-level chrome and main.ts provides Pinia/router/frappe-ui/translation, but
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
const { userResource, mailboxIds, accountId } = userStore()
const router = useRouter()

// `?` and the `g`+letter mailbox jumps belong to the whole non-admin app, not to whichever
// list happens to be mounted: they were only reachable from a mailbox view before, so they
// died in All Inboxes, the Screener and the settings pages. The admin dashboard sits under
// its own layout and never sees these.
const showShortcuts = ref(false)
const gPrefix = useGPrefix()

// `g` is also the prefix each list uses for its own g g / G jump to the ends. Both listeners
// see the key and keep their own prefix state; this one only ever acts on a following letter,
// so a `g g` falls through to the list untouched.
// `g` then a letter. Beyond the account's own folders this reaches the two views that are not
// folders at all — the merged list and the Screener — so the map holds routes, not mailbox ids.
//
// `a` is All Inboxes (as in Gmail's All Mail), which pushes Archive to `e` — the letter that
// already archives a thread, so one letter means archive throughout. The Screener takes `r` for
// review: `s` is Sent, and `c` would collide with Contacts if that ever gets a jump.
const mailboxRoute = (mailbox: string) => ({ name: 'mail-mailbox', params: { accountId, mailbox } })

const GO_TO_KEYS: Record<string, () => RouteLocationRaw> = {
	a: () => ({ name: 'mail-all-inboxes' }),
	r: () => ({ name: 'mail-screener', params: { accountId } }),
	i: () => mailboxRoute(mailboxIds.inbox),
	f: () => mailboxRoute('starred'),
	s: () => mailboxRoute(mailboxIds.sent),
	d: () => mailboxRoute(mailboxIds.drafts),
	j: () => mailboxRoute(mailboxIds.junk),
	e: () => mailboxRoute(mailboxIds.archive),
	t: () => mailboxRoute(mailboxIds.trash),
}

const handleGlobalShortcuts = (e: KeyboardEvent) => {
	const key = e.key.toLowerCase()
	if (shouldIgnoreKeypress(e)) return

	if (e.key === '?') {
		e.preventDefault()
		showShortcuts.value = true
		return
	}

	if (gPrefix.armed.value) {
		const destination = GO_TO_KEYS[key]?.()
		gPrefix.disarm()
		if (!destination) return
		e.preventDefault()
		router.push(destination)
		return
	}

	if (key === 'g') gPrefix.press(e.shiftKey)
}
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

// Alongside the html attribute, sync the theme-color meta — it drives the OS
// status bar / browser chrome in the installed PWA, which otherwise stays white
// over the dark app. Values mirror surface-base per theme (dark hex matches
// EmailContent's THEME_CONFIG).
const THEME_COLOR: Record<string, string> = { light: '#ffffff', dark: '#171717' }

// All three live on the shared shell, not inside mail: data-theme flips every
// frappe-ui design token (see colorPalette.js, keyed on [data-theme="dark"]),
// color-scheme flips the browser-drawn surfaces, and theme-color is a single
// document-wide meta. Drive/sheets/writer/slides set none of them, so whatever
// mail leaves behind is what they render with. Snapshot the server-rendered
// state and restore it on unmount, the same contract as the `mail-app` body
// class below.
const root = document.documentElement
const initialDataTheme = root.getAttribute('data-theme')
const initialColorScheme = root.style.colorScheme
let themeColorMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
const initialThemeColor = themeColorMeta?.content ?? null

watchEffect(() => {
	root.setAttribute('data-theme', dataTheme.value)
	// color-scheme drives the browser-drawn surfaces the page can't paint — on
	// Android standalone that's the system navigation bar (white over a dark app
	// otherwise) and the status-bar seam, plus native controls/scrollbars.
	root.style.colorScheme = dataTheme.value
	if (!themeColorMeta) {
		themeColorMeta = document.createElement('meta')
		themeColorMeta.name = 'theme-color'
		document.head.appendChild(themeColorMeta)
	}
	themeColorMeta.content = THEME_COLOR[dataTheme.value]
})

onUnmounted(() => {
	if (initialDataTheme === null) root.removeAttribute('data-theme')
	else root.setAttribute('data-theme', initialDataTheme)
	root.style.colorScheme = initialColorScheme
	// null means the meta was ours, so take it with us rather than leaving an
	// empty one on the shell.
	if (initialThemeColor === null) themeColorMeta?.remove()
	else if (themeColorMeta) themeColorMeta.content = initialThemeColor
})

// Mark <body> while mail is mounted so the base styles below (see <style>) can reach frappe-ui
// Dialogs/Dropdowns, which teleport to <body> — OUTSIDE .mail-app-root. Without this, their
// un-classed text (modal <h1> titles, base ink color) and heading weights fall back to defaults
// (black + non-bold), so set them via a body class. Removed on leave so other
// suite apps are unaffected.
onMounted(() => document.body.classList.add('mail-app'))
onUnmounted(() => document.body.classList.remove('mail-app'))

// App-wide Cmd/Ctrl+Shift+L to cycle the color scheme. MailLayout is the
// mounted mail root, so the listener lives here to fire on any mail page.
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
/* `sw.js` (the FCM service worker) is                                        */
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

// iOS standalone scrolls the whole document to reveal a focused input above the
// keyboard, and can leave that offset behind after dismissal — the entire shell
// then sits displaced (rows under the clock, tab bar mid-screen, void below).
// Every scroller in the app is internal, so a document offset is always dirt;
// sweep it whenever focus leaves a field. rAF: let the keyboard dismissal settle
// first, and never fight iOS while the field is still focused.
const resetDocumentScroll = () => {
	requestAnimationFrame(() => {
		if (window.scrollY) window.scrollTo(0, 0)
	})
}

onMounted(() => {
	registerServiceWorker()
	window.frappePushNotification?.onMessage((payload: NotificationPayload) =>
		showNotification(payload),
	)
	window.addEventListener('keydown', handleThemeShortcut)
	window.addEventListener('keydown', handleGlobalShortcuts)
	window.addEventListener('focusout', resetDocumentScroll)
})

onUnmounted(() => {
	window.removeEventListener('keydown', handleThemeShortcut)
	window.removeEventListener('keydown', handleGlobalShortcuts)
	window.removeEventListener('focusout', resetDocumentScroll)
})
</script>

<style>
/* Global mail styles. The suite's global css already imports
   frappe-ui/style.css, so we only carry the mail base type sizing, the heading
   rules, and the shared `.icon` helper — scoped to `.mail-app-root` (the mail
   layout root) so they don't leak into the other suite apps. frappe-ui design *tokens* are referenced via their CSS
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

/* The page behind the app follows the theme: the translucent tab bar blurs over it
   (over an unthemed white body it read as a pale band in dark mode), and it's what
   shows in the safe-area strips and iOS rubber-band overscroll. Direct var, not
   @apply — the surface tokens are frappe-ui CSS-layer classes, not registered
   Tailwind utilities (see index.css). */
body.mail-app {
	background-color: var(--surface-base);
	/* Every scroller in the app is internal — the document must never scroll.
	   Belt for the focusout sweep above: without it iOS standalone drags the
	   whole shell when the keyboard appears. */
	overflow: hidden;
	height: 100%;
}

.icon {
	stroke-width: 1.5;
	width: 1rem;
	height: 1rem;
	color: var(--ink-gray-6);
}

/* The mail app's icon weight is 1.5 (.icon, FeatherIcon's default, and
   frappe-ui's ~icons pipeline all agree), but icons imported straight from
   lucide-vue-next ship stroke-width 2 — so default every lucide svg to 1.5
   instead of repeating the attribute at each call site. :where() keeps the
   rule at zero specificity, so an explicit stroke-* utility (e.g. stroke-2
   on the tab bar) still wins. Covers teleported menus/sheets too. */
:where(body.mail-app svg.lucide) {
	stroke-width: 1.5;
}

/* BottomSheets hug their content instead of frappe-ui's fixed 70vh well — a
   five-row menu shouldn't own the whole screen. The old height stays as the
   scroll cap, so tall content (the folder list) behaves exactly as before.
   Scoped to body.mail-app since sheets teleport to <body>. */
body.mail-app .bottom-sheet-content > .h-\[70vh\] {
	height: auto;
	max-height: 70vh;
}

/* Portaled dialogs and menus ship without a z-index (they rely on body DOM
   order), so the mobile panes with explicit z (thread pane, settings — z-20)
   would paint over them. Lift them above the panes but below bottom sheets
   (z-50), preserving sheet-over-dialog ordering. The panel is a sibling of
   the overlay (not nested inside it), so both layers need the lift — same z,
   so DOM order keeps the panel above its own backdrop. */
body.mail-app .dialog-overlay,
body.mail-app .dialog-scroll-container {
	z-index: 30;
}
body.mail-app .menu-content {
	z-index: 30;
}

/* Swipe paging (mobile) — shared by the thread pane (MailThread) and the screener
   preview: the incoming page slides in from the swipe side while the outgoing one —
   lifted out of flow so they overlap — slides away in tandem. */
body.mail-app .page-next-enter-active,
body.mail-app .page-next-leave-active,
body.mail-app .page-prev-enter-active,
body.mail-app .page-prev-leave-active {
	transition: transform 0.2s cubic-bezier(0.32, 0.72, 0, 1);
}

body.mail-app .page-next-leave-active,
body.mail-app .page-prev-leave-active {
	position: absolute;
	inset: 0;
}

body.mail-app .page-next-enter-from,
body.mail-app .page-prev-leave-to {
	transform: translateX(100%);
}

body.mail-app .page-next-leave-to,
body.mail-app .page-prev-enter-from {
	transform: translateX(-100%);
}

</style>
